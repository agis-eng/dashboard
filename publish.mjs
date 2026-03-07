import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { lookup as mimeLookup } from 'mime-types';

const root = fileURLToPath(new URL('.', import.meta.url));
const distDir = path.join(root, 'dist');
const defaultSlug = 'atlas-dashboard';
const API_URL = 'https://here.now/api/v1/artifact';

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
  const envKey = process.env.HERENOW_API_KEY;
  if (envKey) {
    return envKey.trim();
  }
  const keyPath = path.resolve(root, '..', '..', 'secrets', 'herenow.key');
  if (fs.pathExistsSync(keyPath)) {
    return fs.readFileSync(keyPath, 'utf8').trim();
  }
  throw new Error('Missing HERENOW_API_KEY and secrets/herenow.key');
};

const toPosixPath = relPath => relPath.split(path.sep).join('/');

const collectFiles = async dir => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else if (entry.isFile()) {
      const stat = await fs.stat(fullPath);
      const rel = toPosixPath(path.relative(distDir, fullPath));
      const contentType = mimeLookup(rel) || 'application/octet-stream';
      files.push({ fullPath, path: rel, size: stat.size, contentType });
    }
  }
  return files;
};

const publish = async () => {
  const slug = parseSlug();
  const apiKey = ensureEnv();

  console.log('> Building dashboard');
  await runCommand('npm', ['run', 'build'], { cwd: root });

  console.log('> Enumerating dist files');
  const files = await collectFiles(distDir);
  if (!files.length) {
    throw new Error('dist/ is empty. Run the build and try again.');
  }

  const createUrl = API_URL;
  console.log(`> Creating artifact for slug "${slug || 'auto-generated'}"`);
  const createResponse = await fetch(createUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-HereNow-Client': 'atlas-dashboard/publish-script'
    },
    body: JSON.stringify({
      files: files.map(file => ({
        path: file.path,
        size: file.size,
        contentType: file.contentType
      }))
    })
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    throw new Error(`Artifact create failed (${createResponse.status}): ${errorText}`);
  }

  const artifact = await createResponse.json();
  const { upload, siteUrl } = artifact;
  if (!upload || !upload.uploads || !upload.finalizeUrl) {
    throw new Error('Artifact response missing upload metadata.');
  }

  console.log('> Uploading files');
  for (const item of upload.uploads) {
    const file = files.find(f => f.path === item.path);
    if (!file) {
      throw new Error(`File missing for path ${item.path}`);
    }
    const data = await fs.readFile(file.fullPath);
    const uploadResponse = await fetch(item.url, {
      method: item.method || 'PUT',
      headers: {
        'Content-Type': (item.headers && item.headers['Content-Type']) || file.contentType
      },
      body: data
    });
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Upload failed for ${file.path} (${uploadResponse.status}): ${errorText}`);
    }
  }

  console.log('> Finalizing artifact');
  const finalizeResponse = await fetch(upload.finalizeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ versionId: upload.versionId })
  });

  if (!finalizeResponse.ok) {
    const errorText = await finalizeResponse.text();
    throw new Error(`Finalize failed (${finalizeResponse.status}): ${errorText}`);
  }

  console.log('Publish complete:', siteUrl || `${slug}.here.now`);
};

publish().catch(err => {
  console.error(err.message);
  process.exitCode = 1;
});
