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
  } else {
    // Coerce numeric strings to numbers
    const num = Number(value);
    cur[lastKey] = (typeof value === 'string' && value.trim() !== '' && !isNaN(num)) ? num : value;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!GITHUB_TOKEN) {
    return res.status(500).json({ error: 'GITHUB_TOKEN environment variable not set' });
  }

  const { entityType, entityId, updates } = req.body || {};
  if (!entityType || !entityId || !updates) {
    return res.status(400).json({ error: 'Missing entityType, entityId, or updates' });
  }

  const yamlFile = entityType === 'project' ? 'data/projects.yaml' : 'data/partners.yaml';
  const rootKey  = entityType === 'project' ? 'projects' : 'partners';

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
