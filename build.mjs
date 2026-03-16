import fs from 'fs-extra';
import path from 'path';
import nunjucks from 'nunjucks';
import YAML from 'yaml';
import { format } from 'date-fns';

const root = new URL('.', import.meta.url).pathname;
const dataDir = path.join(root, 'data');
const distDir = path.join(root, 'dist');
const publicDir = path.join(root, 'public');

const loadYaml = async (fileName, key) => {
  const filePath = path.join(dataDir, fileName);
  const exists = await fs.pathExists(filePath);
  if (!exists) return key ? [] : {};
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = YAML.parse(raw) || {};
  return key ? parsed[key] || [] : parsed;
};

const slugify = (value = '') => value.toString().toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Sort by rank (ranked items first, ascending), then alphabetically
const sortByRank = (a, b) => {
  const ra = a.rank ?? Infinity;
  const rb = b.rank ?? Infinity;
  if (ra !== rb) return ra - rb;
  return (a.name || '').localeCompare(b.name || '');
};

// Calculate affiliate monthly potential
const calcPotential = (aff) => {
  if (aff.monthly_potential) return aff.monthly_potential;
  if (aff.commission_type === 'flat') {
    return (aff.commission_flat || 0) * (aff.monthly_leads || 0);
  }
  return Math.round((aff.commission_pct || 0) / 100 * (aff.avg_deal_size || 0) * (aff.monthly_leads || 0));
};

await fs.emptyDir(distDir);
await fs.copy(publicDir, path.join(distDir));
await fs.emptyDir(path.join(distDir, 'clients'));
await fs.emptyDir(path.join(distDir, 'partners'));

const env = nunjucks.configure(path.join(root, 'templates'), { autoescape: true });
env.addFilter('date', (value, fmt = "MMM d, yyyy") => {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return format(date, fmt);
});
env.addFilter('where', (arr, key, val) => (arr || []).filter(item => item[key] === val));
env.addFilter('formatNum', (val) => {
  const n = Number(val) || 0;
  return n.toLocaleString('en-US');
});

const clientsData  = await loadYaml('clients.yaml', 'clients');
const projectsData = await loadYaml('projects.yaml', 'projects');
const requestsData = await loadYaml('requests.yaml', 'requests');
const partnersData = await loadYaml('partners.yaml', 'partners');
const opportunitiesData = await loadYaml('opportunities.yaml');
const settings     = await loadYaml('settings.yaml').settings || {};
const voiceMemosRaw = await loadYaml('voice_memos.yaml', 'voice_memos');
const tasksData    = await loadYaml('tasks.yaml', 'tasks');
const callNotesRaw = await loadYaml('call-notes.yaml', 'calls');
const projectPagesData = await loadYaml('projectPages.yaml', 'projectPages');

// Group call notes by project_id and partner_id (sorted newest first)
const callsByProject = {};
const callsByPartner = {};
for (const call of callNotesRaw || []) {
  if (call.project_id) {
    if (!callsByProject[call.project_id]) callsByProject[call.project_id] = [];
    callsByProject[call.project_id].push(call);
  }
  if (call.partner_id) {
    if (!callsByPartner[call.partner_id]) callsByPartner[call.partner_id] = [];
    callsByPartner[call.partner_id].push(call);
  }
}
for (const k of Object.keys(callsByProject))
  callsByProject[k].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
for (const k of Object.keys(callsByPartner))
  callsByPartner[k].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

// Sort memos newest first
const voiceMemos = (voiceMemosRaw || [])
  .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
  .slice(0, 20);
const recentMemos = voiceMemos.slice(0, 8);

const clientsMap  = new Map(clientsData.map(c => [c.id, c]));
const projectsMap = new Map(projectsData.map(p => [p.id, p]));

const projects = projectsData
  .map(project => ({
    ...project,
    client: clientsMap.get(project.clientId) ?? { name: 'Unknown', slug: 'unknown' }
  }))
  .sort(sortByRank);

const partners = (partnersData || []).map(partner => {
  const projectIds = partner.projectIds || [];
  const featuredProjects = projectIds
    .map(id => projects.find(p => p.id === id))
    .filter(Boolean);
  return {
    ...partner,
    slug: partner.slug || slugify(partner.name || partner.id || ''),
    featuredProjects,
    projectCount: featuredProjects.length
  };
}).sort(sortByRank);

const requests = (requestsData || [])
  .filter(r => (r.status || '').toLowerCase() !== 'done')
  .map(request => {
    const project = projectsMap.get(request.projectId) ?? null;
    const client  = request.clientId
      ? clientsMap.get(request.clientId)
      : project ? clientsMap.get(project.clientId) : null;
    return {
      ...request,
      project,
      client,
      submittedAtFormatted: request.submittedAt
        ? format(new Date(request.submittedAt), 'MMM d, h:mm a') : '—'
    };
  }).sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));

