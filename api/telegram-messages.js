const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const offset = req.query.offset ? parseInt(req.query.offset) : undefined;

  try {
    const url = new URL(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`);
    url.searchParams.set('allowed_updates', JSON.stringify(['message']));
    if (offset) url.searchParams.set('offset', offset);

    const response = await fetch(url.toString());
    const data = await response.json();

    // Filter to only messages from our dedicated group chat
    const messages = (data.result || [])
      .filter(u => u.message && String(u.message.chat.id) === String(CHAT_ID))
      .map(u => ({
        update_id: u.update_id,
        message_id: u.message.message_id,
        from: u.message.from?.first_name || u.message.chat?.title || 'Unknown',
        text: u.message.text || '',
        date: u.message.date,
      }));

    return res.status(200).json({ ok: true, messages });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
