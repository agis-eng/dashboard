import { parse, stringify } from 'yaml';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = 'agis-eng/dashboard';
const API  = 'https://api.github.com';

async function ghGet(path) {
  const r = await fetch(`${API}/repos/${REPO}/contents/${path}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'atlas-dashboard' }
  });
  const data = await r.json();
  if (!data.content) throw new Error(`GitHub fetch failed for ${path}: ${data.message || JSON.stringify(data)}`);
  return { content: Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString(), sha: data.sha };
}

async function ghPut(path, content, sha, message) {
  const r = await fetch(`${API}/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'atlas-dashboard'
    },
    body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), sha })
  });
  return r.json();
}

// Set or delete a nested field using dot-notation path: 'affiliate.commission_pct'
function setNested(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  const lastKey = keys[keys.length - 1];
  if (value === null || value === '') {
    delete cur[lastKey];
  } else if (Array.isArray(value)) {
    cur[lastKey] = value;
  } else {
    // Coerce numeric strings to numbers
    const num = Number(value);
    cur[lastKey] = (typeof value === 'string' && value.trim() !== '' && !isNaN(num)) ? num : value;
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-');
}

// ── Handler: routes to update-field or create-project logic based on action ──
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not set' });

  // Route: if action=create-project (also accepts requests from /api/create-project path)
  const isCreate = req.body?.action === 'create-project'
    || (req.url || '').includes('create-project');

  if (isCreate) {
    return handleCreateProject(req, res);
  }
  return handleUpdateField(req, res);
}

async function handleUpdateField(req, res) {
  const { entityType, entityId, updates } = req.body || {};
  if (!entityType || !entityId || !updates) {
    return res.status(400).json({ error: 'Missing entityType, entityId, or updates' });
  }

  const fileMap = { project: 'data/projects.yaml', partner: 'data/partners.yaml', client: 'data/clients.yaml' };
  const keyMap  = { project: 'projects', partner: 'partners', client: 'clients' };
  const yamlFile = fileMap[entityType];
  const rootKey  = keyMap[entityType];
  if (!yamlFile) return res.status(400).json({ error: `Unknown entityType: ${entityType}` });

  try {
    const { content, sha } = await ghGet(yamlFile);
    const data = parse(content);
    const entities = data[rootKey] || [];
    const idx = entities.findIndex(e => e.id === entityId);
    if (idx === -1) return res.status(404).json({ error: `${entityType} not found: ${entityId}` });

    for (const [field, value] of Object.entries(updates)) {
      setNested(entities[idx], field, value);
    }

    const newYaml = stringify(data, { lineWidth: 0 });
    const fieldDesc = Object.keys(updates).join(', ');
    const result = await ghPut(yamlFile, newYaml, sha, `dashboard: update ${entityType} ${entityId} — ${fieldDesc}`);

    if (result.content) {
      return res.status(200).json({ ok: true, updated: Object.keys(updates).length });
    } else {
      return res.status(500).json({ error: 'GitHub push failed', detail: result.message });
    }
  } catch (err) {
    console.error('update-field error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function handleCreateProject(req, res) {
  const { name, summary, owner, stage, status, contacts, linkCallIds, previewUrl,
          clientId: rawClientId, newClientName } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing project name' });

  const slug = slugify(name);
  const projectId = `proj-${slug}`;
  const today = new Date().toISOString().slice(0, 10);

  try {
    // 1. Resolve client — create new client in clients.yaml if needed
    let resolvedClientId = rawClientId || 'atlas';
    if (newClientName) {
      const clientSlug = slugify(newClientName);
      resolvedClientId = clientSlug;
      const { content: clientContent, sha: clientSha } = await ghGet('data/clients.yaml');
      const clientData = parse(clientContent);
      if (!clientData.clients.find(c => c.id === clientSlug)) {
        clientData.clients.push({
          id: clientSlug,
          name: newClientName,
          slug: clientSlug,
          contact: 'agis@manifestbot.ai',
          notes: 'Added via dashboard',
          summary: summary || name,
          requestUrl: `mailto:agis@manifestbot.ai?subject=Change%20Request%20-%20${encodeURIComponent(newClientName)}`,
        });
        await ghPut('data/clients.yaml', stringify(clientData, { lineWidth: 0 }), clientSha,
          `dashboard: add client "${newClientName}"`);
      }
    }

    // 2. Add project to projects.yaml
    const { content: projContent, sha: projSha } = await ghGet('data/projects.yaml');
    const projData = parse(projContent);
    if (projData.projects.find(p => p.id === projectId)) {
      // Append a short unique suffix to avoid collision
      const suffix = Date.now().toString(36).slice(-4);
      return res.status(409).json({ error: 'Project ID already exists — try a more specific name', id: projectId });
    }
    const newProject = {
      id: projectId,
      name,
      clientId: resolvedClientId,
      owner: owner || 'Erik',
      stage: stage || 'Lead',
      status: status || name,
      lastUpdate: today,
      summary: summary || name,
    };
    if (previewUrl) newProject.previewUrl = previewUrl;
    if (contacts && contacts.length) newProject.contacts = contacts;
    projData.projects.push(newProject);
    const projResult = await ghPut('data/projects.yaml', stringify(projData, { lineWidth: 0 }), projSha,
      `dashboard: create project "${name}"`);
    if (!projResult.content) {
      return res.status(500).json({ error: 'Failed to save project', detail: projResult.message });
    }

    // 3. Link calls if provided
    if (linkCallIds && linkCallIds.length) {
      const { content: callContent, sha: callSha } = await ghGet('data/call-notes.yaml');
      const callData = parse(callContent);
      let updated = 0;
      for (const call of callData.calls) {
        if (linkCallIds.includes(call.recording_id)) { call.project_id = projectId; updated++; }
      }
      if (updated > 0) {
        await ghPut('data/call-notes.yaml', stringify(callData, { lineWidth: 0 }), callSha,
          `dashboard: link ${updated} calls to project "${name}"`);
      }
    }

    return res.status(200).json({ ok: true, id: projectId, name, clientId: resolvedClientId });
  } catch (err) {
    console.error('create-project error:', err);
    return res.status(500).json({ error: err.message });
  }
}
