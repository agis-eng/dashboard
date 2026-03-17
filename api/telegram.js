import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const API_ID       = parseInt(process.env.TELEGRAM_API_ID   || '0');
const API_HASH     = process.env.TELEGRAM_API_HASH           || '';
const USER_SESSION = process.env.TELEGRAM_USER_SESSION       || '';
const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN          || '';
const CHAT_ID      = process.env.TELEGRAM_CHAT_ID            || '';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') return getMessages(req, res);
  if (req.method === 'POST') return sendMessage(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

// ── GET: fetch recent messages ────────────────────────────────────────────────
async function getMessages(req, res) {
  if (!USER_SESSION || !API_ID || !API_HASH || !CHAT_ID) {
    return res.status(200).json({ ok: true, messages: [] });
  }

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
    if (since) opts.minId = since;

    const msgs = await client.getMessages(CHAT_ID, opts);
    const messages = msgs
      .filter(m => m.message)
      .map(m => ({
        message_id: m.id,
        update_id:  m.id,
        from:    m.sender?.firstName || m.sender?.username || 'Unknown',
        text:    m.message,
        date:    m.date,
        outgoing: !!m.out,
      }))
      .reverse();

    await client.disconnect();
    return res.status(200).json({ ok: true, messages });
  } catch (err) {
    await client.disconnect().catch(() => {});
    return res.status(500).json({ error: err.message });
  }
}

// ── POST: send a message ──────────────────────────────────────────────────────
async function sendMessage(req, res) {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'No message text' });

  const message = text.trim();

  if (USER_SESSION && API_ID && API_HASH && CHAT_ID) {
    return sendAsUser(message, res);
  }
  return sendAsBot(message, res);
}

async function sendAsUser(message, res) {
  const client = new TelegramClient(
    new StringSession(USER_SESSION),
    API_ID,
    API_HASH,
    { connectionRetries: 3 }
  );
  try {
    await client.connect();
    const result = await client.sendMessage(CHAT_ID, { message });
    await client.disconnect();
    return res.status(200).json({
      ok: true,
      result: { message_id: result.id, date: result.date }
    });
  } catch (err) {
    await client.disconnect().catch(() => {});
    console.error('GramJS send failed, falling back to bot API:', err.message);
    return sendAsBot(message, res);
  }
}

async function sendAsBot(message, res) {
  if (!BOT_TOKEN || !CHAT_ID) {
    return res.status(500).json({ error: 'Telegram not configured' });
  }
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: 'HTML' }),
      }
    );
    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
