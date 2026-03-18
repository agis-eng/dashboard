// api/add-task.js
// POST { title, notes, source } — adds new task to tasks.yaml via GitHub API
// Uses same ghGet/ghPut pattern as other endpoints so it works on Vercel.

import { parse, stringify } from 'yaml';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = 'agis-eng/dashboard';
const API  = 'https://api.github.com';

async function ghGet(filePath) {
  const r = await fetch(`${API}/repos/${REPO}/contents/${filePath}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'atlas-dashboard' }
  });
  const data = await r.json();
  if (!data.content) throw new Error(`GitHub fetch failed for ${filePath}: ${data.message || JSON.stringify(data)}`);
  return { content: Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString(), sha: data.sha };
}

async function ghPut(filePath, content, sha, message) {
  const r = await fetch(`${API}/repos/${REPO}/contents/${filePath}`, {
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

  const { title, notes, source } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });

  try {
    const { content, sha } = await ghGet('data/tasks.yaml');
    const data = parse(content);
    const tasks = data.tasks || [];

    // Create new task with generated ID and metadata
    const newTask = {
      id: Date.now().toString(36),
      title: title,
      notes: notes || '',
      status: 'backlog',
      type: 'task',
      priority: '',
      assignee: '',
      source_memo: source || null,
      created_at: new Date().toISOString().slice(0, 10),
      platforms: [],
      project: '',
      client: '',
      due_date: null,
      tags: [],
      notion_url: null,
      updated_at: new Date().toISOString()
    };

    // Append new task to tasks array
    tasks.push(newTask);
    data.tasks = tasks;

    const newYaml = stringify(data, { lineWidth: 0 });
    const result = await ghPut(
      'data/tasks.yaml',
      newYaml,
      sha,
      `dashboard: add task from memo`
    );

    if (result.content) {
      return res.status(200).json({ ok: true, taskId: newTask.id, title: newTask.title });
    } else {
      return res.status(500).json({ error: 'GitHub push failed', detail: result.message });
    }
  } catch (err) {
    console.error('add-task error:', err);
    return res.status(500).json({ error: err.message });
  }
}