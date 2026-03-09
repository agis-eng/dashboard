import { sha256, getUser, saveUser, verifyToken, createAuthToken } from '../lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Missing token or new password' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const user = await getUser(payload.username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updated = await saveUser({
      ...user,
      passwordHash: sha256(newPassword),
      mustChangePassword: false
    });

    const newToken = createAuthToken(updated);

    return res.status(200).json({
      token: newToken,
      clientSlug: updated.clientSlug
    });
  } catch (err) {
    console.error('Change password error', err);
    return res.status(500).json({ error: 'Unable to update password' });
  }
}
