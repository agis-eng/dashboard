// api/assign-memo-project.js
// POST { memoId, project } — updates project_match in voice_memos.yaml
// and pushes to GitHub so Vercel rebuilds the dashboard.

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const YAML_PATH = path.join(process.cwd(), 'data', 'voice_memos.yaml');
const JSON_PATH = path.join(process.cwd(), 'data', 'voice_memos_raw.json');
const GITHUB_REPO = process.env.GITHUB_REPO || 'agis-eng/dashboard';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_FILE = 'data/voice_memos.yaml';

function buildYaml(memos) {
  const lines = ['voice_memos:'];
  for (const m of memos) {
    lines.push(`- id: ${JSON.stringify(m.id)}`);
    lines.push(`  title: ${JSON.stringify(m.title)}`);
    lines.push(`  date: ${JSON.stringify(m.date)}`);
    lines.push(`  type: ${m.type}`);
    lines.push(`  speakers: ${JSON.stringify(m.speakers)}`);
    const pm = m.project_match;
    lines.push(`  project_match: ${pm ? JSON.stringify(pm) : 'null'}`);
    lines.push(`  summary: ${JSON.stringify(m.summary || '')}`);
    lines.push(`  notion_url: ${JSON.stringify(m.notion_url || '')}`);
    const topics = m.topics || [];
    if (topics.length) {
      lines.push(`  topics: [${topics.map(t => JSON.stringify(t)).join(', ')}]`);
    } else {
      lines.push(`  topics: []`);
    }
    const actions = m.action_items || [];
    if (actions.length) {
      lines.push(`  action_items:`);
      for (const a of actions) lines.push(`    - ${JSON.stringify(a)}`);
    } else {
      lines.push(`  action_items: []`);
    }
  }
  return lines.join('\n') + '\n';
}

async function pushToGitHub(yamlContent) {
  if (!GITHUB_TOKEN || GITHUB_TOKEN.startsWith('ghp_...')) return;
  const { default: https } = await import('https');
  const api = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`;
  const headers = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'dashboard-api',
    'Content-Type': 'application/json',
  };

  // Get current SHA
  let sha = '';
  try {
    sha = await new Promise((resolve) => {
      const req = https.get(api, { headers }, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try { resolve(JSON.parse(body).sha || ''); } catch { resolve(''); }
        });
      });
      req.on('error', () => resolve(''));
      req.end();
    });
  } catch {}

  const content = Buffer.from(yamlContent).toString('base64');
  const payload = JSON.stringify({
    message: `Update voice memos project assignment [dashboard api]`,
    content,
    ...(sha ? { sha } : {}),
  });

  await new Promise((resolve) => {
    const url = new URL(api);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'PUT',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      res.on('data', () => {});
      res.on('end', resolve);
    });
    req.on('error', resolve);
    req.write(payload);
    req.end();
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }

  const { memoId, project } = body || {};
  if (!memoId) return res.status(400).json({ error: 'memoId required' });

  // Load current memos from JSON sidecar (faster than parsing YAML)
  let memos = [];
  if (fs.existsSync(JSON_PATH)) {
    try { memos = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')); } catch {}
  }

  const idx = memos.findIndex(m => m.id === memoId);
  if (idx === -1) return res.status(404).json({ error: 'Memo not found' });

  memos[idx].project_match = project || null;

  // Write JSON sidecar
  fs.writeFileSync(JSON_PATH, JSON.stringify(memos, null, 2));

  // Write YAML
  const yaml = buildYaml(memos);
  fs.writeFileSync(YAML_PATH, yaml);

  // Push to GitHub (triggers Vercel rebuild)
  await pushToGitHub(yaml);

  return res.status(200).json({ ok: true, memoId, project: project || null });
}
