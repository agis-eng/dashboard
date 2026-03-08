/**
 * One-time script to generate a Telegram user session string.
 * Run once locally, then add the output to Vercel as TELEGRAM_USER_SESSION.
 *
 * Usage:
 *   cd ~/.openclaw/workspace/dashboard
 *   npm install
 *   node scripts/get-telegram-session.mjs
 */
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import readline from 'readline';

const API_ID   = 35988530;
const API_HASH = '3d4ffcd968f2151773c21f74785cb965';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

(async () => {
  console.log('\n──────────────────────────────────────────────────');
  console.log('  📱  Telegram User Session Setup');
  console.log('──────────────────────────────────────────────────');
  console.log('  This will authorise your personal Telegram account');
  console.log('  so dashboard messages appear as sent by YOU.\n');

  const client = new TelegramClient(
    new StringSession(''),
    API_ID,
    API_HASH,
    { connectionRetries: 5 }
  );

  await client.start({
    phoneNumber: async () => {
      const num = await ask('  Enter your phone number (e.g. +12125551234): ');
      return num.trim();
    },
    password: async () => {
      const pw = await ask('  2FA password (press Enter if you have none): ');
      return pw.trim();
    },
    phoneCode: async () => {
      const code = await ask('  Telegram sent you a code — enter it here: ');
      return code.trim();
    },
    onError: (err) => {
      console.error('\n❌ Auth error:', err.message);
    },
  });

  const sessionString = client.session.save();

  console.log('\n──────────────────────────────────────────────────');
  console.log('  ✅  Success! Copy the session string below:');
  console.log('──────────────────────────────────────────────────\n');
  console.log(sessionString);
  console.log('\n──────────────────────────────────────────────────');
  console.log('  Next step: add to Vercel environment variables');
  console.log('    Key:   TELEGRAM_USER_SESSION');
  console.log('    Value: (the string printed above)');
  console.log('  Then redeploy — dashboard messages will appear');
  console.log('  as sent by your personal Telegram account. 🎉');
  console.log('──────────────────────────────────────────────────\n');

  await client.disconnect();
  rl.close();
  process.exit(0);
})().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
