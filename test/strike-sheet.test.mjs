// §6.1 — Strike Sheet: the offer comparator with corpus percentiles.
//
// The assertions that matter here are the ones about restraint: a missing component is unknown
// rather than zero, a thin corpus yields no percentile at all rather than a confident one, and the
// negotiation history survives because offers are append-only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { loadVecExtension } from '../server/vecExtension.js';
import { computeStrikeSheet, renderStrikeSheetHtml, offerTotal, OFFER_SOURCES } from '../server/strikeSheet.js';
import { deleteClaimById } from '../server/deleteClaim.js';
import { COMP_PERCENTILE_MIN_N } from '../server/analytics.js';

const schemaSql = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function seedClaim(db, { company = 'Acme', role = 'Support Engineer', stage = 'Strike', advertisedMid = null, jobFamily = 'it_support' } = {}) {
  const listing = db.prepare(`
    INSERT INTO listings (source, company, role, job_family, comp_disclosed, annual_comp_mid)
    VALUES ('test', ?, ?, ?, ?, ?)
  `).run(company, role, jobFamily, advertisedMid == null ? null : 1, advertisedMid);
  return db.prepare('INSERT INTO claims (listing_id, stage) VALUES (?, ?)')
    .run(listing.lastInsertRowid, stage).lastInsertRowid;
}

function seedCorpus(db, values) {
  for (const value of values) {
    db.prepare(`
      INSERT INTO listings (source, company, role, job_family, comp_disclosed, annual_comp_mid)
      VALUES ('test', 'Corpus Co', 'Support Engineer', 'it_support', 1, ?)
    `).run(value);
  }
}

function addOffer(db, claimId, offer) {
  return db.prepare(`
    INSERT INTO claim_offers (claim_id, source, base_annual, bonus_annual, equity_annual, other_annual, currency, note, recorded_at)
    VALUES (@claim_id, @source, @base_annual, @bonus_annual, @equity_annual, @other_annual, @currency, @note, @recorded_at)
  `).run({
    claim_id: claimId,
    source: 'employer',
    base_annual: null, bonus_annual: null, equity_annual: null, other_annual: null,
    currency: 'USD', note: null,
    recorded_at: '2026-08-01 10:00:00',
    ...offer,
  });
}

test('a missing offer component is unknown, not zero', () => {
  assert.deepEqual(
    offerTotal({ base_annual: 90000, bonus_annual: null, equity_annual: null, other_annual: null }),
    { total: 90000, components_known: 1, complete: false },
  );
  assert.deepEqual(
    offerTotal({ base_annual: 90000, bonus_annual: 9000, equity_annual: 0, other_annual: 1000 }),
    { total: 100000, components_known: 4, complete: true },
  );
  assert.deepEqual(
    offerTotal({ base_annual: null, bonus_annual: null, equity_annual: null, other_annual: null }),
    { total: null, components_known: 0, complete: false },
  );
});

test('a thin corpus yields no percentile rather than a confident one', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db, { advertisedMid: 80000 });
    addOffer(db, claimId, { base_annual: 95000 });
    seedCorpus(db, [70000, 75000]); // well under COMP_PERCENTILE_MIN_N

    const sheet = computeStrikeSheet(db);
    assert.equal(sheet.corpus.sufficient, false);
    assert.ok(sheet.corpus.n < COMP_PERCENTILE_MIN_N);
    assert.equal(sheet.offers[0].corpus_percentile, null, 'no percentile from too little data');
    // vs_advertised needs no corpus at all and must still be reported.
    assert.equal(sheet.offers[0].vs_advertised, 15000);
  } finally { db.close(); }
});

test('a sufficient corpus produces a percentile and quartiles', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db, { advertisedMid: 80000 });
    addOffer(db, claimId, { base_annual: 100000 });
    seedCorpus(db, [60000, 70000, 80000, 90000, 95000]);

    const sheet = computeStrikeSheet(db);
    assert.equal(sheet.corpus.sufficient, true);
    assert.equal(sheet.corpus.median, 80000);
    assert.ok(sheet.offers[0].corpus_percentile > 80, 'a 100k offer sits high in this corpus');
    assert.ok(sheet.basis.includes('advertised'), 'the basis caveat travels with the number');
  } finally { db.close(); }
});