// Tasks stats
const now7 = new Date(); now7.setDate(now7.getDate() + 7);
const tasksStats = {
  totalTasks:    tasksData.length,
  inProgress:    tasksData.filter(t => t.status === 'in-progress').length,
  dueThisWeek:   tasksData.filter(t => t.due_date && new Date(t.due_date) <= now7).length,
  completionPct: tasksData.length
    ? Math.round(tasksData.filter(t => t.status === 'done').length / tasksData.length * 100)
    : 0,
};

// ── Affiliate intelligence ─────────────────────────────────────────────────
const allOpportunities = [
  ...partners
    .filter(p => p.affiliate)
    .map(p => ({
      ...p.affiliate,
      source:      p.name,
      sourceType:  'partner',
      source_url:  `./partners/${p.slug}.html`,
      monthly_potential: calcPotential(p.affiliate),
    })),
  ...projects
    .filter(p => p.affiliate)
    .map(p => ({
      ...p.affiliate,
      source:      p.name,
      sourceType:  'project',
      source_url:  `./clients/${p.client?.slug || 'unknown'}.html`,
      monthly_potential: calcPotential(p.affiliate),
    })),
].sort((a, b) => (b.monthly_potential || 0) - (a.monthly_potential || 0));

const totalPotential = allOpportunities.reduce((s, o) => s + (o.monthly_potential || 0), 0)
  .toLocaleString('en-US');
const activeCount  = allOpportunities.filter(o => o.status === 'active').length;
const pendingCount = allOpportunities.filter(o => o.status !== 'active').length;

const opportunityIdeas = opportunitiesData.ideas || [];
const questionnaire = opportunitiesData.questionnaire || { title: 'Questionnaire', intro: '', questions: [] };
const outreach = opportunitiesData.outreach || {};
const outreachQuestionsBlock = (questionnaire.questions || [])
  .map((question, index) => `${index + 1}. ${question}`)
  .join('\n');
const opportunityPartnerMap = new Map(partners.map(partner => [partner.id, partner]));
const opportunityItems = (opportunitiesData.opportunities || [])
  .map(item => ({
    ...item,
    partner: opportunityPartnerMap.get(item.partnerId) || { name: item.partnerId || 'Unknown partner', slug: '' }
  }))
  .sort((a, b) => {
    const pa = a.estimatedMonthlyPotential || 0;
    const pb = b.estimatedMonthlyPotential || 0;
    if (pb !== pa) return pb - pa;
    return (a.partner?.name || '').localeCompare(b.partner?.name || '');
  });
const opportunitiesStats = {
  opportunitiesCount: opportunityItems.length,
  readyCount: opportunityItems.filter(item => ['ready-to-contact', 'active'].includes(item.status)).length,
  pipelinePotential: opportunityItems.reduce((sum, item) => sum + (item.estimatedMonthlyPotential || 0), 0),
  partnerCoverage: new Set(opportunityItems.map(item => item.partnerId).filter(Boolean)).size,
};

const stats = {
  activeProjects: projects.length,
  clientCount:    clientsData.length,
  openRequests:   requests.length,
};

const now = new Date();
const generatedAt = format(now, 'MMM d, yyyy h:mm a');

const renderPage = (template, data) => nunjucks.render(template, data);
const writePage = async (outputPath, html) => {
  const fullPath = path.join(distDir, outputPath);
  await fs.ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, html, 'utf8');
};

const clientsForSidebar = clientsData.map(client => ({
  ...client,
  projectCount: projects.filter(p => p.clientId === client.id).length,
  portalPath:   `clients/${client.slug}.html`
})).sort((a, b) => a.name.localeCompare(b.name));

// Group unmatched calls (no project or partner) by meeting name for review queue
const unmatchedCallsRaw = (callNotesRaw || []).filter(c => !c.project_id && !c.partner_id);
const unmatchedGroups = {};
for (const call of unmatchedCallsRaw) {
  const groupName = call.meeting_name || call.title || 'Unknown';
  if (!unmatchedGroups[groupName]) unmatchedGroups[groupName] = [];
  unmatchedGroups[groupName].push(call);
}
const unmatchedCallGroups = Object.entries(unmatchedGroups)
  .filter(([name]) => name !== 'Impromptu Zoom Meeting' && name !== 'Impromptu Google Meet Meeting' && name !== 'Zoom Meeting')
  .map(([name, calls]) => {
    const sorted = calls.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    return {
      name,
      calls: sorted,
      count: sorted.length,
      lastDate: sorted[0]?.date,
      recordingIds: sorted.map(c => c.recording_id),
    };
  })
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

// Attach voice memos and call notes to projects
const projectsWithMemos = projects.map(project => {
  const memos = voiceMemos.filter(m =>
    m.project_match &&
    project.name.toLowerCase().includes(m.project_match.toLowerCase())
  );
  const projectCalls = callsByProject[project.id] || [];
  return {
    ...project,
    voiceMemos: memos,
    memoCount: memos.length,
    callCount: projectCalls.length,
    lastCallDate: projectCalls.length > 0 ? projectCalls[0].date : null,
  };
});

