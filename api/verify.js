import crypto from 'crypto';

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'atlas-dashboard-secret-2026';

function verifyToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET)
      .update(`${header}.${body}`)
      .digest('base64url');
    if (sig !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim();

  if (!token) return res.status(401).json({ valid: false });

  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ valid: false });

  return res.status(200).json({
    valid: true,
    clientSlug: payload.clientSlug,
    username: payload.username,
    name: payload.name
  });
}
