import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const root = fileURLToPath(new URL('.', import.meta.url));
const distDir = path.join(root, 'dist');
const defaultSlug = 'atlas-dashboard';
const API_URL = 'https://here.now/api/v1/publish';

const runCommand = (command, args = [], options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('close', code => {
      if (code === 0) return resolve();
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });

const parseSlug = () => {
  const args = process.argv.slice(2);
  const slugFlagIndex = args.findIndex(arg => arg === '--slug');
  if (slugFlagIndex !== -1 && args[slugFlagIndex + 1]) {
    return args[slugFlagIndex + 1];
  }
  const inline = args.find(arg => arg.startsWith('--slug='));
  if (inline) {
    return inline.split('=')[1];
  }
  return defaultSlug;
};

const ensureEnv = () => {
  const apiKey = process.env.HERENOW_API_KEY;
  if (!apiKey) {
    throw new Error('Missing HERENOW_API_KEY environment variable.');
  }
  return apiKey;
};

const zipDist = async () => {
  const tmpZip = path.join(os.tmpdir(), `dashboard-dist-${Date.now()}.zip`);
  await runCommand('zip', ['-qr', tmpZip, '.'], { cwd: distDir });
  return tmpZip;
};

const publish = async () => {
  const slug = parseSlug();
  const apiKey = ensureEnv();

  console.log('> Building dashboard');
  await runCommand('npm', ['run', 'build'], { cwd: root });

  console.log('> Bundling dist directory');
  const zipPath = await zipDist();
  const bundleBuffer = await fs.readFile(zipPath);

  console.log(`> Publishing to here.now as slug "${slug}"`);
  const form = new FormData();
  form.append('slug', slug);
  form.append('bundle', new Blob([bundleBuffer], { type: 'application/zip' }), 'dist.zip');

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });

  await fs.remove(zipPath);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Publish failed (${response.status}): ${errorText}`);
  }

  const result = await response.json().catch(() => ({}));
  console.log('Publish complete:', result.url || result.slug || slug);
};

publish().catch(err => {
  console.error(err.message);
  process.exitCode = 1;
});
