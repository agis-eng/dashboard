// api/delete-voice-memo.js
// POST { memoId } — removes memo by id from voice_memos.yaml via GitHub API
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

  const { memoId } = req.body || {};
  if (!memoId) return res.status(400).json({ error: 'memoId required' });

  try {
    const { content, sha } = await ghGet('data/voice_memos.yaml');
    const data = parse(content);
    const memos = data.voice_memos || [];

    const idx = memos.findIndex(m => m.id === memoId);
    if (idx === -1) return res.status(404).json({ error: `Memo not found: ${memoId}` });

    // Filter out the memo by removing it from array
    const filteredMemos = memos.filter(m => m.id !== memoId);
    data.voice_memos = filteredMemos;

    const newYaml = stringify(data, { lineWidth: 0 });
    const result = await ghPut(
      'data/voice_memos.yaml',
      newYaml,
      sha,
      `dashboard: delete voice memo "${memoId}"`
    );

    if (result.content) {
      return res.status(200).json({ ok: true, memoId });
    } else {
      return res.status(500).json({ error: 'GitHub push failed', detail: result.message });
    }
  } catch (err) {
    console.error('delete-voice-memo error:', err);
    return res.status(500).json({ error: err.message });
  }
}