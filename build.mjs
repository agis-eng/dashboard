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

const clientsData = await loadYaml('clients.yaml', 'clients');
const projectsData = await loadYaml('projects.yaml', 'projects');
const requestsData = await loadYaml('requests.yaml', 'requests');
const partnersData = await loadYaml('partners.yaml', 'partners');
const settings = await loadYaml('settings.yaml').settings || {};

const clientsMap = new Map(clientsData.map(client => [client.id, client]));
const projectsMap = new Map(projectsData.map(project => [project.id, project]));

const projects = projectsData.map(project => ({
  ...project,
  client: clientsMap.get(project.clientId) ?? { name: 'Unknown', slug: 'unknown' }
}));

const partners = (partnersData || []).map(partner => {
  const projectIds = partner.projectIds || [];
  const featuredProjects = projectIds
    .map(id => projects.find(project => project.id === id))
    .filter(Boolean);
  return {
    ...partner,
    slug: partner.slug || slugify(partner.name || partner.id || ''),
    featuredProjects,
    projectCount: featuredProjects.length
  };
}).sort((a, b) => a.name.localeCompare(b.name));

const requests = (requestsData || [])
  .filter(request => (request.status || '').toLowerCase() !== 'done')
  .map(request => {
  const project = projectsMap.get(request.projectId) ?? null;
  const client = request.clientId ? clientsMap.get(request.clientId) : project ? clientsMap.get(project.clientId) : null;
  return {
    ...request,
    project,
    client,
    submittedAtFormatted: request.submittedAt ? format(new Date(request.submittedAt), 'MMM d, h:mm a') : '—'
  };
}).sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));

const stats = {
  activeProjects: projects.length,
  clientCount: clientsData.length,
  openRequests: requests.length,
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
  portalPath: `clients/${client.slug}.html`
})).sort((a, b) => a.name.localeCompare(b.name));

const internalHtml = renderPage('layout.njk', {
  title: 'Project Control Room',
  subtitle: 'Internal view of active builds and experiments',
  generatedAt,
  basePath: './',
  includeChat: true,
  showNav: true,
  activeNav: 'projects',
  content: renderPage('internal.njk', { projects, requests, settings, stats, generatedAt, clients: clientsForSidebar })
});
await writePage('index.html', internalHtml);

if (partners.length) {
  const partnersHtml = renderPage('layout.njk', {
    title: 'Partner Network',
    subtitle: 'Strategy, delivery, and ecosystem allies',
    generatedAt,
    basePath: '../',
    showNav: true,
    activeNav: 'partners',
    content: renderPage('partners.njk', { partners })
  });
  await writePage(path.join('partners', 'index.html'), partnersHtml);

  for (const partner of partners) {
    const partnerHtml = renderPage('layout.njk', {
      title: partner.name,
      subtitle: partner.summary,
      generatedAt,
      basePath: '../',
      showNav: true,
      activeNav: 'partners',
      content: renderPage('partner.njk', { partner, projects: partner.featuredProjects })
    });
    await writePage(path.join('partners', `${partner.slug}.html`), partnerHtml);
  }
}

for (const client of clientsData) {
  const clientProjects = projects.filter(p => p.clientId === client.id);
  const html = renderPage('layout.njk', {
    title: `${client.name} portal`,
    subtitle: 'Latest builds + links',
    generatedAt,
    basePath: '../',
    content: renderPage('client.njk', { client, projects: clientProjects, settings })
  });
  await writePage(path.join('clients', `${client.slug}.html`), html);
}

console.log('Dashboard built:', distDir);
