import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { loadVecExtension } from '../server/vecExtension.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexSource = fs.readFileSync(path.join(repoRoot, 'server/index.js'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(repoRoot, 'schema.sql'), 'utf8'));
  return db;
}

test('server exposes the canonical Prospect lockup and compact mark before the SPA catch-all', () => {
  const lockupRoute = indexSource.indexOf("app.get('/brand/prospect-lockup.svg'");
  const compactMarkRoute = indexSource.indexOf("app.get('/brand/prospect-mark-compact.svg'");
  const spaCatchAll = indexSource.indexOf("app.get(/^(?!\\/api\\/).*");
  assert.ok(lockupRoute > 0);
  assert.ok(compactMarkRoute > 0);
  assert.ok(spaCatchAll > lockupRoute);
  assert.ok(spaCatchAll > compactMarkRoute);
  assert.match(indexSource, /design-system\/assets\/prospect-lockup\.svg/);
  assert.match(indexSource, /design-system\/assets\/prospect-mark-compact\.svg/);
});

// §PWA shell v2: the desktop wordmark/sidebar markup no longer lives inline in each page's own
// source — it's emitted by server/shell.js#renderSidebarNav, shared across all four SSR pages.
// These assertions render each page's real HTML output rather than grepping page source, since
// the source itself now just calls the shared renderer.
test('desktop rail: all four SSR pages render the real dominant Prospect lockup at 272px/232px, via the shared renderer', async () => {
  const db = freshDb();
  const { renderScoutHtml, getScout } = await import('../server/scout.js');
  const { renderHuntReportHtml, getHuntReport } = await import('../server/huntReport.js');
  const { renderClaimOfficeHtml, getClaimOffice } = await import('../server/claimoffice.js');
  const { renderDailyDiggingsHtml, getDailyDiggings } = await import('../server/diggings.js');

  const pages = [
    ['Scout', renderScoutHtml(getScout(db))],
    ['Hunt Report', renderHuntReportHtml(getHuntReport(db))],
    ['Claim Office', renderClaimOfficeHtml(getClaimOffice(db))],
    ['Diggings', renderDailyDiggingsHtml(getDailyDiggings(db))],
  ];

  for (const [pageName, html] of pages) {
    assert.match(html, /<img class="report-wordmark" src="\/brand\/prospect-lockup\.svg" alt="Prospect">/, `${pageName} uses the real lockup`);
    assert.doesNotMatch(html, /<span class="(?:report-)?wordmark">Prospect<\/span>/, `${pageName} never falls back to a text wordmark`);
    assert.match(html, /class="report-shell"/, `${pageName} uses the shared 2-col shell`);
  }
});

test('SHELL_STYLE (the single source for the desktop rail CSS) is 272px/232px, and each page pulls it in rather than redefining it', async () => {
  const { SHELL_STYLE } = await import('../server/shell.js');
  assert.match(SHELL_STYLE, /grid-template-columns:\s*272px 1fr/);
  assert.match(SHELL_STYLE, /max-width:\s*232px/);

  for (const [name, file] of [
    ['scout', 'server/scout.js'], ['huntReport', 'server/huntReport.js'],
    ['claimoffice', 'server/claimoffice.js'], ['diggings', 'server/diggings.js'],
  ]) {
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    assert.doesNotMatch(source, /grid-template-columns:\s*272px 1fr/, `${name} no longer defines its own copy of the 272px rail grid`);
    assert.match(source, /SHELL_STYLE/, `${name} pulls in the shared shell style`);
  }
});

// §PWA shell v2: on compact viewports the rail is removed from layout entirely (display:none),
// replacing the old M-something behavior where the wordmark merely shrank to a fixed height —
// that shrink-to-64px rule no longer exists anywhere in the shared shell style.
test('compact (<=960px): the rail is hidden entirely, not shrunk — no leftover 64px wordmark rule', async () => {
  const { SHELL_STYLE } = await import('../server/shell.js');
  assert.match(SHELL_STYLE, /\.report-aside \{ display: none; \}/);
  assert.doesNotMatch(SHELL_STYLE, /\.report-wordmark[\s\S]*height:\s*64px/);
});
