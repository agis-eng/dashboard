// Usage: node scripts/hash-password.mjs <password>
// Outputs the SHA-256 hash to paste into data/users.yaml
import crypto from 'crypto';

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.mjs <password>');
  process.exit(1);
}

const hash = crypto.createHash('sha256').update(password).digest('hex');
console.log(hash);
