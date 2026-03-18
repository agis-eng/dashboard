const fs = require('fs');
const { execSync } = require('child_process');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Read active tasks from clawdbot
    let activeTasks = [];
    try {
      const tasksData = fs.readFileSync('/Users/eriklaine/.clawdbot/active-tasks.json', 'utf8');
      activeTasks = JSON.parse(tasksData);
    } catch (err) {
      // If file doesn't exist or is invalid, return empty array
      console.warn('Could not read active-tasks.json:', err.message);
    }

    // Get tmux sessions
    let tmuxSessions = [];
    try {
      const tmuxOut = execSync('tmux ls 2>/dev/null || echo ""', { encoding: 'utf8' });
      if (tmuxOut.trim()) {
        tmuxSessions = tmuxOut.trim().split('\n').map(line => {
          const match = line.match(/^([^:]+):/);
          return match ? match[1] : null;
        }).filter(Boolean);
      }
    } catch (err) {
      console.warn('Could not get tmux sessions:', err.message);
    }

    // Cross-reference tasks with tmux sessions
    const tasks = activeTasks.map(task => ({
      session: task.session || task.id || 'unknown',
      project: task.project || 'unknown',
      branch: task.branch || task.git_branch || 'unknown',
      started: task.started || task.created_at || new Date().toISOString(),
      status: tmuxSessions.includes(task.session || task.id) ? 'running' : 'stopped'
    }));

    return res.status(200).json({ tasks });
  } catch (error) {
    console.error('Error in agent-status API:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}