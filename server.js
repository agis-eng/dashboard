import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import agis            from './api/agis.js';
import assignMemoProject from './api/assign-memo-project.js';
import changePassword  from './api/change-password.js';
import ingestTranscript from './api/ingest-transcript.js';
import leads           from './api/leads.js';
import login           from './api/login.js';
import notionClients   from './api/notion-clients.js';
import notionPartners  from './api/notion-partners.js';
import notionSearch    from './api/notion-search.js';
import telegramMessages from './api/telegram-messages.js';
import telegramSend    from './api/telegram-send.js';
import updateField       from './api/update-field.js';
import verify            from './api/verify.js';
import deleteTask        from './api/delete-task.js';
import updateTaskStatus  from './api/update-task-status.js';
import addTask           from './api/add-task.js';
import deleteVoiceMemo   from './api/delete-voice-memo.js';
import agentStatus       from './api/agent-status.js';
import createUser        from './api/admin/create-user.js';
import projectsMlpAnton  from './api/projects-mlp-anton.js';
import projectsBrain     from './api/projects-brain.js';
import brainSearch       from './api/brain-search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Raw body for webhook signature verification (must be before json middleware)
app.use('/api/ingest-transcript', express.raw({ type: '*/*', limit: '10mb' }));

// JSON + URL-encoded body parsing for all other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes
app.all('/api/agis',                (req, res) => agis(req, res));
app.all('/api/assign-memo-project', (req, res) => assignMemoProject(req, res));
app.all('/api/change-password',     (req, res) => changePassword(req, res));
app.all('/api/ingest-transcript',   (req, res) => ingestTranscript(req, res));
app.all('/api/leads',               (req, res) => leads(req, res));
app.all('/api/login',               (req, res) => login(req, res));
app.all('/api/notion-clients',      (req, res) => notionClients(req, res));
app.all('/api/notion-partners',     (req, res) => notionPartners(req, res));
app.all('/api/notion-search',       (req, res) => notionSearch(req, res));
app.all('/api/telegram-messages',   (req, res) => telegramMessages(req, res));
app.all('/api/telegram-send',       (req, res) => telegramSend(req, res));
app.all('/api/update-field',        (req, res) => updateField(req, res));
app.all('/api/verify',              (req, res) => verify(req, res));
app.all('/api/delete-task',         (req, res) => deleteTask(req, res));
app.all('/api/update-task-status',  (req, res) => updateTaskStatus(req, res));
app.all('/api/add-task',            (req, res) => addTask(req, res));
app.all('/api/delete-voice-memo',   (req, res) => deleteVoiceMemo(req, res));
app.all('/api/agent-status',        (req, res) => agentStatus(req, res));
app.all('/api/admin/create-user',   (req, res) => createUser(req, res));
app.all('/api/projects/mlp-anton',  (req, res) => projectsMlpAnton(req, res));
app.all('/api/projects-brain',      (req, res) => projectsBrain(req, res));
app.all('/api/brain-search',        (req, res) => brainSearch(req, res));

// Serve static built files
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback for SPA / unmatched routes (Express 5 compatible)
app.use((req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) res.status(404).send('Not found');
  });
});

app.listen(PORT, () => {
  console.log(`Dashboard server running on port ${PORT}`);
});
