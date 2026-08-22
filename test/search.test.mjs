import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { runFusedSearch } from '../server/search.js';
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

function seedListing(db, { company = 'Co', role = 'Role', description = '' } = {}) {
  const info = db.prepare(`
    INSERT INTO listings (source, company, role, description) VALUES ('Manual', ?, ?, ?)
  `).run(company, role, description);
  return info.lastInsertRowid;
}

function seedClaim(db, listingId, { stage = 'Showings' } = {}) {
  const info = db.prepare(`INSERT INTO claims (listing_id, stage) VALUES (?, ?)`).run(listingId, stage);
  return info.lastInsertRowid;
}

function vecBuffer(embedding) {
  return Buffer.from(Float32Array.from(embedding).buffer);
}

function fixedVector(seed, amplitude = 0.01) {
  return Array.from({ length: 768 }, (_, i) => Math.sin(seed * 1000 + i) * amplitude);
}

function seedEmbedding(db, listingId, embedding) {
  db.prepare('INSERT INTO listings_vec (listing_id, embedding) VALUES (?, ?)').run(BigInt(listingId), vecBuffer(embedding));
}

// A stub embed() that resolves to a fixed vector — no network, mirrors how
// test/embedding.test.mjs stubs fetch instead of hitting the real Ollama.
function stubEmbed(vector) {
  return async () => vecBuffer(vector);
}

function throwingEmbed(message = 'embed unreachable (stub)') {
  return async () => { throw new Error(message); };
}

test('empty/whitespace q short-circuits to {results: []}, no query attempted', async () => {
  const db = freshDb();
  assert.deepEqual(await runFusedSearch(db, ''), { results: [] });
  assert.deepEqual(await runFusedSearch(db, '   '), { results: [] });
});

test('FTS5-only regression: a text-term query still returns the matching claim (vec branch empty)', async () => {
  const db = freshDb();
  const listingId = seedListing(db, { company: 'Acme Corp', role: 'Backend Engineer', description: 'Build distributed systems in Rust.' });
  const claimId = seedClaim(db, listingId);

  // listings_vec has no row for this listing -> vec branch degrades to [], FTS carries it.
  const { results } = await runFusedSearch(db, 'distributed systems', { embed: throwingEmbed() });

  assert.equal(results.length, 1);
  assert.equal(results[0].claim_id, claimId);
  assert.equal(results[0].match, 'text');
  assert.ok(results[0].snippet, 'FTS match must carry a snippet');
});

test('fusion: a claim appearing in both text and vec lists is tagged "both" and ranks at/near top', async () => {
  const db = freshDb();

  // Text-only match: term appears in description, but its embedding is pushed
  // outside the KNN's k=20 window by 20 decoy listings clustered near the
  // query vector below (a vec0 KNN always returns its k nearest of whatever
  // exists, regardless of absolute distance, so a small corpus needs padding
  // to exercise "text matched, but NOT in the vec top-k" at all).
  const textOnlyListing = seedListing(db, { company: 'TextOnly Inc', role: 'Analyst', description: 'quantum widget analysis' });
  const textOnlyClaim = seedClaim(db, textOnlyListing);
  seedEmbedding(db, textOnlyListing, fixedVector(500, 10)); // huge amplitude -> guaranteed farthest

  // Both: matches the text term AND is the nearest vector neighbor.
  const bothListing = seedListing(db, { company: 'Both Corp', role: 'Engineer', description: 'quantum widget engineering team' });
  const bothClaim = seedClaim(db, bothListing);
  seedEmbedding(db, bothListing, fixedVector(1)); // matches the stubbed query vector below

  // Semantic-only: no text overlap, but nearest vector neighbor after "both".
  const vecOnlyListing = seedListing(db, { company: 'VecOnly LLC', role: 'Scientist', description: 'unrelated posting text' });
  const vecOnlyClaim = seedClaim(db, vecOnlyListing);
  seedEmbedding(db, vecOnlyListing, fixedVector(1, 0.011)); // close to, but not identical to, the query vector

  // Decoys: 20 unrelated listings clustered near the query vector (different
  // seeds -> different phase, same small amplitude), so vecOnlyListing still
  // ranks ahead of them (its distance is a tiny radial perturbation of the
  // query vector, not a different phase) while padding out the k=20 window.
  for (let i = 0; i < 20; i++) {
    const decoyListing = seedListing(db, { company: `Decoy ${i}`, role: 'Other', description: 'unrelated filler text' });
    seedEmbedding(db, decoyListing, fixedVector(2 + i));
  }

  const { results } = await runFusedSearch(db, 'quantum widget', { embed: stubEmbed(fixedVector(1)) });

  const byClaimId = new Map(results.map((r) => [r.claim_id, r]));
  assert.equal(byClaimId.get(bothClaim).match, 'both');
  assert.equal(byClaimId.get(textOnlyClaim).match, 'text');
  assert.equal(byClaimId.get(vecOnlyClaim).match, 'semantic');

  // The claim present in both lists sums both RRF contributions -> ranks first.
  assert.equal(results[0].claim_id, bothClaim);
});

test('degrade: embed failure -> handler returns FTS5-only, resolves (never throws)', async () => {
  const db = freshDb();
  const listingId = seedListing(db, { company: 'Acme Corp', role: 'Backend Engineer', description: 'Build distributed systems in Rust.' });
  const claimId = seedClaim(db, listingId);
  seedEmbedding(db, listingId, fixedVector(1)); // vector layer IS populated -- only the embed call fails

  const result = await runFusedSearch(db, 'distributed systems', { embed: throwingEmbed('Ollama down (stub)') });

  assert.deepEqual(Object.keys(result), ['results']);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].claim_id, claimId);
  assert.equal(result.results[0].match, 'text');
});

test('degrade: empty/unmigrated listings_vec (no rows at all) -> FTS5-only, never throws', async () => {
  const db = freshDb();
  const listingId = seedListing(db, { company: 'Acme Corp', role: 'Backend Engineer', description: 'Build distributed systems in Rust.' });
  const claimId = seedClaim(db, listingId);
  // No seedEmbedding call -- listings_vec stays empty.

  const { results } = await runFusedSearch(db, 'distributed systems', { embed: stubEmbed(fixedVector(1)) });

  assert.equal(results.length, 1);
  assert.equal(results[0].claim_id, claimId);
  assert.equal(results[0].match, 'text');
});

test('semantic-only result has snippet: null (no FTS row to draw a snippet from)', async () => {
  const db = freshDb();
  const listing = seedListing(db, { company: 'VecOnly LLC', role: 'Scientist', description: 'unrelated posting text with no term overlap' });
  const claimId = seedClaim(db, listing);
  seedEmbedding(db, listing, fixedVector(1));

  const { results } = await runFusedSearch(db, 'zzz-no-text-match-zzz', { embed: stubEmbed(fixedVector(1)) });

  assert.equal(results.length, 1);
  assert.equal(results[0].claim_id, claimId);
  assert.equal(results[0].match, 'semantic');
  assert.equal(results[0].snippet, null);
});
