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

  // GET /api/notion-clients — list all clients
  if (req.method === 'GET' && !slug) {
    const r = await fetch(`https://api.notion.com/v1/databases/${CLIENTS_DB_ID}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sorts: [{ property: 'Name', direction: 'ascending' }] })
    });
    const data = await r.json();
    const clients = (data.results || []).map(page => ({
      id: page.id,
      slug: slugify(page.properties.Name?.title?.[0]?.plain_text || ''),
      name: page.properties.Name?.title?.[0]?.plain_text || '',
      status: page.properties.Status?.status?.name || '',
      email: page.properties.Email?.email || '',
      company: page.properties.Company?.rich_text?.[0]?.plain_text || '',
      tags: (page.properties.Tags?.multi_select || []).map(t => t.name),
      lastContact: page.properties['Last Contact']?.date?.start || null,
      url: page.url
    }));
    return res.status(200).json(clients);
  }

  // GET /api/notion-clients?slug=xxx — get single client with page blocks
  if (req.method === 'GET' && slug) {
    // Search for matching page
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

    // Get page blocks (notes + transcripts)
    const blocksR = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children?page_size=100`, { headers });
    const blocksData = await blocksR.json();

    return res.status(200).json({
      id: page.id,
      name: page.properties.Name?.title?.[0]?.plain_text || '',
      status: page.properties.Status?.status?.name || '',
      email: page.properties.Email?.email || '',
      company: page.properties.Company?.rich_text?.[0]?.plain_text || '',
      tags: (page.properties.Tags?.multi_select || []).map(t => t.name),
      lastContact: page.properties['Last Contact']?.date?.start || null,
      blocks: blocksData.results || [],
      url: page.url
    });
  }

  // POST /api/notion-clients — append a note to a client page
  if (req.method === 'POST') {
    const { pageId, text, heading } = req.body;
    if (!pageId || !text) return res.status(400).json({ error: 'pageId and text required' });

    const children = [];
    if (heading) {
      children.push({
        object: 'block', type: 'heading_3',
        heading_3: { rich_text: [{ type: 'text', text: { content: heading } }] }
      });
    }
    children.push({
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: text } }] }
    });

    const r = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ children })
    });
    const data = await r.json();
    return res.status(r.ok ? 200 : 400).json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
