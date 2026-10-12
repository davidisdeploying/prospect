import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { titleJaccard, roleTokens, descHash, canonicalCompanyName, REPOST_TITLE_JACCARD_THRESHOLD } from '../validate.js';
import { detectRepost, detectSemanticRepost, lineDiff, linkRepost, RepostLinkError, REPOST_SEMANTIC_L2_MAX } from '../repost.js';
import { loadVecExtension } from '../vecExtension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(path.join(__dirname, '../../schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

// Mirrors the shape POST /api/claims writes, without going through express —
// exercises the same tables/columns detectRepost/linkRepost read.
function seedListing(db, { company, role, description, stage = 'Showings' }) {
  let companyId = null;
  if (company) {
    const canon = canonicalCompanyName(company);
    const row = db.prepare(`
      INSERT INTO companies (name, canonical_name) VALUES (?, ?)
      ON CONFLICT(canonical_name) DO UPDATE SET name = excluded.name
      RETURNING id
    `).get(company, canon);
    companyId = row.id;
  }
  const listingInfo = db.prepare(`
    INSERT INTO listings (source, company, role, description, company_id, desc_hash)
    VALUES ('Manual', ?, ?, ?, ?, ?)
  `).run(company ?? null, role ?? null, description ?? null, companyId, descHash(description));
  const listingId = listingInfo.lastInsertRowid;
  const claimInfo = db.prepare(`INSERT INTO claims (listing_id, stage) VALUES (?, ?)`).run(listingId, stage);
  return { listingId, claimId: claimInfo.lastInsertRowid };
}

test('titleJaccard: identical roles score 1, disjoint roles score 0', () => {
  assert.equal(titleJaccard('Senior Backend Engineer', 'Senior Backend Engineer'), 1);
  assert.equal(titleJaccard('Senior Backend Engineer', 'Warehouse Associate'), 0);
  assert.equal(roleTokens(null).size, 0);
});

test('titleJaccard: threshold constant is 0.6', () => {
  assert.equal(REPOST_TITLE_JACCARD_THRESHOLD, 0.6);
});

// §3.3/H8(d): real LinkedIn safety/go wrapper captures (data/prospect.db.bak-predelete-20260717T123449Z,
// id=1 vs id=2 — same "IT Support Associate II, OTS" posting, two renders 12h13m apart). The wrapper
// href stamps a fresh per-render mt= token; url=/urlhash= stay stable across renders of the same link.
const REAL_WRAPPER_RENDER_1 = 'Learn more at <a href="https://www.linkedin.com/safety/go/?url=https%3A%2F%2Famazon%2Ejobs%2Fcontent%2Fen%2Fhow-we-hire%2Faccommodations&amp;amp;urlhash=mAhv&amp;amp;mt=V52UI77RGdsrI8t47Fj9fulnnxQKbSf1Ki7pnQR58dgZleLJaZHuRT8cSE8r7lKQMUhCuCTY1xcsZHcfELIbTchYwEQ&amp;amp;isSdui=true">https://amazon.jobs/content/en/how-we-hire/accommodations</a> for more information.';
const REAL_WRAPPER_RENDER_2 = 'Learn more at <a href="https://www.linkedin.com/safety/go/?url=https%3A%2F%2Famazon%2Ejobs%2Fcontent%2Fen%2Fhow-we-hire%2Faccommodations&amp;amp;urlhash=mAhv&amp;amp;mt=1H_EcC9y7ck_nMWZmGbSeCdtqpPuJBGkBh6cXVkIX8lnHU84WK6HQ2gqAfvMLCYIwzpTFA7pMFzKu1DIe60zOankwY4&amp;amp;isSdui=true">https://amazon.jobs/content/en/how-we-hire/accommodations</a> for more information.';
const REAL_WRAPPER_DIFFERENT_URL = 'Learn more at <a href="https://www.linkedin.com/safety/go/?url=https%3A%2F%2Fhiring%2Eamazon%2Ecom%2Fwhy-amazon%2Fbenefits&amp;amp;urlhash=NYcP&amp;amp;mt=ByNUsz5_Tj6rXwKRQZoo7R1NwKLQ0eDiaNp3aVg5UzAARU4xsHMon33O8zDMUFdLTnbvcB5cAJAGSChGFjqAHd7h6SA&amp;amp;isSdui=true">https://hiring.amazon.com/why-amazon/benefits</a> for more information.';

test('descHash: real recaptures differing only in the safety/go mt= token hash equal', () => {
  assert.equal(descHash(REAL_WRAPPER_RENDER_1), descHash(REAL_WRAPPER_RENDER_2));
});

