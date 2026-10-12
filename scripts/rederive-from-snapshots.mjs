#!/usr/bin/env node
// scripts/rederive-from-snapshots.mjs — re-run the capture adapter over snapshots already stored,
// and fill in curated columns it previously failed to extract.
//
// WHY THIS IS ALLOWED, and where the line is. listings.raw_payload is the immutable verbatim
// snapshot and is NEVER touched here. The curated columns (location, posted_at, verified, parsed)
// are adapter-DERIVED, and DL-P2 keeps derivation separate from captured truth precisely so a
// better derivation can be applied later. This is that: same bytes, better reader.
//
// The hard rule below is fill-only. A column that already holds a value is left exactly as it is,
// even if the adapter now disagrees, because a stored value may have been corrected by hand and
// this script has no way to tell. Only NULLs are filled. Nothing is overwritten, nothing is
// deleted, and no new snapshot generation is created -- the snapshot did not change, only what we
// can read out of it.
//
// jsdom lives in extension/ (dev-only tooling for the adapter tests) and is not a server
// dependency. It is resolved from there explicitly rather than via NODE_PATH, which ESM ignores.
//
// Usage (from repo root):
//   node scripts/rederive-from-snapshots.mjs            # dry run
//   node scripts/rederive-from-snapshots.mjs --apply

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createRequire } from 'node:module';

import { loadVecExtension } from '../server/vecExtension.js';
import { recordObservation } from '../server/vendorStatus.js';

const apply = process.argv.includes('--apply');
const dbPath = process.env.PROSPECT_DB_PATH || path.join(process.cwd(), 'data', 'prospect.db');

const extensionRequire = createRequire(path.join(process.cwd(), 'extension', 'package.json'));
let JSDOM;
try {
  ({ JSDOM } = extensionRequire('jsdom'));
} catch {
  console.error('jsdom not found. Run `npm install` in extension/ first.');
  process.exit(2);
}

globalThis.self = globalThis;
await import('../extension/src/adapters/linkedin.js');
const adapter = globalThis.ProspectAdapters.linkedin;

const db = new Database(dbPath, { readonly: !apply });
loadVecExtension(db);

// Only listings whose snapshot came from the browser adapter can be re-read; a Scout alert row
// carries a few bytes of alert text, not a page.
const rows = db.prepare(`
  SELECT l.id, l.source, l.company, l.role, l.location, l.posted_at, l.verified, l.parsed,
         l.raw_payload, l.source_url, c.id AS claim_id
  FROM listings l LEFT JOIN claims c ON c.listing_id = l.id
  WHERE l.raw_payload IS NOT NULL AND length(l.raw_payload) > 1000
  ORDER BY l.id ASC
`).all();

console.log(`${apply ? 'APPLY' : 'DRY RUN'} — ${rows.length} listing(s) with a browser snapshot\n`);

const FILLABLE = ['location', 'posted_at', 'verified'];
let changed = 0;
const closures = [];

for (const row of rows) {
  let payload;
  try { payload = JSON.parse(row.raw_payload); } catch { continue; }
  if (!payload || typeof payload.jobDetailHtml !== 'string') continue;

  let parsedOut;
  try {
    const doc = new JSDOM(payload.jobDetailHtml).window.document;
    // Anchor to the snapshot's OWN capture time. posted_at comes from a relative label, so
    // re-reading a three-week-old snapshot against today's clock would move every date by three
    // weeks. A snapshot with no recorded capturedAt is skipped rather than guessed at.
    if (!payload.capturedAt) {
      console.log(`  listing ${row.id}: snapshot has no capturedAt — skipped (cannot anchor posted_at)`);
      continue;
    }
    parsedOut = adapter.parse(doc, payload.url || row.source_url || '', { capturedAt: payload.capturedAt });
  } catch (err) {
    console.log(`  listing ${row.id}: adapter threw (${err.message}) — skipped`);
    continue;
  }

  const updates = {};
  for (const key of FILLABLE) {
    const current = row[key];
    const derived = parsedOut.fields[key];
    // Fill only. A present value wins, always.
    if (current == null && derived != null && derived !== '') {
      updates[key] = key === 'verified' ? (derived ? 1 : 0) : derived;
    }
  }

  const closedText = parsedOut.fields.parsed && parsedOut.fields.parsed.applications_closed
    ? parsedOut.fields.parsed.applications_closed_text
    : null;

  if (!Object.keys(updates).length && !closedText) continue;

  changed += 1;
  console.log(`listing ${row.id} — ${row.company} / ${row.role}`);
  for (const [k, v] of Object.entries(updates)) console.log(`   ${k}: NULL -> ${JSON.stringify(v)}`);
  if (closedText) console.log(`   employer says: ${JSON.stringify(closedText)}`);

  if (!apply) continue;

  if (Object.keys(updates).length) {
    const sets = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE listings SET ${sets} WHERE id = @id`).run({ ...updates, id: row.id });
  }
  if (closedText && row.claim_id != null) {
    const observed = recordObservation(db, row.claim_id, {
      statusText: closedText,
      sourceUrl: payload.url || row.source_url || null,
      note: 're-derived from the stored snapshot',
    });
    if (observed) closures.push({ claim_id: row.claim_id, status: observed.normalized_status });
  }
}

console.log(`\n${changed} listing(s) ${apply ? 'updated' : 'would change'}.`);
if (closures.length) console.log('closure observations recorded:', JSON.stringify(closures));
db.close();
