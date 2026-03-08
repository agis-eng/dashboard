import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const API_ID       = parseInt(process.env.TELEGRAM_API_ID  || '0');
const API_HASH     = process.env.TELEGRAM_API_HASH          || '';
const USER_SESSION = process.env.TELEGRAM_USER_SESSION      || '';
const CHAT_ID      = process.env.TELEGRAM_CHAT_ID           || '';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!USER_SESSION || !API_ID || !API_HASH || !CHAT_ID) {
    return res.status(200).json({ ok: true, messages: [] });
  }

  // `since` is the last message_id the client has already seen
  const since = req.query.since ? parseInt(req.query.since) : 0;

  const client = new TelegramClient(
    new StringSession(USER_SESSION),
    API_ID,
    API_HASH,
    { connectionRetries: 3 }
  );

  try {
    await client.connect();

    const opts = { limit: 50 };
    if (since) opts.minId = since;  // only fetch messages newer than last seen

    const msgs = await client.getMessages(CHAT_ID, opts);

    const messages = msgs
      .filter(m => m.message)  // text messages only
      .map(m => ({
        message_id: m.id,
        update_id:  m.id,
        from:    m.sender?.firstName || m.sender?.username || 'Unknown',
        text:    m.message,
        date:    m.date,
        outgoing: !!m.out,  // true when sent by the logged-in user (Erik)
      }))
      .reverse();  // oldest first

    await client.disconnect();
    return res.status(200).json({ ok: true, messages });
  } catch (err) {
    await client.disconnect().catch(() => {});
    return res.status(500).json({ error: err.message });
  }
}
