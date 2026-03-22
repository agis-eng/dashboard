import crypto from 'crypto';
import { Redis } from '@upstash/redis';

let redisInstance;
function getRedis() {
  if (!redisInstance) {
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    if (!url || !token) throw new Error('Redis not configured');
    redisInstance = new Redis({ url, token });
  }
  return redisInstance;
}

// POST /api/chat-send — send a message
export async function chatSend(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, message, conversationId } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: 'No message text' });

  const uid = userId || 'anonymous';
  const convId = conversationId || `conv-${Date.now()}`;
  const messageId = crypto.randomUUID();
  const redis = getRedis();

  const userMsg = {
    id: messageId,
    role: 'user',
    text: message.trim(),
    timestamp: Date.now(),
    status: 'complete',
  };

  // Store user message
  const msgKey = `chat:${uid}:${convId}:${messageId}`;
  await redis.set(msgKey, JSON.stringify(userMsg), { ex: 60 * 60 * 24 * 30 }); // 30 day TTL

  // Track message in conversation list
  const convMsgsKey = `chat:${uid}:${convId}:messages`;
  await redis.rpush(convMsgsKey, messageId);

  // Track conversation in user's conversation list
  const convsKey = `chat:${uid}:conversations`;
  const existing = await redis.lrange(convsKey, 0, -1);
  if (!existing.includes(convId)) {
    await redis.rpush(convsKey, convId);
  }

  // Create mock AI response (will be replaced with real OpenClaw later)
  const responseId = crypto.randomUUID();
  const aiMsg = {
    id: responseId,
    role: 'assistant',
    text: '',
    timestamp: Date.now(),
    status: 'processing',
  };
  const aiMsgKey = `chat:${uid}:${convId}:${responseId}`;
  await redis.set(aiMsgKey, JSON.stringify(aiMsg), { ex: 60 * 60 * 24 * 30 });
  await redis.rpush(convMsgsKey, responseId);

  // AI response will be streamed via SSE at /api/chat-stream
  return res.status(200).json({
    messageId,
    responseId,
    conversationId: convId,
    status: 'processing',
  });
}

// GET /api/chat-status?messageId=...&userId=...&conversationId=...
export async function chatStatus(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { messageId, userId, conversationId } = req.query || {};
  if (!messageId || !conversationId) {
    return res.status(400).json({ error: 'Missing messageId or conversationId' });
  }

  const uid = userId || 'anonymous';
  const redis = getRedis();
  const msgKey = `chat:${uid}:${conversationId}:${messageId}`;
  const raw = await redis.get(msgKey);

  if (!raw) return res.status(404).json({ error: 'Message not found' });

  const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return res.status(200).json({
    status: msg.status,
    response: msg.status === 'complete' ? msg.text : null,
  });
}

// GET /api/chat-history?userId=...&conversationId=...
export async function chatHistory(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { userId, conversationId } = req.query || {};
  const uid = userId || 'anonymous';
  const redis = getRedis();

  // If no conversationId, return list of conversations
  if (!conversationId) {
    const convsKey = `chat:${uid}:conversations`;
    const convIds = await redis.lrange(convsKey, 0, -1);
    return res.status(200).json({ conversations: convIds });
  }

  // Return messages for a specific conversation
  const convMsgsKey = `chat:${uid}:${conversationId}:messages`;
  const messageIds = await redis.lrange(convMsgsKey, 0, -1);

  const messages = [];
  for (const msgId of messageIds) {
    const msgKey = `chat:${uid}:${conversationId}:${msgId}`;
    const raw = await redis.get(msgKey);
    if (raw) {
      const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
      messages.push(msg);
    }
  }

  return res.status(200).json({ conversationId, messages });
}
