const BOT_TOKEN = process.env.AGIS_BOT_TOKEN;
const CHAT_ID = process.env.AGIS_CHAT_ID;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!BOT_TOKEN || !CHAT_ID) {
    return res.status(500).json({ error: 'AGIS not configured' });
  }

  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'No message text' });

  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: text.trim(), parse_mode: 'HTML' }),
  });

  const data = await response.json();
  return res.status(200).json(data);
}
