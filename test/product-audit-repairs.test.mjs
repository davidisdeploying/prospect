import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { SHELL_STYLE } from '../server/shell.js';
import { getHuntReport, renderHuntReportHtml } from '../server/huntReport.js';
import { getDailyDiggings, renderDailyDiggingsHtml } from '../server/diggings.js';
import { getScout, renderScoutHtml, saveProfile } from '../server/scout.js';
import { getClaimOffice, renderClaimOfficeHtml } from '../server/claimoffice.js';
import { loadVecExtension } from '../server/vecExtension.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schema = readFileSync(path.join(root, 'schema.sql'), 'utf8');
const claimDetailSource = readFileSync(path.join(root, 'app/src/ClaimDetail.jsx'), 'utf8');
const claimMapSource = readFileSync(path.join(root, 'app/src/ClaimMap.jsx'), 'utf8');
const shellCss = readFileSync(path.join(root, 'app/src/app-shell.css'), 'utf8');
const indexSource = readFileSync(path.join(root, 'server/index.js'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  return db;
}

function seedClaim(db, { nextAction = null, nextActionDate = null } = {}) {
  const listingId = db.prepare(`
    INSERT INTO listings (source, company, role, location, description)
    VALUES ('Manual', 'Northstar', 'Data Center Technician', 'Dallas, TX', 'Hardware, Linux, networking and rack deployment')
  `).run().lastInsertRowid;
  return db.prepare(`
    INSERT INTO claims (listing_id, stage, next_action, next_action_date)
    VALUES (?, 'Staked', ?, ?)
  `).run(listingId, nextAction, nextActionDate).lastInsertRowid;
}

test('shared SSR shell owns complete base theme and switches before tablet layouts become cramped', () => {
  for (const token of ['--bg-base', '--text-body', '--font-sans', '--surface-card']) {
    assert.match(SHELL_STYLE, new RegExp(token));
  }
  assert.match(SHELL_STYLE, /body\s*\{[\s\S]*background:\s*var\(--bg-base\)/);
  assert.match(SHELL_STYLE, /@media \(max-width: 960px\)/);
});

test('Hunt Report keeps truthful values visible and puts research diagnostics behind disclosure', () => {
  const db = freshDb();
  seedClaim(db);
  const html = renderHuntReportHtml(getHuntReport(db));
  assert.match(html, /\.odo-real \{ display: inline; \}/);
  assert.match(html, /\.odo-anim \{ display: none; \}/);
  assert.doesNotMatch(html, /\.odo-real\s*\{\s*display:\s*none/);
  assert.match(html, /<details class="report-diagnostics">/);
  assert.match(html, /Almanac · effort and outcomes/);
  assert.match(html, /Strike Sheet · offer evidence/);
});

test('Claim Map compact mode is a one-column board with no horizontal minimum width', () => {
  assert.match(claimMapSource, /className="claim-map-board"/);
  assert.match(shellCss, /\.claim-map-board\s*\{[\s\S]*min-width:\s*0 !important/);
  assert.match(shellCss, /\.claim-map-funnel\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(shellCss, /\.prospect-search-results/);
});

test('Claim Detail is a modal dialog with keyboard containment, focus restoration, and visible save failure recovery', () => {
  assert.match(claimDetailSource, /role="dialog"/);
  assert.match(claimDetailSource, /aria-modal="true"/);
  assert.match(claimDetailSource, /event\.key === 'Escape'/);
  assert.match(claimDetailSource, /event\.key !== 'Tab'/);
  assert.match(claimDetailSource, /previousFocusRef\.current\?\.focus/);
  assert.match(claimDetailSource, /role="status" aria-live="polite"/);
  assert.match(claimDetailSource, />Retry</);
});

test('Diggings derives a needs-attention cockpit without changing claim state', () => {
  const db = freshDb();
  const claimId = seedClaim(db, { nextAction: 'Follow up', nextActionDate: '2026-08-14' });
  const before = db.prepare('SELECT stage, next_action, next_action_date FROM claims WHERE id=?').get(claimId);
  const data = getDailyDiggings(db, { today: '2026-08-14' });
  const after = db.prepare('SELECT stage, next_action, next_action_date FROM claims WHERE id=?').get(claimId);
  assert.equal(data.attention[0].claim_id, claimId);
  assert.deepEqual(after, before);
  assert.match(renderDailyDiggingsHtml(data), /Needs attention/);
  assert.match(renderDailyDiggingsHtml(data), /never moves a claim or invents an action/);
});

test('Scout exposes ingestion cadence, latest accepted mail, and active career-profile context', () => {
  const db = freshDb();
  saveProfile(db, 'Infrastructure trajectory', {
    target_titles: ['Data Center Technician'], preferred_locations: ['Dallas'],
    credentials: ['AAS Cloud Computing'], skills: ['Linux'], experience_terms: ['deployment'],
    avoid_titles: ['security'],
  });
  db.prepare(`
    INSERT INTO scout_gmail_messages (gmail_message_id, received_at, status)
    VALUES ('audit-1', '2026-08-14T20:00:00Z', 'imported')
  `).run();
  const data = getScout(db);
  assert.equal(data.ingestion.last_accepted_at, '2026-08-14T20:00:00Z');
  assert.match(data.ingestion.cadence, /every 2 hours/);
  const html = renderScoutHtml(data);
  assert.match(html, /Last accepted alert/);
  assert.match(html, /Next mailbox check/);
  assert.match(html, /Infrastructure trajectory/);
});

test('Claim Office uses a compact disclosed company index', () => {
  const db = freshDb();
  const companyId = db.prepare("INSERT INTO companies (name, canonical_name) VALUES ('Northstar', 'northstar')").run().lastInsertRowid;
  const listingId = db.prepare("INSERT INTO listings (source, company, role, company_id) VALUES ('Manual', 'Northstar', 'Technician', ?)").run(companyId).lastInsertRowid;
  db.prepare("INSERT INTO claims (listing_id, stage, stage_entered_at) VALUES (?, 'Staked', '2026-08-14')").run(listingId);
  const html = renderClaimOfficeHtml(getClaimOffice(db));
  assert.match(html, /<details class="company-card">/);
  assert.match(html, /A compact index/);
  assert.match(html, /Today/);
});

test('claim API derives career evidence and returns labeled append-only résumé history', () => {
  assert.match(indexSource, /latestProfile\(db\)/);
  assert.match(indexSource, /career_fit: careerFit/);
  assert.match(indexSource, /scoreJob\(\{/);
  assert.match(indexSource, /rv\.label AS resume_label/);
  assert.match(claimDetailSource, /Why this role fits/);
  assert.match(claimDetailSource, /Résumé version used/);
  assert.match(claimDetailSource, /Version history/);
});
