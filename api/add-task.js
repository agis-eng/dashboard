import { parse, stringify } from 'yaml';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = 'agis-eng/dashboard';
const API = 'https://api.github.com';

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

function generateTaskId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `call-task-${timestamp}-${random}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { title, notes, source } = req.body;

  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'Title is required' });
  }

  try {
    // Get current tasks.yaml file
    const { content: tasksYaml, sha } = await ghGet('data/tasks.yaml');
    const tasksData = parse(tasksYaml);

    // Create new task
    const newTask = {
      id: generateTaskId(),
      title: title.trim(),
      status: 'backlog',
      priority: 'medium',
      type: 'task',
      platforms: [],
      project: '',
      client: '',
      assignee: '',
      due_date: null,
      notes: notes ? notes.trim() : '',
      tags: [],
      notion_url: null,
      source_call: source ? source.trim() : null,
      updated_at: new Date().toISOString()
    };

    // Append new task to the tasks array
    tasksData.tasks = tasksData.tasks || [];
    tasksData.tasks.push(newTask);

    // Save back to GitHub
    const updatedYaml = stringify(tasksData, { indent: 2 });
    await ghPut('data/tasks.yaml', updatedYaml, sha, 'dashboard: add task from call');

    return res.status(200).json({ ok: true, task: newTask });
  } catch (error) {
    console.error('Error adding task:', error);
    return res.status(500).json({ error: 'Failed to add task', details: error.message });
  }
}