import { sha256, getUser, createAuthToken } from '../lib/auth.js';

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

  try {
    const user = await getUser(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const passwordHash = sha256(password);
    if (user.passwordHash !== passwordHash) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = createAuthToken({
      username: user.username,
      clientSlug: user.clientSlug,
      name: user.name || user.username,
      mustChangePassword: Boolean(user.mustChangePassword)
    });

    return res.status(200).json({
      token,
      clientSlug: user.clientSlug,
      mustChangePassword: Boolean(user.mustChangePassword)
    });
  } catch (err) {
    console.error('Login error', err);
    return res.status(500).json({ error: 'Unable to authenticate user' });
  }
}
