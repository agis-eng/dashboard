import crypto from 'crypto';
import { Redis } from '@upstash/redis';

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'atlas-dashboard-secret-2026';
const USER_KEY_PREFIX = 'atlas:users:';

let redisInstance;
function getRedis() {
  if (!redisInstance) {
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    if (!url || !token) {
      throw new Error('Upstash Redis environment variables are not configured');
    }
    redisInstance = new Redis({ url, token });
  }
  return redisInstance;
}

const userKey = (username) => `${USER_KEY_PREFIX}${username}`;

export function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

export async function getUser(username) {
  if (!username) return null;
  const redis = getRedis();
  const record = await redis.get(userKey(username));
  if (!record) return null;
  if (typeof record === 'string') {
    try { return JSON.parse(record); } catch { return null; }
  }
  return record;
}

export async function saveUser(user) {
  if (!user || !user.username) throw new Error('User object missing username');
  const redis = getRedis();
  const normalized = {
    username: user.username,
    passwordHash: user.passwordHash,
    clientSlug: user.clientSlug,
    name: user.name || user.username,
    mustChangePassword: Boolean(user.mustChangePassword)
  };
  await redis.set(userKey(user.username), normalized);
  return normalized;
}

export function createToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token) {
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
  } catch (err) {
    return null;
  }
}

export function createAuthToken(user) {
  return createToken({
    username: user.username,
    clientSlug: user.clientSlug,
    name: user.name || user.username,
    mustChangePassword: Boolean(user.mustChangePassword),
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000
  });
}

export { TOKEN_SECRET };
