import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_ROOT = path.join(__dirname, '..', '..', 'projects');
const INDEX_CACHE_DIR = path.join(__dirname, '..', '.brain-index');

/**
 * Build in-memory full-text index for a project
 * Returns: { projectId, documentCount, index: Map<word, [docMatches]> }
 */
export async function buildProjectIndex(projectId) {
  const brainPath = path.join(PROJECTS_ROOT, projectId, 'brain');
  const projectPath = path.join(PROJECTS_ROOT, projectId, 'PROJECT.md');

  const index = new Map();
  let documentCount = 0;

  // Index PROJECT.md if it exists
  if (await fs.pathExists(projectPath)) {
    const content = await fs.readFile(projectPath, 'utf-8');
    indexContent(content, 'PROJECT.md', index);
    documentCount++;
  }

  // Index brain documents
  if (await fs.pathExists(brainPath)) {
    const files = await fs.readdir(brainPath);

    for (const file of files) {
      const filePath = path.join(brainPath, file);
      const stat = await fs.stat(filePath);

      if (!stat.isFile()) continue;

      try {
        if (file.endsWith('.md') || file.endsWith('.txt')) {
          const content = await fs.readFile(filePath, 'utf-8');
          indexContent(content, file, index);
          documentCount++;
        } else if (file.endsWith('.json')) {
          const content = await fs.readFile(filePath, 'utf-8');
          indexContent(content, file, index);
          documentCount++;
        }
        // Note: PDF indexing would require pdfjs-dist
        // For now we skip PDFs in the index
      } catch (err) {
        console.warn(`Could not index ${file}: ${err.message}`);
      }
    }
  }

  return {
    projectId,
    documentCount,
    indexSize: index.size,
    index,
  };
}

/**
 * Add content from a document to the index
 */
function indexContent(content, filename, index) {
  // Tokenize: split on non-word chars, lowercase
  const words = content
    .toLowerCase()
    .match(/\b\w+\b/g) || [];

  // Count word occurrences per document
  for (const word of words) {
    if (word.length < 3) continue; // Skip short words

    if (!index.has(word)) {
      index.set(word, []);
    }

    // Store: { filename, count, positions }
    const docs = index.get(word);
    let docEntry = docs.find((d) => d.filename === filename);

    if (!docEntry) {
      docEntry = { filename, count: 0, positions: [] };
      docs.push(docEntry);
    }

    docEntry.count++;
  }
}

/**
 * Search index and return matching documents
 * Returns ranked results sorted by relevance
 */
export function searchIndex(query, index) {
  if (!query || query.trim().length === 0) {
    return [];
  }

  const queryWords = query
    .toLowerCase()
    .match(/\b\w+\b/g) || [];

  if (queryWords.length === 0) {
    return [];
  }

  const results = new Map(); // filename -> score

  // For each query word, find documents that contain it
  for (const word of queryWords) {
    const docs = index.get(word);
    if (!docs) continue;

    for (const doc of docs) {
      if (!results.has(doc.filename)) {
        results.set(doc.filename, 0);
      }
      // Score: word count in document
      results.set(doc.filename, results.get(doc.filename) + doc.count);
    }
  }

  // Convert to sorted array
  return Array.from(results.entries())
    .map(([filename, score]) => ({ filename, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Initialize index cache directory
 */
export async function initIndexCache() {
  await fs.ensureDir(INDEX_CACHE_DIR);
}

/**
 * Save index to cache
 */
export async function saveIndexToCache(projectId, indexData) {
  const cachePath = path.join(INDEX_CACHE_DIR, `${projectId}.json`);
  
  // Convert Map to Object for JSON serialization
  const serializable = {
    projectId: indexData.projectId,
    documentCount: indexData.documentCount,
    indexSize: indexData.indexSize,
    timestamp: Date.now(),
    index: Object.fromEntries(
      Array.from(indexData.index.entries()).map(([word, docs]) => [
        word,
        docs,
      ])
    ),
  };

  await fs.writeFile(cachePath, JSON.stringify(serializable, null, 2));
}

/**
 * Load index from cache
 */
export async function loadIndexFromCache(projectId) {
  const cachePath = path.join(INDEX_CACHE_DIR, `${projectId}.json`);

  if (!(await fs.pathExists(cachePath))) {
    return null;
  }

  try {
    const data = JSON.parse(
      await fs.readFile(cachePath, 'utf-8')
    );

    // Convert Object back to Map
    const index = new Map(Object.entries(data.index));

    return {
      projectId: data.projectId,
      documentCount: data.documentCount,
      indexSize: data.indexSize,
      timestamp: data.timestamp,
      index,
    };
  } catch (err) {
    console.warn(`Could not load cache for ${projectId}:`, err.message);
    return null;
  }
}

/**
 * Check if cache is still valid (not older than maxAgeMs)
 */
export function isCacheValid(cacheData, maxAgeMs = 3600000) {
  // Default: 1 hour
  if (!cacheData || !cacheData.timestamp) {
    return false;
  }

  return Date.now() - cacheData.timestamp < maxAgeMs;
}
