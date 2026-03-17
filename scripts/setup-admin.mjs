/**
 * Atlas Dashboard - One-time Admin Setup
 *
 * Usage:
 *   UPSTASH_REDIS_REST_URL="https://..." \
 *   UPSTASH_REDIS_REST_TOKEN="..." \
 *   node scripts/setup-admin.mjs
 *
 * Get your Upstash credentials from: https://console.upstash.com
 * Click your Redis database → REST API section
 */

import crypto from 'crypto';

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TOKEN_SECRET  = process.env.TOKEN_SECRET || 'atlas-dashboard-secret-2026';
const ADMIN_PASS    = process.env.ADMIN_PASSWORD || 'Manifest777$';

if (!UPSTASH_URL || !UPSTASH_TOKEN) {
  console.error(`
❌  Missing Upstash credentials.

Run like this:
  UPSTASH_REDIS_REST_URL="https://your-db.upstash.io" \\
  UPSTASH_REDIS_REST_TOKEN="your-token-here" \\
  node scripts/setup-admin.mjs

Get these from: https://console.upstash.com → your Redis DB → REST API
`);
  process.exit(1);
}

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

async function redisSet(key, value) {
  const res = await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(JSON.stringify(value)),
  });
  return res.json();
}

async function redisGet(key) {
  const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const data = await res.json();
  if (!data.result) return null;
  try { return JSON.parse(data.result); } catch { return data.result; }
}

console.log('🔧 Atlas Dashboard Admin Setup\n');

// Check if admin already exists
const existing = await redisGet('atlas:users:admin');
if (existing) {
  console.log('ℹ️  Admin user already exists in Redis. Overwriting...');
}

const user = {
  username: 'admin',
  passwordHash: sha256(ADMIN_PASS),
  clientSlug: 'admin',
  name: 'Erik (Admin)',
  mustChangePassword: false,
};

const result = await redisSet('atlas:users:admin', user);

if (result.result === 'OK') {
  console.log('✅  Admin user created in Redis!\n');
  console.log('─'.repeat(60));
  console.log('Add these to Vercel → Settings → Environment Variables:\n');
  console.log(`TOKEN_SECRET=${TOKEN_SECRET}`);
  console.log(`UPSTASH_REDIS_REST_URL=${UPSTASH_URL}`);
  console.log(`UPSTASH_REDIS_REST_TOKEN=${UPSTASH_TOKEN}`);
  console.log('─'.repeat(60));
  console.log('\nThen log in at:');
  console.log('  https://atlas-dashboard-psi.vercel.app/login.html');
  console.log('  Username: admin');
  console.log(`  Password: ${ADMIN_PASS}`);
  console.log('\n✅  Done!');
} else {
  console.error('❌  Failed to write to Redis:', result);
  process.exit(1);
}
