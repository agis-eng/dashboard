import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import agisMessages     from './api/agis-messages.js';
import agisSend         from './api/agis-send.js';
import changePassword   from './api/change-password.js';
import login            from './api/login.js';
import notionClients    from './api/notion-clients.js';
import notionPartners   from './api/notion-partners.js';
import notionSearch     from './api/notion-search.js';
import telegramMessages from './api/telegram-messages.js';
import telegramSend     from './api/telegram-send.js';
import verify           from './api/verify.js';
import ingestTranscript from './api/ingest-transcript.js';
import createUser       from './api/admin/create-user.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use('/api/ingest-transcript', express.raw({ type: '*/*', limit: '10mb' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.all('/api/agis-messages',       (req, res) => agisMessages(req, res));
app.all('/api/agis-send',           (req, res) => agisSend(req, res));
app.all('/api/change-password',     (req, res) => changePassword(req, res));
app.all('/api/login',               (req, res) => login(req, res));
app.all('/api/notion-clients',      (req, res) => notionClients(req, res));
app.all('/api/notion-partners',     (req, res) => notionPartners(req, res));
app.all('/api/notion-search',       (req, res) => notionSearch(req, res));
app.all('/api/telegram-messages',   (req, res) => telegramMessages(req, res));
app.all('/api/telegram-send',       (req, res) => telegramSend(req, res));
app.all('/api/verify',              (req, res) => verify(req, res));
app.all('/api/ingest-transcript',   (req, res) => ingestTranscript(req, res));
app.all('/api/admin/create-user',   (req, res) => createUser(req, res));

app.use(express.static(path.join(__dirname, 'dist')));

app.use((req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) res.status(404).send('Not found');
  });
});

app.listen(PORT, () => {
  console.log(`Dashboard server running on port ${PORT}`);
});
