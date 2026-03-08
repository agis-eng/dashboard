const BOT_TOKEN = process.env.AGIS_BOT_TOKEN;
const CHAT_ID = process.env.AGIS_CHAT_ID;

let lastUpdateId = 0;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!BOT_TOKEN || !CHAT_ID) {
    return res.status(500).json({ error: 'AGIS not configured' });
  }

  const since = req.query.since ? parseInt(req.query.since) : 0;
  const offset = since > 0 ? since + 1 : 0;

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=50&offset=${offset}&allowed_updates=["message"]`
  );
  const data = await response.json();

  if (!data.ok) return res.status(500).json({ error: 'Telegram error' });

  const chatIdNum = parseInt(CHAT_ID);
  const messages = (data.result || [])
    .filter(u => u.message && parseInt(u.message.chat.id) === chatIdNum && u.message.text)
    .map(u => ({
      update_id: u.update_id,
      message_id: u.message.message_id,
      from: u.message.from?.first_name || u.message.from?.username || 'Unknown',
      from_id: u.message.from?.id,
      text: u.message.text,
      date: u.message.date
    }));

  return res.status(200).json({ messages });
}
