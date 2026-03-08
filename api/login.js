import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import YAML from 'yaml';

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'atlas-dashboard-secret-2026';

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function createToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Missing username or password' });
  }

  let users = [];
  try {
    const usersPath = path.join(process.cwd(), 'data', 'users.yaml');
    const raw = fs.readFileSync(usersPath, 'utf8');
    const parsed = YAML.parse(raw) || {};
    users = parsed.users || [];
  } catch (err) {
    return res.status(500).json({ error: 'Could not load user data' });
  }

  const passwordHash = sha256(password);
  const user = users.find(u => u.username === username && u.passwordHash === passwordHash);

  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = createToken({
    username: user.username,
    clientSlug: user.clientSlug,
    name: user.name || user.username,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
  });

  return res.status(200).json({ token, clientSlug: user.clientSlug });
}
