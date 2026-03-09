/**
 * POST /api/ingest-transcript
 * Fathom webhook handler — receives call summary + transcript, matches
 * participants to Notion client/partner pages, saves as a toggle block.
 *
 * Fathom uses Svix for webhook delivery. Signature verification uses:
 *   webhook-id        — unique message ID
 *   webhook-timestamp — Unix timestamp (seconds)
 *   webhook-signature — space-separated list of "v1,<base64>" signatures
 *
 * Env vars required:
 *   NOTION_TOKEN           — Clawdbot integration token
 *   FATHOM_WEBHOOK_SECRET  — whsec_... value from Fathom → Settings → Webhooks
 *   TELEGRAM_BOT_TOKEN     — OpenClaw bot token
 *   TELEGRAM_CHAT_ID       — Erik's personal DM chat ID (default: 1472931691)
 */

import crypto from 'crypto';

const NOTION_TOKEN    = process.env.NOTION_TOKEN || '';
const CLIENTS_DB_ID  = '31e59b38371a805ba925e0aed72302ea';
const PARTNERS_DB_ID = '31e59b38371a8089ae0fc758b8d8fc10';
const FATHOM_SECRET  = process.env.FATHOM_WEBHOOK_SECRET || '';
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1472931691';

// Vercel: disable body parser so we can read raw bytes for signature verification
export const config = { api: { bodyParser: false } };

const notionHeaders = {
  'Authorization': `Bearer ${NOTION_TOKEN}`,
  'Content-Type': 'application/json',
  'Notion-Version': '2022-06-28'
};

// ── Read raw body from stream ────────────────────────────────────────────────
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── Svix signature verification ─────────────────────────────────────────────
// Spec: https://docs.svix.com/receiving/verifying-payloads/how
function verifySvixSignature(rawBody, headers, secret) {
  const msgId        = headers['webhook-id'];
  const msgTimestamp = headers['webhook-timestamp'];
  const msgSignature = headers['webhook-signature'];

  if (!msgId || !msgTimestamp || !msgSignature) return false;

  // Reject if timestamp is outside ±5 minute tolerance
  const ts = parseInt(msgTimestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  // Signed content = "{webhook-id}.{webhook-timestamp}.{raw-body}"
  const toSign = `${msgId}.${msgTimestamp}.${rawBody.toString('utf8')}`;

  // Decode secret: strip "whsec_" prefix then base64-decode
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');

  // Compute expected signature
  const computed = crypto.createHmac('sha256', secretBytes).update(toSign).digest('base64');

  // webhook-signature may contain multiple space-separated "v1,<base64>" entries
  return msgSignature.split(' ').some(sig => {
    if (!sig.startsWith('v1,')) return false;
    return crypto.timingSafeEqual(
      Buffer.from(sig.slice(3)),
      Buffer.from(computed)
    );
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Read raw body first (needed for signature check)
  const rawBody = await getRawBody(req);

  // ── Verify Svix signature ────────────────────────────────────────────────
  if (FATHOM_SECRET) {
    const valid = verifySvixSignature(rawBody, req.headers, FATHOM_SECRET);
    if (!valid) {
      console.error('Fathom webhook: invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  // ── Parse JSON body ──────────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Fathom payload structure:
  //   { event: "call.completed", payload: { id, title, ended_at, attendees, summary, transcript, action_items } }
  const payload = body?.payload || body;

  const meetingTitle = payload.title || payload.meeting_title || 'Untitled call';
  const meetingDate  = (payload.ended_at || payload.created_at || new Date().toISOString()).split('T')[0];
  const attendees    = payload.attendees || payload.participants || [];
  const summary      = payload.summary || payload.ai_notes?.summary || '';
  const transcript   = payload.transcript || payload.full_transcript || '';
  const actionItems  = (payload.action_items || payload.ai_notes?.action_items || [])
    .map(a => (typeof a === 'string' ? a : a.text || a.description || '')).filter(Boolean);

  // Fathom recording URL (if provided)
  const recordingUrl = payload.recording_url || payload.video_url || payload.url || '';

  // ── Match attendees to Notion pages ────────────────────────────────────────
  const attendeeEmails = attendees
    .map(a => (a.email || '').toLowerCase())
    .filter(e => e && !e.includes('manifestbot.ai') && !e.includes('manifestic.com'));

  const attendeeNames = attendees
    .map(a => a.name || a.full_name || '').filter(Boolean);

  const matches = await findNotionPages(attendeeEmails, attendeeNames);

  // ── Build transcript block ─────────────────────────────────────────────────
  const blockContent = buildTranscriptContent({
    summary, transcript, actionItems, attendees,
    meetingDate, meetingTitle, recordingUrl
  });

  // ── Save to each matched Notion page ──────────────────────────────────────
  const saved  = [];
  const failed = [];

  for (const match of matches) {
    try {
      const r = await fetch(`https://api.notion.com/v1/blocks/${match.pageId}/children`, {
        method: 'PATCH',
        headers: notionHeaders,
        body: JSON.stringify({ children: [blockContent] })
      });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`Notion ${r.status}: ${err}`);
      }
      await updateCallStats(match.pageId, meetingDate);
      saved.push(match.name);
    } catch (err) {
      console.error(`Failed to save to ${match.name}:`, err.message);
      failed.push({ name: match.name, error: err.message });
    }
  }

  // ── Telegram notification ──────────────────────────────────────────────────
  if (TELEGRAM_TOKEN) {
    await sendTelegram(matches, saved, failed, { meetingTitle, meetingDate, attendees, actionItems, recordingUrl });
  }

  return res.status(200).json({ ok: true, matched: matches.length, saved: saved.length, savedTo: saved, failed });
}

// ── Find matching Notion pages for attendee emails / names ──────────────────
async function findNotionPages(emails, names) {
  const matches = [];
  const seen    = new Set();

  for (const dbId of [CLIENTS_DB_ID, PARTNERS_DB_ID]) {
    const dbType = dbId === CLIENTS_DB_ID ? 'client' : 'partner';

    // Email match (most reliable)
    for (const email of emails) {
      const r    = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
        method: 'POST', headers: notionHeaders,
        body: JSON.stringify({ filter: { property: 'Email', email: { equals: email } } })
      });
      const data = await r.json();
      for (const page of data.results || []) {
        if (!seen.has(page.id)) {
          seen.add(page.id);
          matches.push({ pageId: page.id, dbId, type: dbType, name: page.properties.Name?.title?.[0]?.plain_text || email });
        }
      }
    }

    // First-name fallback if no email match
    if (matches.length === 0) {
      for (const name of names) {
        const r    = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
          method: 'POST', headers: notionHeaders,
          body: JSON.stringify({ filter: { property: 'Name', title: { contains: name.split(' ')[0] } } })
        });
        const data = await r.json();
        for (const page of data.results || []) {
          if (!seen.has(page.id)) {
            seen.add(page.id);
            matches.push({ pageId: page.id, dbId, type: dbType, name: page.properties.Name?.title?.[0]?.plain_text || name });
          }
        }
      }
    }
  }

  return matches;
}

