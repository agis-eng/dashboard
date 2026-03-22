import crypto from 'crypto';
import { spawn } from 'child_process';
import { Redis } from '@upstash/redis';

const AGENT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

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

// GET /api/chat-stream?responseId=...&userId=...&conversationId=...
// SSE endpoint that streams the AI response chunk by chunk
export default async function chatStream(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { responseId, userId, conversationId } = req.query || {};
  if (!responseId || !conversationId) {
    return res.status(400).json({ error: 'Missing responseId or conversationId' });
  }

  const uid = userId || 'anonymous';
  const redis = getRedis();
  const msgKey = `chat:${uid}:${conversationId}:${responseId}`;

  // Fetch the pending AI message to get context
  const raw = await redis.get(msgKey);
  if (!raw) return res.status(404).json({ error: 'Message not found' });

  const aiMsg = typeof raw === 'string' ? JSON.parse(raw) : raw;

  // Find the user message that triggered this response (previous message in the conversation)
  const convMsgsKey = `chat:${uid}:${conversationId}:messages`;
  const messageIds = await redis.lrange(convMsgsKey, 0, -1);
  const responseIdx = messageIds.indexOf(responseId);
  let userMessage = 'Hello';
  if (responseIdx > 0) {
    const prevId = messageIds[responseIdx - 1];
    const prevRaw = await redis.get(`chat:${uid}:${conversationId}:${prevId}`);
    if (prevRaw) {
      const prevMsg = typeof prevRaw === 'string' ? JSON.parse(prevRaw) : prevRaw;
      userMessage = prevMsg.text || 'Hello';
    }
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let fullText = '';
  let killed = false;

  // Spawn the OpenClaw agent process
  let agent;
  try {
    agent = spawn('openclaw', ['agent', '--message', userMessage, '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Failed to start OpenClaw agent' })}\n\n`);
    res.end();
    return;
  }

  // Timeout — kill the process if it runs too long
  const timeout = setTimeout(() => {
    if (!killed) {
      killed = true;
      agent.kill('SIGTERM');
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'OpenClaw agent timed out' })}\n\n`);
      res.end();
    }
  }, AGENT_TIMEOUT_MS);

  // Stream stdout chunks to client as they arrive
  agent.stdout.on('data', (data) => {
    if (killed) return;
    const chunk = data.toString();
    fullText += chunk;
    res.write(`event: chunk\ndata: ${chunk}\n\n`);
  });

  // Capture stderr for error reporting
  let stderrBuf = '';
  agent.stderr.on('data', (data) => {
    stderrBuf += data.toString();
  });

  // On process exit, finalize
  agent.on('close', async (code) => {
    clearTimeout(timeout);
    if (killed) return;

    if (code !== 0 && !fullText) {
      const errMsg = stderrBuf.trim() || `OpenClaw agent exited with code ${code}`;
      res.write(`event: error\ndata: ${JSON.stringify({ error: errMsg })}\n\n`);
      res.end();
      return;
    }

    // Save completed message to Redis
    try {
      const completed = {
        ...aiMsg,
        text: fullText.trim(),
        status: 'complete',
        timestamp: Date.now(),
      };
      await redis.set(msgKey, JSON.stringify(completed), { ex: 60 * 60 * 24 * 30 });
    } catch (err) {
      // Redis save failed — log but don't break the SSE stream
      console.error('Failed to save completed message to Redis:', err);
    }

    res.write(`event: done\ndata: ${fullText.trim()}\n\n`);
    res.end();
  });

  // Handle spawn errors (e.g., command not found)
  agent.on('error', (err) => {
    clearTimeout(timeout);
    if (killed) return;
    killed = true;
    res.write(`event: error\ndata: ${JSON.stringify({ error: `OpenClaw agent error: ${err.message}` })}\n\n`);
    res.end();
  });

  // Clean up if client disconnects
  req.on('close', () => {
    if (!killed) {
      killed = true;
      clearTimeout(timeout);
      agent.kill('SIGTERM');
    }
  });
}