// ── Build pages ───────────────────────────────────────────────────────────
const internalHtml = renderPage('layout.njk', {
  title: 'Project Control Room',
  subtitle: 'Internal view of active builds and experiments',
  generatedAt, basePath: './', includeChat: true, showNav: true, activeNav: 'projects',
  content: renderPage('internal.njk', {
    projects: projectsWithMemos, requests, settings, stats, generatedAt,
    clients: clientsForSidebar, recentMemos, unmatchedCallGroups
  })
});
await writePage('index.html', internalHtml);

// Tasks page
await fs.emptyDir(path.join(distDir, 'tasks'));
const tasksHtml = renderPage('layout.njk', {
  title: 'Task Board',
  subtitle: 'Active work across all projects and platforms',
  generatedAt, basePath: '../', showNav: true, activeNav: 'tasks',
  content: renderPage('tasks.njk', { tasks: tasksData, stats: tasksStats })
});
await writePage(path.join('tasks', 'index.html'), tasksHtml);

// Affiliate intelligence page
await fs.emptyDir(path.join(distDir, 'affiliate'));
const affiliateHtml = renderPage('layout.njk', {
  title: 'Affiliate Intelligence',
  subtitle: 'Commission opportunities ranked by monthly value',
  generatedAt, basePath: '../', showNav: true, activeNav: 'affiliate',
  content: renderPage('affiliate.njk', {
    opportunities: allOpportunities,
    totalPotential,
    activeCount,
    pendingCount,
    aiAnalysis: null,
  })
});
await writePage(path.join('affiliate', 'index.html'), affiliateHtml);

// Opportunities / growth pipeline page
await fs.emptyDir(path.join(distDir, 'opportunities'));
const opportunitiesHtml = renderPage('layout.njk', {
  title: 'Opportunities',
  subtitle: 'Partner growth, outreach, referral paths, and future plays',
  generatedAt, basePath: '../', showNav: true, activeNav: 'opportunities',
  content: renderPage('opportunities.njk', {
    ideas: opportunityIdeas,
    questionnaire,
    outreach: {
      ...outreach,
      emailBodyResolved: (outreach.emailBody || '')
        .replaceAll('{{name}}', '[Partner Name]')
        .replaceAll('{{questions_block}}', outreachQuestionsBlock)
    },
    opportunities: opportunityItems,
    stats: opportunitiesStats,
  })
});
await writePage(path.join('opportunities', 'index.html'), opportunitiesHtml);

if (partners.length) {
  const partnersHtml = renderPage('layout.njk', {
    title: 'Partner Network',
    subtitle: 'Strategy, delivery, and ecosystem allies',
    generatedAt, basePath: '../', showNav: true, activeNav: 'partners',
    content: renderPage('partners.njk', { partners })
  });
  await writePage(path.join('partners', 'index.html'), partnersHtml);

  for (const partner of partners) {
    const partnerCalls = (callsByPartner[partner.id] || []);
    const partnerHtml = renderPage('layout.njk', {
      title: partner.name,
      subtitle: partner.summary,
      generatedAt, basePath: '../', showNav: true, activeNav: 'partners',
      content: renderPage('partner.njk', { partner, projects: partner.featuredProjects, calls: partnerCalls, allProjects: projects })
    });
    await writePage(path.join('partners', `${partner.slug}.html`), partnerHtml);
  }
}

for (const client of clientsData) {
  const clientProjects = projects.filter(p => p.clientId === client.id);
  // Collect all Fathom calls for this client's projects
  const clientCalls = clientProjects
    .flatMap(p => callsByProject[p.id] || [])
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const html = renderPage('layout.njk', {
    title: `${client.name} portal`,
    subtitle: 'Latest builds + links',
    generatedAt, basePath: '../',
    content: renderPage('client.njk', { client, projects: clientProjects, settings, calls: clientCalls, allProjects: projects })
  });
  await writePage(path.join('clients', `${client.slug}.html`), html);
}

// Project pages
await fs.emptyDir(path.join(distDir, 'project-pages'));
const projectPagesHtml = renderPage('layout.njk', {
  title: 'Project Pages',
  subtitle: 'Live deployed apps and sites',
  generatedAt, basePath: '../', showNav: true, activeNav: 'project-pages',
  content: renderPage('project-pages.njk', { projectPages: projectPagesData })
});
await writePage(path.join('project-pages', 'index.html'), projectPagesHtml);

// Leads (shell page — data loaded client-side from /api/leads)
await fs.emptyDir(path.join(distDir, 'leads'));
const leadsHtml = renderPage('layout.njk', {
  title: 'Leads',
  subtitle: 'Inbound CRM leads from Supabase',
  generatedAt, basePath: '../', showNav: true, activeNav: 'leads',
  content: renderPage('leads.njk', {})
});
await writePage(path.join('leads', 'index.html'), leadsHtml);

console.log('Dashboard built:', distDir);
