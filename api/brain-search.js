import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'yaml';
import {
  buildProjectIndex,
  searchIndex,
  loadIndexFromCache,
  saveIndexToCache,
  isCacheValid,
  initIndexCache,
} from '../lib/brain-indexer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_ROOT = path.join(__dirname, '..', '..', 'projects');
const DASHBOARD_DATA = path.join(__dirname, '..', 'data', 'projects.yaml');

/**
 * Load all projects from dashboard data
 */
async function loadAllProjects() {
  try {
    const content = await fs.readFile(DASHBOARD_DATA, 'utf-8');
    const data = yaml.parse(content);
    return data.projects || [];
  } catch (err) {
    return [];
  }
}

/**
 * Get index (from cache or rebuild)
 */
async function getProjectIndex(projectId) {
  // Try loading from cache
  let indexData = await loadIndexFromCache(projectId);

  if (indexData && isCacheValid(indexData)) {
    return indexData.index;
  }

  // Rebuild index
  indexData = await buildProjectIndex(projectId);
  
  // Save to cache
  try {
    await initIndexCache();
    await saveIndexToCache(projectId, indexData);
  } catch (err) {
    console.warn('Could not save index cache:', err.message);
  }

  return indexData.index;
}

/**
 * Extract text snippets from content matching query
 */
function extractSnippets(content, query, maxSnippets = 3) {
  const queryWords = query.toLowerCase().match(/\b\w+\b/g) || [];
  const lines = content.split('\n');
  const snippets = [];

  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    
    // Check if line contains any query words
    if (queryWords.some((word) => lowerLine.includes(word))) {
      snippets.push(line.trim());
      if (snippets.length >= maxSnippets) break;
    }
  }

  return snippets;
}

/**
 * Get full document content
 */
async function getDocumentContent(projectId, filename) {
  // Check PROJECT.md
  if (filename === 'PROJECT.md') {
    const projectPath = path.join(PROJECTS_ROOT, projectId, 'PROJECT.md');
    if (await fs.pathExists(projectPath)) {
      return await fs.readFile(projectPath, 'utf-8');
    }
  }

  // Check brain documents
  const brainPath = path.join(PROJECTS_ROOT, projectId, 'brain', filename);
  if (await fs.pathExists(brainPath)) {
    return await fs.readFile(brainPath, 'utf-8');
  }

  return null;
}

/**
 * Main handler
 */
export default async function handler(req, res) {
  try {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { projectId, q: query } = req.query;

    // List all projects
    if (!projectId) {
      const projects = await loadAllProjects();
      const projectsWithBrain = [];

      for (const proj of projects) {
        const brainPath = path.join(PROJECTS_ROOT, proj.id, 'brain');
        const hasBrain = await fs.pathExists(brainPath);
        if (hasBrain || (await fs.pathExists(path.join(PROJECTS_ROOT, proj.id, 'PROJECT.md')))) {
          projectsWithBrain.push({
            id: proj.id,
            name: proj.name,
            hasBrain,
          });
        }
      }

      return res.json({
        projects: projectsWithBrain,
        count: projectsWithBrain.length,
      });
    }

    // Validate projectId
    if (!projectId || typeof projectId !== 'string') {
      return res.status(400).json({
        error: 'Invalid projectId',
      });
    }

    // If no query, return project info
    if (!query) {
      const brainPath = path.join(PROJECTS_ROOT, projectId, 'brain');
      const projectPath = path.join(PROJECTS_ROOT, projectId, 'PROJECT.md');
      
      const hasBrain = await fs.pathExists(brainPath);
      const hasProject = await fs.pathExists(projectPath);

      if (!hasBrain && !hasProject) {
        return res.status(404).json({
          error: 'Project not found',
          projectId,
        });
      }

      const documents = [];
      
      if (hasProject) {
        documents.push({
          filename: 'PROJECT.md',
          type: 'md',
        });
      }

      if (hasBrain) {
        const files = await fs.readdir(brainPath);
        for (const file of files) {
          const stat = await fs.stat(path.join(brainPath, file));
          if (stat.isFile()) {
            documents.push({
              filename: file,
              type: path.extname(file).slice(1) || 'text',
            });
          }
        }
      }

      return res.json({
        projectId,
        documentCount: documents.length,
        documents,
      });
    }

    // Search
    const index = await getProjectIndex(projectId);
    const searchResults = searchIndex(query, index);

    // Enrich results with snippets
    const enrichedResults = [];
    for (const result of searchResults.slice(0, 20)) {
      const content = await getDocumentContent(projectId, result.filename);
      if (content) {
        enrichedResults.push({
          filename: result.filename,
          score: result.score,
          snippets: extractSnippets(content, query, 2),
        });
      }
    }

    return res.json({
      projectId,
      query,
      resultCount: enrichedResults.length,
      results: enrichedResults,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Error in /api/brain-search:', err);
    res.status(500).json({
      error: 'Internal server error',
      message: err.message,
    });
  }
}