test('descHash: a genuinely different safety/go url= still hashes differently (no over-strip collision)', () => {
  assert.notEqual(descHash(REAL_WRAPPER_RENDER_1), descHash(REAL_WRAPPER_DIFFERENT_URL));
});

test('descHash: regression — description with no safety/go mt= wrapper is unaffected by the strip', () => {
  const plain = 'Senior Backend Engineer at Acme Corp.  Remote-first,   competitive pay.';
  const preChangeHash = crypto.createHash('sha256')
    .update(plain.trim().replace(/\s+/g, ' ').toLowerCase())
    .digest('hex');
  assert.equal(descHash(plain), preChangeHash);
});

test('lineDiff: identical text is all context, no add/remove', () => {
  const diff = lineDiff('a\nb\nc', 'a\nb\nc');
  assert.deepEqual(diff.map((d) => d.type), ['context', 'context', 'context']);
});

test('lineDiff: pure insertion adds one line, keeps the rest as context', () => {
  const diff = lineDiff('a\nb', 'a\nx\nb');
  assert.deepEqual(diff, [
    { type: 'context', text: 'a' },
    { type: 'add', text: 'x' },
    { type: 'context', text: 'b' },
  ]);
});

test('detectRepost: EXACT tier on desc_hash equality, prefers most-recent on ties', () => {
  const db = freshDb();
  const { listingId: l1, claimId: c1 } = seedListing(db, { company: 'Acme Corp', role: 'Senior Backend Engineer', description: 'same text here' });
  const { listingId: l2, claimId: c2 } = seedListing(db, { company: 'Acme Corp', role: 'Senior Backend Engineer', description: 'same text here' });

  const hit = detectRepost(db, { descHash: descHash('same text here'), canonicalName: canonicalCompanyName('Acme Corp'), role: 'Senior Backend Engineer' });
  assert.equal(hit.tier, 'exact');
  assert.equal(hit.prior_listing_id, l2); // most recent of the two exact matches
  assert.equal(hit.prior_claim_id, c2);
  assert.ok(l1 < l2 && c1 < c2); // sanity: l2/c2 really is the later row
});

test('detectRepost: LIKELY tier on same canonical company + role overlap >= threshold', () => {
  const db = freshDb();
  seedListing(db, { company: 'Acme Corp', role: 'Senior Backend Engineer', description: 'v1 description' });

  const hit = detectRepost(db, { descHash: descHash('a different description'), canonicalName: canonicalCompanyName('Acme Corp'), role: 'Senior Backend Engineer II' });
  assert.equal(hit.tier, 'likely');
  assert.ok(hit.title_similarity >= REPOST_TITLE_JACCARD_THRESHOLD);
});

test('detectRepost: no false positive across different companies', () => {
  const db = freshDb();
  seedListing(db, { company: 'Acme Corp', role: 'Senior Backend Engineer', description: 'v1 description' });

  const hit = detectRepost(db, { descHash: descHash('unrelated'), canonicalName: canonicalCompanyName('Globex Inc'), role: 'Senior Backend Engineer' });
  assert.equal(hit, null);
});

test('detectRepost: no false positive on unrelated role within same company', () => {
  const db = freshDb();
  seedListing(db, { company: 'Acme Corp', role: 'Data Scientist', description: 'v1 description' });

  const hit = detectRepost(db, { descHash: descHash('unrelated'), canonicalName: canonicalCompanyName('Acme Corp'), role: 'Warehouse Associate' });
  assert.equal(hit, null);
});

test('detectRepost: no corpus match returns null (never throws)', () => {
  const db = freshDb();
  const hit = detectRepost(db, { descHash: descHash('nothing seeded yet'), canonicalName: null, role: 'Anything' });
  assert.equal(hit, null);
});

test('faithful-tracker: linkRepost writes only the incoming listing row, prior is immutable', () => {
  const db = freshDb();
  const { listingId: priorListingId } = seedListing(db, { company: 'Acme Corp', role: 'Senior Backend Engineer', description: 'prior text' });
  const { listingId: incomingListingId, claimId: incomingClaimId } = seedListing(db, { company: 'Acme Corp', role: 'Senior Backend Engineer', description: 'prior text' });

  const priorBefore = db.prepare('SELECT * FROM listings WHERE id = ?').get(priorListingId);

  const result = linkRepost(db, incomingClaimId, priorListingId);
  assert.deepEqual(result, { listing_id: incomingListingId, repost_of: priorListingId, snapshot_generation: 2 });

  const priorAfter = db.prepare('SELECT * FROM listings WHERE id = ?').get(priorListingId);
  assert.deepEqual(priorBefore, priorAfter);

  const incomingAfter = db.prepare('SELECT * FROM listings WHERE id = ?').get(incomingListingId);
  assert.equal(incomingAfter.repost_of, priorListingId);
  assert.equal(incomingAfter.snapshot_generation, 2);
  assert.equal(incomingAfter.description, 'prior text'); // verbatim snapshot untouched by the link
});

