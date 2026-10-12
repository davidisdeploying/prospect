#!/usr/bin/env node

const command = process.argv[2] || 'run';
if (!['run', 'dry-run'].includes(command)) {
  console.error('usage: node scripts/today-notifications.mjs run|dry-run');
  process.exit(2);
}

const [{ db }, { dispatchTodayNotifications }] = await Promise.all([
  import('../server/db.js'),
  import('../server/todayNotifications.js'),
]);

try {
  const summary = await dispatchTodayNotifications(db, {
    dryRun: command === 'dry-run',
  });
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.ok ? 0 : 1;
} finally {
  db.close();
}
