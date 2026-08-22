import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { getClaimOffice, renderClaimOfficeHtml } from '../server/claimoffice.js';
import { loadVecExtension } from '../server/vecExtension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function seedCompany(db, { name, canonicalName, pageUrl = null }) {
  const info = db.prepare(`
    INSERT INTO companies (name, canonical_name, page_url) VALUES (?, ?, ?)
  `).run(name, canonicalName, pageUrl);
  return info.lastInsertRowid;
}

function seedListing(db, { companyId, company, role, compDisclosed = 0, annualCompMin = null, annualCompMax = null, annualCompMid = null }) {
  const info = db.prepare(`
    INSERT INTO listings (source, company, role, company_id, comp_disclosed, annual_comp_min, annual_comp_max, annual_comp_mid)
    VALUES ('Manual', ?, ?, ?, ?, ?, ?, ?)
  `).run(company, role, companyId, compDisclosed, annualCompMin, annualCompMax, annualCompMid);
  return info.lastInsertRowid;
}

function seedClaim(db, { listingId, stage, stageEnteredAt }) {
  const info = db.prepare(`
    INSERT INTO claims (listing_id, stage, stage_entered_at) VALUES (?, ?, ?)
  `).run(listingId, stage, stageEnteredAt);
  return info.lastInsertRowid;
}

function addTransition(db, claimId, fromStage, toStage, transitionedAt) {
  db.prepare(`
    INSERT INTO stage_transitions (claim_id, from_stage, to_stage, transitioned_at, transition_cause)
    VALUES (?, ?, ?, ?, 'manual')
  `).run(claimId, fromStage, toStage, transitionedAt);
}

function seedContact(db, { claimId, name, role = null, email = null, profileUrl = null, isJobPoster = 0 }) {
  db.prepare(`
    INSERT INTO contacts (claim_id, name, role, email, profile_url, is_job_poster) VALUES (?, ?, ?, ?, ?, ?)
  `).run(claimId, name, role, email, profileUrl, isJobPoster);
}

// Two companies, three claims (two at Acme, one at Basalt), and a recruiter contact who appears
// on both Acme claims under the same profile_url (recurrence) plus a second, distinct email-only
// contact on the Basalt claim (non-recurring, exercises the 1-claim exclusion).
function seedFixture(db) {
  const acmeId = seedCompany(db, { name: 'Acme', canonicalName: 'acme', pageUrl: 'https://acme.example/careers' });
  const basaltId = seedCompany(db, { name: 'Basalt', canonicalName: 'basalt' });

  const acmeListing1 = seedListing(db, {
    companyId: acmeId, company: 'Acme', role: 'Staff Engineer',
    compDisclosed: 1, annualCompMin: 140000, annualCompMax: 160000, annualCompMid: 150000,
  });
  const acmeListing2 = seedListing(db, {
    companyId: acmeId, company: 'Acme', role: 'Senior Engineer',
    compDisclosed: 1, annualCompMin: 120000, annualCompMax: 140000, annualCompMid: 130000,
  });
  const basaltListing = seedListing(db, { companyId: basaltId, company: 'Basalt', role: 'Backend' });

  const acmeClaim1 = seedClaim(db, { listingId: acmeListing1, stage: 'Strike', stageEnteredAt: '2026-07-09 09:00:00' });
  addTransition(db, acmeClaim1, null, 'Showings', '2026-07-01 09:00:00');
  addTransition(db, acmeClaim1, 'Showings', 'Staked', '2026-07-02 09:00:00');
  addTransition(db, acmeClaim1, 'Staked', 'Strike', '2026-07-09 09:00:00');

  const acmeClaim2 = seedClaim(db, { listingId: acmeListing2, stage: 'Staked', stageEnteredAt: '2026-07-05 09:00:00' });
  addTransition(db, acmeClaim2, null, 'Showings', '2026-07-04 09:00:00');
  addTransition(db, acmeClaim2, 'Showings', 'Staked', '2026-07-05 09:00:00');

  const basaltClaim = seedClaim(db, { listingId: basaltListing, stage: 'Tailings', stageEnteredAt: '2026-07-06 09:00:00' });
  addTransition(db, basaltClaim, null, 'Showings', '2026-07-03 09:00:00');
  addTransition(db, basaltClaim, 'Showings', 'Tailings', '2026-07-06 09:00:00');

  seedContact(db, { claimId: acmeClaim1, name: 'Riley Recruiter', role: 'Recruiter', profileUrl: 'https://linkedin.com/in/riley', isJobPoster: 1 });
  seedContact(db, { claimId: acmeClaim2, name: 'Riley R.', role: 'Recruiter', profileUrl: 'https://linkedin.com/in/riley' });
  seedContact(db, { claimId: basaltClaim, name: 'Sam Solo', email: 'sam@basalt.example' });

  return { acmeId, basaltId, acmeClaim1, acmeClaim2, basaltClaim };
}

