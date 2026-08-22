#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const command = process.argv[2] || 'run';
const credentialsPath = process.env.PROSPECT_GMAIL_CREDENTIALS
  || path.join(root, 'data', 'scout-gmail', 'client_secret.json');
const tokenPath = process.env.PROSPECT_GMAIL_TOKEN
  || path.join(root, 'data', 'scout-gmail', 'token.json');

if (command === 'authorize') {
  const { authorizeGmail } = await import('../server/scoutGmail.js');
  const result = await authorizeGmail({ credentialsPath, tokenPath });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  process.exit(0);
}

if (!['run', 'dry-run'].includes(command)) {
  console.error('usage: node scripts/scout-gmail.mjs authorize|run|dry-run');
  process.exit(2);
}

const [{ db }, { loadGmailAuth, runGmailScout }] = await Promise.all([
  import('../server/db.js'),
  import('../server/scoutGmail.js'),
]);
try {
  const auth = loadGmailAuth({ credentialsPath, tokenPath });
  const summary = await runGmailScout(db, {
    auth,
    query: process.env.PROSPECT_GMAIL_QUERY,
    dryRun: command === 'dry-run',
  });
  console.log(JSON.stringify({ ok: summary.errors.length === 0, dry_run: command === 'dry-run', ...summary }, null, 2));
  process.exitCode = summary.errors.length ? 1 : 0;
} finally {
  db.close();
}
