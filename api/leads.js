/**
 * GET /api/leads
 *
 * Fetches leads from Supabase and returns them as JSON.
 *
 * Query params:
 *   source_tag  — filter by source_tag (e.g. 'automateiq', 'memoryforge')
 *   status      — filter by status (e.g. 'new', 'contacted')
 *   limit       — max rows to return (default 200)
 *
 * Env vars required:
 *   SUPABASE_URL      — your Supabase project URL
 *   SUPABASE_ANON_KEY — your Supabase anon/public key
 */

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.' });
  }

  const { source_tag, status, limit = '200' } = req.query;

  // Build Supabase REST query
  const params = new URLSearchParams({
    select: 'id,name,email,phone,source_tag,status,notes,created_at',
    order:  'created_at.desc',
    limit:  String(parseInt(limit, 10) || 200),
  });

  if (source_tag) params.append('source_tag', `eq.${source_tag}`);
  if (status)     params.append('status',     `eq.${status}`);

  const url = `${SUPABASE_URL}/rest/v1/leads?${params.toString()}`;

  try {
    const response = await fetch(url, {
      headers: {
        apikey:        SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer:        'return=representation',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `Supabase error: ${text}` });
    }

    const leads = await response.json();
    return res.status(200).json({ leads });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
