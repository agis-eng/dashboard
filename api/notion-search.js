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
  if (!q) return res.status(400).json({ error: 'q parameter required' });

  // Search both databases in parallel
  const [clientsR, partnersR] = await Promise.all([
    fetch(`https://api.notion.com/v1/databases/${CLIENTS_DB_ID}/query`, {
      method: 'POST', headers,
      body: JSON.stringify({
        filter: {
          or: [
            { property: 'Name', title: { contains: q } },
            { property: 'Company', rich_text: { contains: q } },
            { property: 'Email', email: { contains: q } }
          ]
        }
      })
    }),
    fetch(`https://api.notion.com/v1/databases/${PARTNERS_DB_ID}/query`, {
      method: 'POST', headers,
      body: JSON.stringify({
        filter: {
          or: [
            { property: 'Name', title: { contains: q } },
            { property: 'Company', rich_text: { contains: q } },
            { property: 'Email', email: { contains: q } }
          ]
        }
      })
    })
  ]);

  const [clientsData, partnersData] = await Promise.all([clientsR.json(), partnersR.json()]);

  const results = [
    ...(clientsData.results || []).map(p => ({
      type: 'client',
      id: p.id,
      name: p.properties.Name?.title?.[0]?.plain_text || '',
      company: p.properties.Company?.rich_text?.[0]?.plain_text || '',
      status: p.properties.Status?.status?.name || '',
      url: p.url
    })),
    ...(partnersData.results || []).map(p => ({
      type: 'partner',
      id: p.id,
      name: p.properties.Name?.title?.[0]?.plain_text || '',
      company: p.properties.Company?.rich_text?.[0]?.plain_text || '',
      status: p.properties.Status?.status?.name || '',
      url: p.url
    }))
  ];

  return res.status(200).json({ query: q, results });
}
