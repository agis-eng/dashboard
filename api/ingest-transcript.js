/**
 * POST /api/ingest-transcript
 * Fathom webhook handler — receives call summary + transcript, matches
 * participants to Notion client/partner pages, saves as a toggle block.
 * Also sends a Telegram notification on success or unmatched calls.
 *
 * Env vars required:
 *   NOTION_TOKEN         — Clawdbot integration token
 *   FATHOM_WEBHOOK_SECRET — from Fathom Settings → Webhooks (optional but recommended)
 *   TELEGRAM_BOT_TOKEN   — OpenClaw bot token
 *   TELEGRAM_CHAT_ID     — Erik's personal DM chat ID
 */

import crypto from 'crypto';

const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const CLIENTS_DB_ID = '31e59b38371a805ba925e0aed72302ea';
const PARTNERS_DB_ID = '31e59b38371a8089ae0fc758b8d8fc10';
const FATHOM_SECRET = process.env.FATHOM_WEBHOOK_SECRET || '';
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1472931691';

const notionHeaders = {
  'Authorization': `Bearer ${NOTION_TOKEN}`,
  'Content-Type': 'application/json',
  'Notion-Version': '2022-06-28'
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // ── Verify Fathom signature (if secret is set) ────────────────────────────
  if (FATHOM_SECRET) {
    const signature = req.headers['x-fathom-signature'] || req.headers['x-hub-signature-256'] || '';
    const body = JSON.stringify(req.body);
    const expected = 'sha256=' + crypto.createHmac('sha256', FATHOM_SECRET).update(body).digest('hex');
    if (signature !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  // ── Parse Fathom payload ──────────────────────────────────────────────────
  // Fathom sends: { event, payload: { id, title, created_at, ended_at, attendees, summary, transcript, action_items } }
  // Some plans use different field names — we handle both formats.
  const payload = req.body?.payload || req.body;

  const meetingTitle = payload.title || payload.meeting_title || 'Untitled call';
  const meetingDate = (payload.ended_at || payload.created_at || new Date().toISOString()).split('T')[0];
  const attendees = payload.attendees || payload.participants || [];
  const summary = payload.summary || payload.ai_notes?.summary || '';
  const transcript = payload.transcript || payload.full_transcript || '';
  const actionItems = (payload.action_items || payload.ai_notes?.action_items || [])
    .map(a => (typeof a === 'string' ? a : a.text || a.description || '')).filter(Boolean);

  // ── Match attendees to Notion pages ────────────────────────────────────────
  const attendeeEmails = attendees
    .map(a => (a.email || '').toLowerCase())
    .filter(e => e && !e.includes('manifestbot.ai') && !e.includes('manifestic.com'));

  const attendeeNames = attendees
    .map(a => a.name || a.full_name || '')
    .filter(n => n);

  const matches = await findNotionPages(attendeeEmails, attendeeNames);

  // ── Build transcript block content ────────────────────────────────────────
  const blockContent = buildTranscriptContent({ summary, transcript, actionItems, attendees, meetingDate, meetingTitle });

  // ── Save to each matched page ──────────────────────────────────────────────
  const saved = [];
  const failed = [];

  for (const match of matches) {
    try {
      // Append transcript toggle block
      const r = await fetch(`https://api.notion.com/v1/blocks/${match.pageId}/children`, {
        method: 'PATCH',
        headers: notionHeaders,
        body: JSON.stringify({ children: [blockContent] })
      });
      if (!r.ok) throw new Error(`Notion API ${r.status}`);

      // Update Last Call date and increment Call Count
      await updateCallStats(match.pageId, match.dbId, meetingDate);

      saved.push(match.name);
    } catch (err) {
      failed.push({ name: match.name, error: err.message });
    }
  }

  // ── Telegram notification ──────────────────────────────────────────────────
  if (TELEGRAM_TOKEN) {
    await sendTelegram(matches, saved, failed, { meetingTitle, meetingDate, attendees, actionItems });
  }

  return res.status(200).json({
    ok: true,
    matched: matches.length,
    saved: saved.length,
    savedTo: saved,
    failed
  });
}

// ── Find matching Notion pages for attendee emails / names ─────────────────
async function findNotionPages(emails, names) {
  const matches = [];
  const seen = new Set();

  for (const dbId of [CLIENTS_DB_ID, PARTNERS_DB_ID]) {
    const dbType = dbId === CLIENTS_DB_ID ? 'client' : 'partner';

    // Search by email first (most reliable)
    for (const email of emails) {
      const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
        method: 'POST',
        headers: notionHeaders,
        body: JSON.stringify({
          filter: { property: 'Email', email: { equals: email } }
        })
      });
      const data = await r.json();
      for (const page of data.results || []) {
        if (!seen.has(page.id)) {
          seen.add(page.id);
          matches.push({
            pageId: page.id,
            dbId,
            type: dbType,
            name: page.properties.Name?.title?.[0]?.plain_text || email
          });
        }
      }
    }

    // Fall back to name search if no email match found yet
    if (matches.length === 0) {
      for (const name of names) {
        const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
          method: 'POST',
          headers: notionHeaders,
          body: JSON.stringify({
            filter: { property: 'Name', title: { contains: name.split(' ')[0] } }
          })
        });
        const data = await r.json();
        for (const page of data.results || []) {
          if (!seen.has(page.id)) {
            seen.add(page.id);
            matches.push({
              pageId: page.id,
              dbId,
              type: dbType,
              name: page.properties.Name?.title?.[0]?.plain_text || name
            });
          }
        }
      }
    }
  }

  return matches;
}

