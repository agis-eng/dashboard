import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { parse, stringify } from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'public', 'screenshots');
const DIST_SCREENSHOTS_DIR = path.join(__dirname, '..', 'dist', 'screenshots');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = 'agis-eng/dashboard';
const API = 'https://api.github.com';

// 24-hour cache: skip re-capture if screenshot is fresh
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Validate URL to prevent SSRF
function isValidUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    // Block private/internal IPs
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' ||
        host.startsWith('10.') || host.startsWith('192.168.') ||
        host.startsWith('172.') || host === '[::1]' || host.endsWith('.local')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function ghGet(filePath) {
  const r = await fetch(`${API}/repos/${REPO}/contents/${filePath}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'atlas-dashboard' }
  });
  const data = await r.json();
  if (!data.content) throw new Error(`GitHub fetch failed for ${filePath}: ${data.message || JSON.stringify(data)}`);
  return { content: Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString(), sha: data.sha };
}

async function ghPut(filePath, content, sha, message) {
  const r = await fetch(`${API}/repos/${REPO}/contents/${filePath}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'atlas-dashboard'
    },
    body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), sha })
  });
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, projectId, width = 1920, height = 1080 } = req.body || {};

  if (!url) return res.status(400).json({ error: 'Missing url' });
  if (!projectId) return res.status(400).json({ error: 'Missing projectId' });
  if (!isValidUrl(url)) return res.status(400).json({ error: 'Invalid or disallowed URL' });

  const vw = Math.min(Math.max(Number(width) || 1920, 320), 3840);
  const vh = Math.min(Math.max(Number(height) || 1080, 240), 2160);

  // Ensure directories exist
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  fs.mkdirSync(DIST_SCREENSHOTS_DIR, { recursive: true });

  const timestamp = Date.now();
  const filename = `${projectId}-${timestamp}.png`;
  const filePath = path.join(SCREENSHOTS_DIR, filename);

  // Check cache: if a recent screenshot exists for this project, return it
  try {
    const existing = fs.readdirSync(SCREENSHOTS_DIR)
      .filter(f => f.startsWith(`${projectId}-`) && f.endsWith('.png'))
      .sort()
      .pop();
    if (existing) {
      const match = existing.match(/-(\d+)\.png$/);
      if (match) {
        const existingTs = Number(match[1]);
        if (timestamp - existingTs < CACHE_TTL_MS) {
          const cachedUrl = `/screenshots/${existing}`;
          return res.status(200).json({
            ok: true,
            imageUrl: cachedUrl,
            cached: true,
            message: 'Screenshot is fresh (< 24h). Returning cached version.'
          });
        }
      }
    }
  } catch { /* no cached file, proceed */ }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: vw, height: vh });

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Brief pause to let animations/lazy images settle
    await new Promise(r => setTimeout(r, 1500));

    await page.screenshot({
      path: filePath,
      type: 'png',
      fullPage: false,
    });

    await browser.close();
    browser = null;

    // Copy to dist/ so it's immediately serveable
    fs.copyFileSync(filePath, path.join(DIST_SCREENSHOTS_DIR, filename));

    // Clean up old screenshots for this project (keep only the latest)
    const allForProject = fs.readdirSync(SCREENSHOTS_DIR)
      .filter(f => f.startsWith(`${projectId}-`) && f.endsWith('.png') && f !== filename);
    for (const old of allForProject) {
      try {
        fs.unlinkSync(path.join(SCREENSHOTS_DIR, old));
        fs.unlinkSync(path.join(DIST_SCREENSHOTS_DIR, old));
      } catch { /* already gone */ }
    }

    const imageUrl = `/screenshots/${filename}`;

    // Update project's thumbnailUrl in projects.yaml via GitHub API
    if (GITHUB_TOKEN) {
      try {
        const { content, sha } = await ghGet('data/projects.yaml');
        const data = parse(content);
        const projects = data.projects || [];
        const idx = projects.findIndex(p => p.id === projectId);
        if (idx !== -1) {
          projects[idx].thumbnailUrl = imageUrl;
          const newYaml = stringify(data, { lineWidth: 0 });
          await ghPut('data/projects.yaml', newYaml, sha,
            `dashboard: update screenshot for ${projectId}`);
        }
      } catch (err) {
        console.error('Failed to update thumbnailUrl in GitHub:', err.message);
        // Non-fatal — screenshot was still captured
      }
    }

    return res.status(200).json({
      ok: true,
      imageUrl,
      filename,
      projectId,
    });
  } catch (err) {
    console.error('Screenshot capture error:', err);
    // Clean up partial file
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }

    const message = err.message.includes('timeout')
      ? 'Page load timed out (30s limit)'
      : err.message.includes('ERR_NAME_NOT_RESOLVED')
        ? 'Could not resolve hostname'
        : `Screenshot failed: ${err.message}`;

    return res.status(500).json({ error: message });
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}