function rowCounts(db) {
  return {
    companies: db.prepare('SELECT count(*) AS n FROM companies').get().n,
    contacts: db.prepare('SELECT count(*) AS n FROM contacts').get().n,
    claims: db.prepare('SELECT count(*) AS n FROM claims').get().n,
    listings: db.prepare('SELECT count(*) AS n FROM listings').get().n,
    stage_transitions: db.prepare('SELECT count(*) AS n FROM stage_transitions').get().n,
  };
}

test('getClaimOffice performs zero writes', () => {
  const db = freshDb();
  seedFixture(db);
  const before = rowCounts(db);
  getClaimOffice(db);
  const after = rowCounts(db);
  assert.deepEqual(after, before);
});

test('companies: claim_count, stage_breakdown, comp range, contacts, reached_strike per company', () => {
  const db = freshDb();
  seedFixture(db);
  const { companies } = getClaimOffice(db);
  assert.equal(companies.length, 2);

  const acme = companies.find((c) => c.name === 'Acme');
  assert.equal(acme.claim_count, 2);
  assert.equal(acme.reached_strike, true);
  assert.equal(acme.comp.min, 120000);
  assert.equal(acme.comp.max, 160000);
  assert.equal(acme.contacts.length, 2);
  const strikeStage = acme.stage_breakdown.find((s) => s.stage === 'Strike');
  assert.equal(strikeStage.count, 1);
  const stakedStage = acme.stage_breakdown.find((s) => s.stage === 'Staked');
  assert.equal(stakedStage.count, 1);

  const basalt = companies.find((c) => c.name === 'Basalt');
  assert.equal(basalt.claim_count, 1);
  assert.equal(basalt.reached_strike, false);
  assert.equal(basalt.comp, null);
  assert.equal(basalt.contacts.length, 1);
});

test('companies: a company with 0 claims still appears (LEFT-join semantics)', () => {
  const db = freshDb();
  seedCompany(db, { name: 'Orphan Co', canonicalName: 'orphan-co' });
  const { companies } = getClaimOffice(db);
  assert.equal(companies.length, 1);
  assert.equal(companies[0].name, 'Orphan Co');
  assert.equal(companies[0].claim_count, 0);
  assert.equal(companies[0].contacts.length, 0);
  assert.equal(companies[0].comp, null);
  companies[0].stage_breakdown.forEach((s) => assert.equal(s.count, 0));
});

test('recurring_contacts: dedups by profile_url across distinct claims, excludes single-claim contacts', () => {
  const db = freshDb();
  const { acmeClaim1, acmeClaim2 } = seedFixture(db);
  const { recurring_contacts } = getClaimOffice(db);
  assert.equal(recurring_contacts.length, 1);
  const rc = recurring_contacts[0];
  assert.equal(rc.key, 'https://linkedin.com/in/riley');
  assert.deepEqual(new Set(rc.names), new Set(['Riley Recruiter', 'Riley R.']));
  const claimIds = rc.claims.map((c) => c.claim_id).sort((a, b) => a - b);
  assert.deepEqual(claimIds, [acmeClaim1, acmeClaim2].sort((a, b) => a - b));
});

