import { sha256, getUser, saveUser, createAuthToken, TOKEN_SECRET } from '../../lib/auth.js';

function isAuthorized(req) {
  const auth = req.headers.authorization || '';
  return auth === `Bearer ${TOKEN_SECRET}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { username, password, clientSlug, name } = req.body || {};
  if (!username || !password || !clientSlug) {
    return res.status(400).json({ error: 'Missing username, password, or clientSlug' });
  }

  try {
    const existing = await getUser(username);
    if (existing) {
      return res.status(409).json({ error: 'User already exists' });
    }

    const userRecord = await saveUser({
      username,
      passwordHash: sha256(password),
      clientSlug,
      name: name || username,
      mustChangePassword: true
    });

    const token = createAuthToken(userRecord);

    return res.status(201).json({
      username: userRecord.username,
      clientSlug: userRecord.clientSlug,
      name: userRecord.name,
      password,
      token
    });
  } catch (err) {
    console.error('Failed to create user', err);
    return res.status(500).json({ error: 'Failed to create user' });
  }
}
