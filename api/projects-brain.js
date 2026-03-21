import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'yaml';

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
    console.error('Error loading projects:', err.message);
    return [];
  }
}

/**
 * Get all projects with brain status
 */
async function getAllProjects() {
  const projects = await loadAllProjects();
  const projectsWithBrain = [];

  for (const project of projects) {
    const brainPath = path.join(PROJECTS_ROOT, project.id, 'brain');
    const hasBrain = await fs.pathExists(brainPath);
    
    projectsWithBrain.push({
      id: project.id,
      name: project.name,
      clientId: project.clientId,
      owner: project.owner,
      status: project.status,
      hasBrain,
      brainDocCount: hasBrain ? (await fs.readdir(brainPath)).length : 0,
    });
  }

  return projectsWithBrain;
}

/**
 * Get project metadata from dashboard data
 */
async function getProjectMetadata(projectId) {
  const projects = await loadAllProjects();
  const project = projects.find((p) => p.id === projectId);
  return project || null;
}

/**
 * Read PROJECT.md from project directory
 */
async function readProjectFile(projectId) {
  try {
    const projectPath = path.join(PROJECTS_ROOT, projectId, 'PROJECT.md');
    const content = await fs.readFile(projectPath, 'utf-8');
    return {
      filename: 'PROJECT.md',
      content,
      type: 'md',
      size: content.length,
    };
  } catch (err) {
    return null;
  }
}

/**
 * Read all brain documents (MD, TXT, PDF metadata)
 */
async function readBrainDocuments(projectId) {
  try {
    const brainPath = path.join(PROJECTS_ROOT, projectId, 'brain');
    
    // Check if brain directory exists
    if (!(await fs.pathExists(brainPath))) {
      return [];
    }

    const files = await fs.readdir(brainPath);
    const documents = [];

    for (const file of files) {
      const filePath = path.join(brainPath, file);
      const stat = await fs.stat(filePath);

      if (stat.isFile()) {
        try {
          const ext = path.extname(file).toLowerCase().slice(1);
          let content = '';

          if (file.endsWith('.md') || file.endsWith('.txt')) {
            content = await fs.readFile(filePath, 'utf-8');
          } else if (file.endsWith('.pdf')) {
            // For PDFs, we'll extract text later with pdfjs
            content = `[PDF: ${file}]`;
          } else if (file.endsWith('.json')) {
            const jsonContent = await fs.readFile(filePath, 'utf-8');
            content = jsonContent;
          }

          documents.push({
            filename: file,
            type: ext || 'text',
            size: stat.size,
            content,
            path: filePath,
          });
        } catch (err) {
          console.error(`Error reading ${file}:`, err.message);
        }
      }
    }

    return documents;
  } catch (err) {
    console.error('Error reading brain documents:', err.message);
    return [];
  }
}

/**
 * Simple full-text search with context snippets
 */
function searchDocuments(query, projectFile, brainDocuments) {
  if (!query || query.trim().length === 0) {
    return [];
  }

  const searchTerm = query.toLowerCase();
  const results = [];
  const maxSnippetLength = 200;

  // Helper to extract context around match
  function getSnippet(text, term) {
    const idx = text.toLowerCase().indexOf(term);
    if (idx === -1) return text.substring(0, maxSnippetLength);
    const start = Math.max(0, idx - 50);
    const end = Math.min(text.length, idx + term.length + 150);
    return '...' + text.substring(start, end) + '...';
  }

  // Search PROJECT.md if it exists
  if (projectFile && projectFile.content) {
    const lines = projectFile.content.split('\n');
    lines.forEach((line, idx) => {
      if (line.toLowerCase().includes(searchTerm)) {
        results.push({
          source: 'PROJECT.md',
          filename: 'PROJECT.md',
          line: line.trim(),
          lineNumber: idx + 1,
          snippet: getSnippet(line, searchTerm),
          relevance: line.toLowerCase().split(searchTerm).length - 1,
        });
      }
    });
  }

  // Search brain documents
  brainDocuments.forEach((doc) => {
    const lines = doc.content.split('\n');
    lines.forEach((line, idx) => {
      if (line.toLowerCase().includes(searchTerm)) {
        results.push({
          source: doc.filename,
          filename: doc.filename,
          type: doc.type,
          line: line.trim(),
          lineNumber: idx + 1,
          snippet: getSnippet(line, searchTerm),
          relevance: line.toLowerCase().split(searchTerm).length - 1,
        });
      }
    });
  });

  // Sort by relevance (most matches first)
  results.sort((a, b) => b.relevance - a.relevance);

  return results;
}

