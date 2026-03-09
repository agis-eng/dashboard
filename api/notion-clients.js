const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const CLIENTS_DB_ID = '31e59b38371a805ba925e0aed72302ea';

const headers = {
  'Authorization': `Bearer ${NOTION_TOKEN}`,
  'Content-Type': 'application/json',
  'Notion-Version': '2022-06-28'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { slug } = req.query;

  // ── GET /api/notion-clients ── list all clients ──────────────────────────
  if (req.method === 'GET' && !slug) {
    const r = await fetch(`https://api.notion.com/v1/databases/${CLIENTS_DB_ID}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sorts: [{ property: 'Name', direction: 'ascending' }] })
    });
    const data = await r.json();
    const clients = (data.results || []).map(page => mapClientProps(page));
    return res.status(200).json(clients);
  }

  // ── GET /api/notion-clients?slug=xxx ── single client + blocks ───────────
  if (req.method === 'GET' && slug) {
    const r = await fetch(`https://api.notion.com/v1/databases/${CLIENTS_DB_ID}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({})
    });
    const data = await r.json();
    const page = (data.results || []).find(p =>
      slugify(p.properties.Name?.title?.[0]?.plain_text || '') === slug
    );
    if (!page) return res.status(404).json({ error: 'Client not found' });

    const blocksData = await fetchAllBlocks(page.id);
    const { notes, transcripts } = parseBlocks(blocksData);

    return res.status(200).json({
      ...mapClientProps(page),
      notes,
      transcripts
    });
  }

  // ── POST /api/notion-clients ── add a note or transcript block ───────────
  if (req.method === 'POST') {
    const { pageId, slug: bodySlug, text, author, type = 'note' } = req.body;

    // Resolve page ID from slug if pageId not provided directly
    let resolvedPageId = pageId;
    if (!resolvedPageId && bodySlug) {
      const r = await fetch(`https://api.notion.com/v1/databases/${CLIENTS_DB_ID}/query`, {
        method: 'POST', headers, body: JSON.stringify({})
      });
      const data = await r.json();
      const page = (data.results || []).find(p =>
        slugify(p.properties.Name?.title?.[0]?.plain_text || '') === bodySlug
      );
      if (!page) return res.status(404).json({ error: 'Client not found' });
      resolvedPageId = page.id;
    }

    if (!resolvedPageId || !text) {
      return res.status(400).json({ error: 'pageId (or slug) and text required' });
    }

    const children = buildNoteBlocks({ text, author, type });
    const r = await fetch(`https://api.notion.com/v1/blocks/${resolvedPageId}/children`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ children })
    });
    const result = await r.json();
    return res.status(r.ok ? 200 : 400).json(result);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function mapClientProps(page) {
  return {
    id: page.id,
    slug: slugify(page.properties.Name?.title?.[0]?.plain_text || ''),
    name: page.properties.Name?.title?.[0]?.plain_text || '',
    status: page.properties.Status?.status?.name || '',
    email: page.properties.Email?.email || '',
    phone: page.properties.Phone?.phone_number || '',
    company: page.properties.Company?.rich_text?.[0]?.plain_text || '',
    website: page.properties.Website?.url || '',
    linkedin: page.properties.LinkedIn?.url || '',
    industry: page.properties.Industry?.select?.name || '',
    tags: (page.properties.Tags?.multi_select || []).map(t => t.name),
    lastContact: page.properties['Last Contact']?.date?.start || null,
    lastCall: page.properties['Last Call']?.date?.start || null,
    callCount: page.properties['Call Count']?.number || 0,
    url: page.url
  };
}

async function fetchAllBlocks(pageId) {
  const blocks = [];
  let cursor;
  do {
    const url = `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const r = await fetch(url, { headers });
    const data = await r.json();
    blocks.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return blocks;
}

function parseBlocks(blocks) {
  const notes = [];
  const transcripts = [];
  let currentSection = null;
  let currentItem = null;

  for (const block of blocks) {
    const text = extractText(block);

    // Detect transcript toggles — "📞 Call —" prefix
    if (block.type === 'toggle' && text.startsWith('📞')) {
      currentSection = 'transcript';
      currentItem = { title: text, date: extractDate(text), content: [], id: block.id };
      transcripts.push(currentItem);
      continue;
    }

    // Detect note callouts — "📝 Note —" prefix
    if ((block.type === 'callout' || block.type === 'heading_3') && text.startsWith('📝')) {
      currentSection = 'note';
      currentItem = { title: text, date: extractDate(text), author: extractAuthor(text), content: [], id: block.id };
      notes.push(currentItem);
      continue;
    }

    // Attach content to current item if we're inside a section
    if (currentItem && text) {
      currentItem.content.push(text);
    }
  }

  // Sort newest first
  notes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  transcripts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return { notes, transcripts };
}

function buildNoteBlocks({ text, author, type }) {
  const now = new Date().toISOString().split('T')[0];
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });

  if (type === 'transcript') {
    // Transcript: toggle block so it stays collapsed
    return [{
      object: 'block',
      type: 'toggle',
      toggle: {
        rich_text: [{ type: 'text', text: { content: `📞 Call — ${now}${author ? ` — ${author}` : ''}` } }],
        children: [
          { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: text } }] } }
        ]
      }
    }];
  }

  // Note: callout block so it's visually distinct
  return [{
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: [{ type: 'text', text: { content: `📝 Note — ${now} ${time}${author ? ` (by ${author})` : ''}` } }],
      icon: { emoji: '📝' },
      children: [
        { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: text } }] } }
      ]
    }
  }];
}

function extractText(block) {
  const rt = block[block.type]?.rich_text || block[block.type]?.title || [];
  return rt.map(t => t.plain_text || '').join('');
}

function extractDate(str) {
  const m = str.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : '';
}

function extractAuthor(str) {
  const m = str.match(/by\s+(.+?)\)/);
  return m ? m[1] : '';
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