test('offers are append-only, so the negotiation is visible as a sequence', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db);
    addOffer(db, claimId, { base_annual: 90000, recorded_at: '2026-08-01 10:00:00' });
    addOffer(db, claimId, { base_annual: 98000, recorded_at: '2026-08-05 10:00:00' });

    const sheet = computeStrikeSheet(db);
    const [offer] = sheet.offers;
    assert.equal(offer.generations.length, 2, 'both generations survive');
    assert.equal(offer.generations[0].total, 90000);
    assert.equal(offer.latest.total, 98000);
    assert.equal(offer.negotiated_delta, 8000);
  } finally { db.close(); }
});

test('a single offer generation reports no negotiated movement rather than zero', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db);
    addOffer(db, claimId, { base_annual: 90000 });
    const [offer] = computeStrikeSheet(db).offers;
    assert.equal(offer.negotiated_delta, null, 'un-negotiated is not the same as negotiated to no change');
  } finally { db.close(); }
});

test('the comparator stays empty until there is more than one offer to compare', () => {
  const db = freshDb();
  try {
    const first = seedClaim(db, { company: 'One Co' });
    addOffer(db, first, { base_annual: 90000 });
    assert.deepEqual(computeStrikeSheet(db).comparison, []);

    const second = seedClaim(db, { company: 'Two Co' });
    addOffer(db, second, { base_annual: 105000 });
    const sheet = computeStrikeSheet(db);
    assert.equal(sheet.comparison.length, 2);
    assert.equal(sheet.comparison[0].company, 'Two Co', 'sorted by total, highest first');
  } finally { db.close(); }
});

test('an estimate is never presented as an employer quote', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db);
    addOffer(db, claimId, { base_annual: 90000, source: 'estimate' });
    const html = renderStrikeSheetHtml(computeStrikeSheet(db));
    assert.ok(html.includes('data-source="estimate"'), 'the source is marked in the markup');
    assert.deepEqual(OFFER_SOURCES, ['employer', 'estimate']);
  } finally { db.close(); }
});

test('the Strike Sheet renders legibly with no JavaScript, and says so when empty', () => {
  const db = freshDb();
  try {
    const html = renderStrikeSheetHtml(computeStrikeSheet(db));
    const body = html.slice(html.indexOf('<body>'));
    assert.equal(/<script(?![^>]*src="\/pwa-register\.js")/.test(body), false);
    assert.ok(html.includes('No offer recorded yet'));
    assert.ok(html.includes('nothing here is simulated'), 'an empty sheet says it is empty, not zero');
  } finally { db.close(); }
});

// This is the regression test for a break introduced by migration 018/019 themselves: every FK in
// this schema is RESTRICT, so a claim child table that is not in deleteClaim.js's cascade makes hard
// delete start failing the first time it holds a row.
test('hard delete cascades the commitment ledger and offer generations', () => {
  const db = freshDb();
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-delete-offers-'));
  try {
    const claimId = seedClaim(db);
    addOffer(db, claimId, { base_annual: 90000 });
    db.prepare(`
      INSERT INTO next_action_commitments (claim_id, event, action) VALUES (?, 'promised', 'Follow up')
    `).run(claimId);

    const result = deleteClaimById(db, claimId, backupDir);
    assert.equal(result.deleted, true);
    assert.equal(db.prepare('SELECT COUNT(*) FROM claim_offers').pluck().get(), 0);
    assert.equal(db.prepare('SELECT COUNT(*) FROM next_action_commitments').pluck().get(), 0);
    assert.deepEqual(db.pragma('foreign_key_check'), []);

    const backup = JSON.parse(fs.readFileSync(result.backup_path, 'utf8'));
    assert.equal(backup.claim_offers.length, 1, 'the offer is in the backup before it is deleted');
    assert.equal(backup.next_action_commitments.length, 1);
  } finally {
    db.close();
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});
