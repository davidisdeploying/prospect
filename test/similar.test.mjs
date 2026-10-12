import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { findSimilar } from '../server/similar.js';
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

function seedListing(db, { company = 'Co', role = 'Role' } = {}) {
  const info = db.prepare(`INSERT INTO listings (source, company, role) VALUES ('Manual', ?, ?)`).run(company, role);
  return info.lastInsertRowid;
}

function seedClaim(db, listingId) {
  const info = db.prepare(`INSERT INTO claims (listing_id, stage) VALUES (?, 'Showings')`).run(listingId);
  return info.lastInsertRowid;
}

// Known 768-d fixture vectors injected directly into listings_vec, mirroring how
// test/embedding.test.mjs avoids any network/Ollama dependency: same base-seed +
// tiny-jitter construction fixedVector() there uses for its near/far pair, extended here
// to two clusters (A, B) plus a far outlier so KNN ranking has something to distinguish.
function fixedVector(seed, amplitude = 0.01) {
  return Array.from({ length: 768 }, (_, i) => Math.sin(seed * 1000 + i) * amplitude);
}

function jitteredVector(seed, jitterSeed) {
  const base = fixedVector(seed);
  return base.map((v, i) => v + Math.sin(jitterSeed * 37 + i) * 0.0001);
}

function vecBuffer(embedding) {
  return Buffer.from(Float32Array.from(embedding).buffer);
}

function seedEmbedding(db, listingId, embedding) {
  db.prepare('INSERT INTO listings_vec (listing_id, embedding) VALUES (?, ?)').run(BigInt(listingId), vecBuffer(embedding));
}

// 3 listings/claims clustered near vector A, 2 near vector B, 1 far outlier.
function seedClusterFixture(db) {
  const aClaims = [];
  for (let i = 0; i < 3; i++) {
    const listingId = seedListing(db, { company: `A-Corp-${i}`, role: 'Backend Engineer' });
    const claimId = seedClaim(db, listingId);
    seedEmbedding(db, listingId, jitteredVector(1, i + 1));
    aClaims.push({ claimId, listingId });
  }

  const bClaims = [];
  for (let i = 0; i < 2; i++) {
    const listingId = seedListing(db, { company: `B-Corp-${i}`, role: 'Data Scientist' });
    const claimId = seedClaim(db, listingId);
    seedEmbedding(db, listingId, jitteredVector(50, i + 1));
    bClaims.push({ claimId, listingId });
  }

  // 100x the cluster amplitude: L2 distance is lower-bounded by the norm gap regardless of
  // phase alignment, so this is guaranteed farthest from every cluster vector, not just
  // "probably farthest" by seed choice (two arbitrary same-amplitude phases can land close).
  const outlierListingId = seedListing(db, { company: 'Outlier Cafe', role: 'Barista' });
  const outlierClaimId = seedClaim(db, outlierListingId);
  seedEmbedding(db, outlierListingId, fixedVector(999, 1.0));

  return { aClaims, bClaims, outlierClaimId };
}

test('findSimilar: A-cluster claim ranks the other A-cluster claims nearest, outlier last', () => {
  const db = freshDb();
  const { aClaims, bClaims, outlierClaimId } = seedClusterFixture(db);

  const { results } = findSimilar(db, aClaims[0].claimId, { k: 5 });

  assert.equal(results.length, 5, 'expects all 5 other listings back (3 A-1 + 2 B + outlier)');
  const aClaimIds = new Set([aClaims[1].claimId, aClaims[2].claimId]);
  const nearestTwo = results.slice(0, 2).map((r) => r.claim_id);
  assert.deepEqual(new Set(nearestTwo), aClaimIds, 'the two nearest neighbors must be the other A-cluster claims');
  assert.equal(results[results.length - 1].claim_id, outlierClaimId, 'the far outlier must rank last');
  assert.ok(results.every((r, i) => i === 0 || r.distance >= results[i - 1].distance), 'results must be sorted nearest-first');
});

test('findSimilar: excludes the target claim/listing itself', () => {
  const db = freshDb();
  const { aClaims } = seedClusterFixture(db);

  const { results } = findSimilar(db, aClaims[0].claimId, { k: 5 });

  assert.ok(!results.some((r) => r.claim_id === aClaims[0].claimId), 'target claim must never appear in its own results');
});

test('findSimilar: a claim whose listing has no embedding row -> {results: []}', () => {
  const db = freshDb();
  seedClusterFixture(db); // populates listings_vec for other listings, not this one

  const bareListingId = seedListing(db, { company: 'No Embedding Yet', role: 'Engineer' });
  const bareClaimId = seedClaim(db, bareListingId);

  const result = findSimilar(db, bareClaimId, { k: 5 });
  assert.deepEqual(result, { results: [] });
});

test('findSimilar: empty listings_vec -> {results: []}', () => {
  const db = freshDb();
  const listingId = seedListing(db, { company: 'Solo Co', role: 'Engineer' });
  const claimId = seedClaim(db, listingId);

  const result = findSimilar(db, claimId, { k: 5 });
  assert.deepEqual(result, { results: [] });
});

test('findSimilar: unknown claim id -> null (handler maps this to 404)', () => {
  const db = freshDb();
  seedClusterFixture(db);

  assert.equal(findSimilar(db, 999999, { k: 5 }), null);
});