// ── Update Last Call date + increment Call Count ────────────────────────────
async function updateCallStats(pageId, dbId, date) {
  // Get current call count
  const r = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: notionHeaders });
  const page = await r.json();
  const currentCount = page.properties?.['Call Count']?.number || 0;

  await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: notionHeaders,
    body: JSON.stringify({
      properties: {
        'Last Call': { date: { start: date } },
        'Call Count': { number: currentCount + 1 }
      }
    })
  });
}

// ── Build the Notion toggle block ──────────────────────────────────────────
function buildTranscriptContent({ summary, transcript, actionItems, attendees, meetingDate, meetingTitle }) {
  const attendeeList = attendees.map(a => a.name || a.email || '').filter(Boolean).join(', ');
  const children = [];

  // Attendees
  if (attendeeList) {
    children.push({
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: `👥 Attendees: ${attendeeList}` }, annotations: { bold: true } }] }
    });
  }

  // Summary
  if (summary) {
    children.push(
      { object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: 'Summary' } }] } },
      { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: summary } }] } }
    );
  }

  // Action items
  if (actionItems.length > 0) {
    children.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: 'Action Items' } }] } });
    for (const item of actionItems) {
      children.push({ object: 'block', type: 'to_do', to_do: { rich_text: [{ type: 'text', text: { content: item } }], checked: false } });
    }
  }

  // Full transcript (collapsible inside the outer toggle)
  if (transcript) {
    // Chunk transcript into 2000-char blocks (Notion rich_text limit)
    const chunks = [];
    for (let i = 0; i < transcript.length; i += 1900) {
      chunks.push(transcript.slice(i, i + 1900));
    }
    children.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: 'Full Transcript' } }] } });
    for (const chunk of chunks) {
      children.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: chunk } }] } });
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

// ── Telegram notification ─────────────────────────────────────────────────
async function sendTelegram(matches, saved, failed, { meetingTitle, meetingDate, attendees, actionItems }) {
  let msg;

  if (saved.length > 0) {
    const actionSummary = actionItems.length > 0
      ? `\n\n✅ Action items: ${actionItems.slice(0, 3).join(' · ')}${actionItems.length > 3 ? ` +${actionItems.length - 3} more` : ''}`
      : '';
    msg = `📞 Fathom transcript saved\n${meetingDate} — ${meetingTitle}\nAdded to: ${saved.join(', ')}${actionSummary}`;
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
