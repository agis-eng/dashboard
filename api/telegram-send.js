import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const API_ID         = parseInt(process.env.TELEGRAM_API_ID   || '0');
const API_HASH       = process.env.TELEGRAM_API_HASH           || '';
const USER_SESSION   = process.env.TELEGRAM_USER_SESSION       || '';
const BOT_TOKEN      = process.env.TELEGRAM_BOT_TOKEN          || '';
const CHAT_ID        = process.env.TELEGRAM_CHAT_ID            || '';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'No message text' });

  const message = text.trim();

  // ── Prefer user session (GramJS) so messages appear as Erik ──────────
  if (USER_SESSION && API_ID && API_HASH && CHAT_ID) {
    return sendAsUser(message, res);
  }

  // ── Fallback: bot API (messages show as bot) ──────────────────────────
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
    // If user session fails for any reason, fall back to bot
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