/**
 * Build project brain summary
 */
function buildBrainSummary(projectId, metadata, projectFile, brainDocuments) {
  return {
    projectId,
    projectName: metadata?.name || projectId,
    client: metadata?.clientId || 'Unknown',
    owner: metadata?.owner || 'Unknown',
    status: metadata?.status || 'Unknown',
    projectMetadata: projectFile ? {
      filename: 'PROJECT.md',
      size: projectFile.size,
    } : null,
    brainDocuments: brainDocuments.map((doc) => ({
      filename: doc.filename,
      type: doc.type,
      size: doc.size,
    })),
    totalDocuments: (projectFile ? 1 : 0) + brainDocuments.length,
    lastIndexed: new Date().toISOString(),
  };
}

/**
 * Main handler
 */
export default async function handler(req, res) {
  try {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    // Parse request
    const { projectId, action = 'summary', q: query = '' } = {
      ...req.query,
      ...(req.body || {}),
    };

    // Route: GET /api/projects-brain (list all projects)
    if (!projectId && action === 'summary') {
      const allProjects = await getAllProjects();
      return res.json({
        action: 'list',
        projectCount: allProjects.length,
        projects: allProjects,
      });
    }

    // Validate projectId
    if (!projectId) {
      return res.status(400).json({
        error: 'Missing projectId',
        message: 'projectId is required',
      });
    }

    // Load project data
    const metadata = await getProjectMetadata(projectId);
    const projectFile = await readProjectFile(projectId);
    const brainDocuments = await readBrainDocuments(projectId);

    // If project doesn't exist in dashboard, still allow brain-only projects
    if (!metadata && brainDocuments.length === 0 && !projectFile) {
      return res.status(404).json({
        error: 'Project not found',
        message: `Project ${projectId} has no brain data and is not in the dashboard`,
      });
    }

    // Handle actions
    switch (action) {
      case 'summary':
        return res.json(
          buildBrainSummary(projectId, metadata, projectFile, brainDocuments)
        );

      case 'search':
        if (!query) {
          return res.status(400).json({
            error: 'Missing query',
            message: 'Search requires a "q" parameter',
          });
        }
        const searchResults = searchDocuments(query, projectFile, brainDocuments);
        return res.json({
          projectId,
          query,
          resultCount: searchResults.length,
          results: searchResults.slice(0, 50), // Limit to 50 results
        });

      case 'documents':
        return res.json({
          projectId,
          projectFile: projectFile ? { filename: 'PROJECT.md' } : null,
          brainDocuments: brainDocuments.map((doc) => ({
            filename: doc.filename,
            type: doc.type,
            size: doc.size,
          })),
        });

      case 'content':
        // Return full content of a specific document
        const { filename } = req.query;
        if (!filename) {
          return res.status(400).json({
            error: 'Missing filename',
            message: 'To fetch content, provide filename parameter',
          });
        }

        if (filename === 'PROJECT.md' && projectFile) {
          return res.json({
            projectId,
            filename: 'PROJECT.md',
            content: projectFile.content,
          });
        }

        const doc = brainDocuments.find((d) => d.filename === filename);
        if (doc) {
          return res.json({
            projectId,
            filename: doc.filename,
            type: doc.type,
            content: doc.content,
          });
        }

        return res.status(404).json({
          error: 'Document not found',
          message: `${filename} not found in project brain`,
        });

      default:
        return res.status(400).json({
          error: 'Invalid action',
          validActions: ['summary', 'search', 'documents', 'content'],
        });
    }
  } catch (err) {
    console.error('Error in /api/projects-brain:', err);
    res.status(500).json({
      error: 'Internal server error',
      message: err.message,
    });
  }
}