test('linkRepost: chain-correct generation (prior generation + 1)', () => {
  const db = freshDb();
  const { listingId: gen1 } = seedListing(db, { company: 'Acme Corp', role: 'Role', description: 'x' });
  const { listingId: gen2, claimId: gen2Claim } = seedListing(db, { company: 'Acme Corp', role: 'Role', description: 'x' });
  linkRepost(db, gen2Claim, gen1); // gen2 is now generation 2

  const { listingId: gen3, claimId: gen3Claim } = seedListing(db, { company: 'Acme Corp', role: 'Role', description: 'x' });
  const result = linkRepost(db, gen3Claim, gen2);
  assert.equal(result.snapshot_generation, 3);
});

test('linkRepost: rejects self-link', () => {
  const db = freshDb();
  const { listingId, claimId } = seedListing(db, { company: 'Acme Corp', role: 'Role', description: 'x' });
  assert.throws(() => linkRepost(db, claimId, listingId), (err) => err instanceof RepostLinkError && err.status === 400);
});

test('linkRepost: rejects a non-existent repost_of', () => {
  const db = freshDb();
  const { claimId } = seedListing(db, { company: 'Acme Corp', role: 'Role', description: 'x' });
  assert.throws(() => linkRepost(db, claimId, 999999), (err) => err instanceof RepostLinkError && err.status === 400);
});

test('linkRepost: 404s on a missing claim', () => {
  const db = freshDb();
  assert.throws(() => linkRepost(db, 999999, 1), (err) => err instanceof RepostLinkError && err.status === 404);
});

// §5.2.3 semantic tier — unit tests over detectSemanticRepost in isolation
// (KNN + threshold only; the embed call itself lives in server/embed.js and is
// exercised end-to-end, including the never-blocks guarantee, in
// test/repost-semantic-capture.test.mjs).
function vecBuffer(embedding) {
  return Buffer.from(Float32Array.from(embedding).buffer);
}
function fixedVector(seed) {
  return Array.from({ length: 768 }, (_, i) => Math.sin(seed * 1000 + i) * 0.01);
}
// Adds a constant delta to every dimension so the resulting L2 distance from
// `base` is exactly `targetL2` (sqrt(n * delta^2) = delta * sqrt(n) = targetL2).
function perturbedVector(base, targetL2) {
  const delta = targetL2 / Math.sqrt(base.length);
  return base.map((v) => v + delta);
}

test('detectSemanticRepost: nearest neighbor within REPOST_SEMANTIC_L2_MAX returns tier semantic with the right prior_listing_id', () => {
  const db = freshDb();
  const { listingId } = seedListing(db, { company: 'Acme Corp', role: 'Senior Backend Engineer', description: 'v1 description' });
  const baseVector = fixedVector(1);
  db.prepare('INSERT INTO listings_vec (listing_id, embedding) VALUES (?, ?)').run(BigInt(listingId), vecBuffer(baseVector));

  const incoming = perturbedVector(baseVector, 0.1); // well under the 0.3 threshold
  const hit = detectSemanticRepost(db, vecBuffer(incoming));
  assert.ok(hit);
  assert.equal(hit.tier, 'semantic');
  assert.equal(hit.prior_listing_id, listingId);
  assert.ok(hit.distance <= REPOST_SEMANTIC_L2_MAX, `distance ${hit.distance} should be <= ${REPOST_SEMANTIC_L2_MAX}`);
});

test('detectSemanticRepost: nearest neighbor beyond REPOST_SEMANTIC_L2_MAX returns null', () => {
  const db = freshDb();
  const { listingId } = seedListing(db, { company: 'Acme Corp', role: 'Senior Backend Engineer', description: 'v1 description' });
  const baseVector = fixedVector(1);
  db.prepare('INSERT INTO listings_vec (listing_id, embedding) VALUES (?, ?)').run(BigInt(listingId), vecBuffer(baseVector));

  const incoming = perturbedVector(baseVector, 0.6); // well over the 0.3 threshold
  const hit = detectSemanticRepost(db, vecBuffer(incoming));
  assert.equal(hit, null);
});

test('detectSemanticRepost: empty listings_vec returns null (never throws)', () => {
  const db = freshDb();
  const hit = detectSemanticRepost(db, vecBuffer(fixedVector(1)));
  assert.equal(hit, null);
});
