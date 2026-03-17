/**
 * check-vercel-functions.mjs
 *
 * Vercel Hobby plan allows a maximum of 12 serverless functions.
 * This script counts the .js files in api/ that will actually be
 * deployed (respecting .vercelignore), and fails the build early
 * with a clear message if the limit is exceeded.
 *
 * Run automatically as part of the Vercel build command:
 *   "buildCommand": "node scripts/check-vercel-functions.mjs && npm run build"
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root    = path.dirname(fileURLToPath(import.meta.url), '..');
const apiDir  = path.join(root, '..', 'api');
const ignoreFile = path.join(root, '..', '.vercelignore');
const LIMIT   = 12;

// Parse .vercelignore into a simple list of prefixes to skip
const ignored = fs.existsSync(ignoreFile)
  ? fs.readFileSync(ignoreFile, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
  : [];

const isIgnored = (relPath) =>
  ignored.some(pattern => relPath.startsWith(pattern.replace(/\/$/, '')));

// Walk api/ and collect .js files not covered by .vercelignore
function walk(dir, base = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files   = [];
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (isIgnored(`api/${rel}`)) continue;
    if (entry.isDirectory()) {
      files.push(...walk(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.js')) {
      files.push(`api/${rel}`);
    }
  }
  return files;
}

const functions = walk(apiDir);
const count     = functions.length;

console.log(`\nVercel function check: ${count} / ${LIMIT} functions`);
functions.forEach(f => console.log(`  ✓ ${f}`));

if (count > LIMIT) {
  console.error(`
\x1b[31m╔══════════════════════════════════════════════════════════════╗
║  VERCEL BUILD BLOCKED — function limit exceeded               ║
╠══════════════════════════════════════════════════════════════╣
║  Hobby plan allows ${LIMIT} serverless functions.                ║
║  You currently have ${String(count).padEnd(2)} deployed functions.              ║
║                                                              ║
║  Fix options:                                                ║
║   1. Add the new file's path to .vercelignore (keeps it      ║
║      on Railway only)                                        ║
║   2. Merge two related handlers into one file                ║
║   3. Upgrade to Vercel Pro (unlimited functions)             ║
╚══════════════════════════════════════════════════════════════╝\x1b[0m
`);
  process.exit(1);
}

console.log('  ✅ Within limit — proceeding with build\n');
