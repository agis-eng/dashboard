import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..', 'projects', 'mlp-anton');

/**
 * Read and parse PROJECT.md
 */
async function readProjectMetadata() {
  try {
    const projectPath = path.join(PROJECT_ROOT, 'PROJECT.md');
    const content = await fs.readFile(projectPath, 'utf-8');
    return {
      filename: 'PROJECT.md',
      content,
      path: projectPath,
    };
  } catch (err) {
    console.error('Error reading PROJECT.md:', err.message);
    return null;
  }
}

/**
 * Read all documents from brain folder
 */
async function readBrainDocuments() {
  try {
    const brainPath = path.join(PROJECT_ROOT, 'brain');
    const files = await fs.readdir(brainPath);
    const documents = [];

    for (const file of files) {
      const filePath = path.join(brainPath, file);
      const stat = await fs.stat(filePath);

      if (stat.isFile()) {
        try {
          let content = '';
          // Only read text files and PDFs (we'll list PDFs as available)
          if (file.endsWith('.md') || file.endsWith('.txt')) {
            content = await fs.readFile(filePath, 'utf-8');
          } else if (file.endsWith('.pdf')) {
            // For PDFs, just note they exist; actual extraction would require pdf-parse
            content = `[PDF Document: ${file}]`;
          }

          documents.push({
            filename: file,
            content,
            path: filePath,
            type: path.extname(file).toLowerCase().slice(1) || 'text',
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
 * Parse PROJECT.md into structured sections
 */
function parseProjectMetadata(content) {
  const sections = {};
  let currentSection = null;
  const lines = content.split('\n');

  for (const line of lines) {
    if (line.startsWith('## ')) {
      currentSection = line.replace(/^##\s+/, '').trim();
      sections[currentSection] = [];
    } else if (currentSection && line.trim()) {
      sections[currentSection].push(line);
    }
  }

  return sections;
}

/**
 * Full-text search across all documents
 */
function searchDocuments(query, projectMetadata, brainDocuments) {
  if (!query || query.trim().length === 0) {
    return [];
  }

  const searchTerm = query.toLowerCase();
  const results = [];

  // Search project metadata
  if (projectMetadata) {
    const lines = projectMetadata.content.split('\n');
    lines.forEach((line, idx) => {
      if (line.toLowerCase().includes(searchTerm)) {
        results.push({
          source: 'PROJECT.md',
          line: line.trim(),
          lineNumber: idx + 1,
          context: lines.slice(Math.max(0, idx - 1), idx + 2).join('\n'),
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
          line: line.trim(),
          lineNumber: idx + 1,
          context: lines.slice(Math.max(0, idx - 1), idx + 2).join('\n'),
        });
      }
    });
  });

  return results;
}

/**
 * Build summary object from project data
 */
function buildProjectSummary(projectMetadata, brainDocuments) {
  if (!projectMetadata) {
    return null;
  }

  const sections = parseProjectMetadata(projectMetadata.content);
  const summary = {
    projectId: 'mlp-anton',
    title: 'Major League Profits — Anton Hocking',
    status: 'Active',
    client: 'Anton Hocking (AGIS Partner)',
    serviceProvider: 'Major League Profits (MLP)',
    agreementDate: '2026-03-20',
    metadata: sections,
    brainDocuments: brainDocuments.map((doc) => ({
      filename: doc.filename,
      type: doc.type,
      size: doc.content.length,
    })),
    lastUpdated: new Date().toISOString(),
  };

  return summary;
}

/**
 * Main API handler
 */
export default async function handler(req, res) {
  try {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    const { action = 'summary', query = '' } = req.query || req.body || {};

    // Read project data
    const projectMetadata = await readProjectMetadata();
    const brainDocuments = await readBrainDocuments();

    if (!projectMetadata) {
      return res.status(404).json({
        error: 'Project not found',
        message: 'MLP-Anton project data could not be loaded',
      });
    }

    switch (action) {
      case 'summary':
        // Return structured project summary
        return res.json(buildProjectSummary(projectMetadata, brainDocuments));

      case 'search':
        // Full-text search
        if (!query) {
          return res.status(400).json({
            error: 'Missing query',
            message: 'Please provide a search query parameter',
          });
        }
        const results = searchDocuments(query, projectMetadata, brainDocuments);
        return res.json({
          query,
          resultCount: results.length,
          results,
        });

      case 'raw':
        // Return all raw document content
        return res.json({
          projectId: 'mlp-anton',
          projectMetadata: projectMetadata.content,
          brainDocuments: brainDocuments.map((doc) => ({
            filename: doc.filename,
            type: doc.type,
            content: doc.content,
          })),
        });

      case 'metadata':
        // Return just the parsed metadata sections
        return res.json({
          projectId: 'mlp-anton',
          sections: parseProjectMetadata(projectMetadata.content),
        });

      default:
        return res.status(400).json({
          error: 'Invalid action',
          validActions: ['summary', 'search', 'raw', 'metadata'],
        });
    }
  } catch (err) {
    console.error('Error in /api/projects/mlp-anton:', err);
    res.status(500).json({
      error: 'Internal server error',
      message: err.message,
    });
  }
}
