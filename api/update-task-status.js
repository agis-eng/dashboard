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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not set' });

  const { taskId, newStatus } = req.body || {};
  if (!taskId || !newStatus) {
    return res.status(400).json({ error: 'Missing taskId or newStatus' });
  }

  try {
    const { content, sha } = await ghGet('data/tasks.yaml');
    const data = parse(content);
    const tasks = data.tasks || [];
    const taskIndex = tasks.findIndex(t => t.id === taskId);

    if (taskIndex === -1) {
      return res.status(404).json({ error: `Task not found: ${taskId}` });
    }

    // Update the task status
    tasks[taskIndex].status = newStatus;
    tasks[taskIndex].updated_at = new Date().toISOString();

    const newYaml = stringify(data, { lineWidth: 0 });
    const result = await ghPut('data/tasks.yaml', newYaml, sha, `dashboard: update task ${taskId} status to ${newStatus}`);

    if (result.content) {
      return res.status(200).json({ ok: true, taskId, newStatus });
    } else {
      return res.status(500).json({ error: 'GitHub push failed', detail: result.message });
    }
  } catch (err) {
    console.error('update-task-status error:', err);
    return res.status(500).json({ error: err.message });
  }
}