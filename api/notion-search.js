const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const CLIENTS_DB_ID = '31e59b38371a805ba925e0aed72302ea';
const PARTNERS_DB_ID = '31e59b38371a8089ae0fc758b8d8fc10';

const headers = {
  'Authorization': `Bearer ${NOTION_TOKEN}`,
  'Content-Type': 'application/json',
  'Notion-Version': '2022-06-28'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.status(400).json({ error: 'q must be at least 2 characters' });

  // Run property search (structured fields) + Notion full-text search (blocks/content) in parallel
  const [clientsR, partnersR, fullTextR] = await Promise.all([
    // Property search — clients
    fetch(`https://api.notion.com/v1/databases/${CLIENTS_DB_ID}/query`, {
      method: 'POST', headers,
      body: JSON.stringify({
        filter: {
          or: [
            { property: 'Name',    title:     { contains: q } },
            { property: 'Company', rich_text: { contains: q } },
            { property: 'Email',   email:     { contains: q } }
          ]
        }
      })
    }),
    // Property search — partners
    fetch(`https://api.notion.com/v1/databases/${PARTNERS_DB_ID}/query`, {
      method: 'POST', headers,
      body: JSON.stringify({
        filter: {
          or: [
            { property: 'Name',    title:     { contains: q } },
            { property: 'Company', rich_text: { contains: q } },
            { property: 'Email',   email:     { contains: q } }
          ]
        }
      })
    }),
    // Full-text search — searches block content (notes, transcripts) across both DBs
    fetch('https://api.notion.com/v1/search', {
      method: 'POST', headers,
      body: JSON.stringify({
        query: q,
        filter: { value: 'page', property: 'object' },
        page_size: 20
      })
    })
  ]);

  const [clientsData, partnersData, fullTextData] = await Promise.all([
    clientsR.json(), partnersR.json(), fullTextR.json()
  ]);

  // Build a set of page IDs already found by property search
  const propResultIds = new Set();

  const clientResults = (clientsData.results || []).map(p => {
    propResultIds.add(p.id);
    return {
      type: 'client',
      id: p.id,
      slug: slugify(p.properties.Name?.title?.[0]?.plain_text || ''),
      name: p.properties.Name?.title?.[0]?.plain_text || '',
      company: p.properties.Company?.rich_text?.[0]?.plain_text || '',
      email: p.properties.Email?.email || '',
      status: p.properties.Status?.status?.name || '',
      matchSource: 'properties'
    };
  });

  const partnerResults = (partnersData.results || []).map(p => {
    propResultIds.add(p.id);
    return {
      type: 'partner',
      id: p.id,
      slug: slugify(p.properties.Name?.title?.[0]?.plain_text || ''),
      name: p.properties.Name?.title?.[0]?.plain_text || '',
      company: p.properties.Company?.rich_text?.[0]?.plain_text || '',
      email: p.properties.Email?.email || '',
      status: p.properties.Status?.status?.name || '',
      matchSource: 'properties'
    };
  });

  // Full-text results — only add if not already captured by property search
  // Determine type by checking if parent database matches clients or partners DB
  const fullTextResults = (fullTextData.results || [])
    .filter(p => !propResultIds.has(p.id))
    .map(p => {
      const parentDbId = p.parent?.database_id?.replace(/-/g, '');
      const isClient = parentDbId === CLIENTS_DB_ID.replace(/-/g, '');
      const isPartner = parentDbId === PARTNERS_DB_ID.replace(/-/g, '');
      if (!isClient && !isPartner) return null;
      return {
        type: isClient ? 'client' : 'partner',
        id: p.id,
        slug: slugify(p.properties.Name?.title?.[0]?.plain_text || ''),
        name: p.properties.Name?.title?.[0]?.plain_text || '',
        company: p.properties.Company?.rich_text?.[0]?.plain_text || '',
        email: p.properties.Email?.email || '',
        status: p.properties.Status?.status?.name || '',
        matchSource: 'content'  // matched inside notes or transcripts
      };
    })
    .filter(Boolean);

  const results = [...clientResults, ...partnerResults, ...fullTextResults];

  return res.status(200).json({
    query: q,
    total: results.length,
    results
  });
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