// ── Update Last Call date + increment Call Count ─────────────────────────────
async function updateCallStats(pageId, date) {
  const r    = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: notionHeaders });
  const page = await r.json();
  const currentCount = page.properties?.['Call Count']?.number || 0;

  await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: notionHeaders,
    body: JSON.stringify({
      properties: {
        'Last Call':  { date: { start: date } },
        'Call Count': { number: currentCount + 1 }
      }
    })
  });
}

// ── Build the Notion toggle block ────────────────────────────────────────────
function buildTranscriptContent({ summary, transcript, actionItems, attendees, meetingDate, meetingTitle, recordingUrl }) {
  const attendeeList = attendees.map(a => a.name || a.email || '').filter(Boolean).join(', ');
  const children     = [];

  // Attendees line
  if (attendeeList) {
    children.push({
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: `👥 Attendees: ${attendeeList}` }, annotations: { bold: true } }] }
    });
  }

  // Recording link
  if (recordingUrl) {
    children.push({
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: [
        { type: 'text', text: { content: '🎥 Recording: ' }, annotations: { bold: true } },
        { type: 'text', text: { content: recordingUrl, link: { url: recordingUrl } } }
      ]}
    });
  }

  // Summary
  if (summary) {
    children.push(
      { object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: 'Summary' } }] } },
      { object: 'block', type: 'paragraph',  paragraph:  { rich_text: [{ type: 'text', text: { content: summary } }] } }
    );
  }

  // Action items as checkboxes
  if (actionItems.length > 0) {
    children.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: 'Action Items' } }] } });
    for (const item of actionItems) {
      children.push({ object: 'block', type: 'to_do', to_do: { rich_text: [{ type: 'text', text: { content: item } }], checked: false } });
    }
  }

  // Full transcript — chunked at 1900 chars (Notion rich_text limit is 2000)
  if (transcript) {
    children.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: 'Full Transcript' } }] } });
    for (let i = 0; i < transcript.length; i += 1900) {
      children.push({
        object: 'block', type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: transcript.slice(i, i + 1900) } }] }
      });
    }
  }

  return {
    object: 'block',
    type: 'toggle',
    toggle: {
      rich_text: [{ type: 'text', text: { content: `📞 Call — ${meetingDate} — ${meetingTitle}` } }],
      children
    }
  };
}

// ── Telegram notification ─────────────────────────────────────────────────────
async function sendTelegram(matches, saved, failed, { meetingTitle, meetingDate, attendees, actionItems, recordingUrl }) {
  let msg;

  if (saved.length > 0) {
    const actionSummary = actionItems.length > 0
      ? `\n✅ Actions: ${actionItems.slice(0, 3).join(' · ')}${actionItems.length > 3 ? ` +${actionItems.length - 3} more` : ''}`
      : '';
    const recLink = recordingUrl ? `\n🎥 ${recordingUrl}` : '';
    msg = `📞 Fathom transcript saved\n${meetingDate} — ${meetingTitle}\nAdded to: ${saved.join(', ')}${actionSummary}${recLink}`;
  } else {
    const attendeeList = attendees.map(a => a.name || a.email || '').filter(Boolean).join(', ');
    msg = `⚠️ Fathom transcript not matched\n${meetingDate} — ${meetingTitle}\nParticipants: ${attendeeList}\nAdd them to Notion Clients or Partners to enable auto-matching.`;
  }

  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg })
  }).catch(() => {});
}