test('recurring_contacts: empty array at 0 contacts', () => {
  const db = freshDb();
  const { recurring_contacts } = getClaimOffice(db);
  assert.deepEqual(recurring_contacts, []);
});

test('recurring_contacts: falls back to email when profile_url is blank, never merges by name alone', () => {
  const db = freshDb();
  const companyId = seedCompany(db, { name: 'Quartz Co', canonicalName: 'quartz-co' });
  const listing1 = seedListing(db, { companyId, company: 'Quartz Co', role: 'Engineer' });
  const listing2 = seedListing(db, { companyId, company: 'Quartz Co', role: 'Analyst' });
  const claim1 = seedClaim(db, { listingId: listing1, stage: 'Showings', stageEnteredAt: '2026-07-01 09:00:00' });
  const claim2 = seedClaim(db, { listingId: listing2, stage: 'Showings', stageEnteredAt: '2026-07-02 09:00:00' });
  // Same name, no shared email/profile_url — must NOT be treated as recurring (name is display-only).
  seedContact(db, { claimId: claim1, name: 'Jordan Jobs', email: 'jordan.a@example.com' });
  seedContact(db, { claimId: claim2, name: 'Jordan Jobs', email: 'jordan.b@example.com' });
  // A real email-keyed recurrence, no profile_url on either row.
  const claim3 = seedClaim(db, { listingId: listing1, stage: 'Showings', stageEnteredAt: '2026-07-03 09:00:00' });
  seedContact(db, { claimId: claim3, name: 'Casey Contact', email: 'casey@example.com' });
  seedContact(db, { claimId: claim2, name: 'Casey C.', email: 'casey@example.com' });

  const { recurring_contacts } = getClaimOffice(db);
  assert.equal(recurring_contacts.length, 1);
  assert.equal(recurring_contacts[0].key, 'casey@example.com');
});

test('renderClaimOfficeHtml: company names, claim counts, and the recurring contact are in raw HTML, zero <script>', () => {
  const db = freshDb();
  seedFixture(db);
  const html = renderClaimOfficeHtml(getClaimOffice(db));
  assert.equal((html.match(/<script(?! src="\/pwa-register\.js")/g) || []).length, 0);
  assert.match(html, /Acme/);
  assert.match(html, /Basalt/);
  assert.match(html, /Riley Recruiter/);
  assert.match(html, /Riley R\./);
  assert.match(html, /\$140,000/);
  assert.match(html, /\$160,000/);
});

test('renderClaimOfficeHtml: honest empty states at 0 companies / 0 contacts, zero <script>', () => {
  const db = freshDb();
  const html = renderClaimOfficeHtml(getClaimOffice(db));
  assert.equal((html.match(/<script(?! src="\/pwa-register\.js")/g) || []).length, 0);
  assert.match(html, /No companies yet\./);
  assert.match(html, /No contacts captured yet — the Claim Office fills in as you stake claims\./);
});

test('renderClaimOfficeHtml: no gold paydirt marker when no company reached Strike', () => {
  const db = freshDb();
  const companyId = seedCompany(db, { name: 'No Strike Co', canonicalName: 'no-strike-co' });
  const listingId = seedListing(db, { companyId, company: 'No Strike Co', role: 'Engineer' });
  const claimId = seedClaim(db, { listingId, stage: 'Staked', stageEnteredAt: '2026-07-01 09:00:00' });
  addTransition(db, claimId, null, 'Showings', '2026-06-30 09:00:00');
  addTransition(db, claimId, 'Showings', 'Staked', '2026-07-01 09:00:00');
  const html = renderClaimOfficeHtml(getClaimOffice(db));
  assert.doesNotMatch(html, /Paydirt/);
});

test('renderClaimOfficeHtml: gold paydirt marker shown when a claim reached Strike', () => {
  const db = freshDb();
  seedFixture(db);
  const html = renderClaimOfficeHtml(getClaimOffice(db));
  assert.match(html, /Paydirt/);
});
