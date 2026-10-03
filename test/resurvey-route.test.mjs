import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';

import { loadVecExtension } from '../server/vecExtension.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
const indexUrl = pathToFileURL(path.join(root, 'server', 'index.js')).href;
const dbModuleUrl = pathToFileURL(path.join(root, 'server', 'db.js')).href;
const port = 8815;

test('verified re-survey appends generations, repairs preserved location, and rapid repeats are idempotent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-resurvey-route-'));
  const dbPath = path.join(dir, 'scratch.db');
  const scriptPath = path.join(dir, 'run.mjs');
  const setup = new Database(dbPath);
  loadVecExtension(setup);
  setup.exec(schema);
  setup.close();

  fs.writeFileSync(scriptPath, `
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('simulated Ollama outage'); };
    await import(${JSON.stringify(indexUrl)});
    const { db } = await import(${JSON.stringify(dbModuleUrl)});
    await new Promise((resolve) => setTimeout(resolve, 200));
    const api = async (body) => {
      const response = await realFetch('http://127.0.0.1:${port}/api/claims', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };

    const identity = {
      source: 'LinkedIn',
      source_url: 'https://www.linkedin.com/jobs/view/resurvey-123/',
      external_job_id: 'resurvey-123',
      company: 'Resurvey Co',
      role: 'Infrastructure Support Technician',
      verified: true,
    };
    const first = await api({
      ...identity,
      raw_payload: 'generation-one',
      location: 'Dallas, Texas',
      description: 'First verified description.',
      parsed: { parsed_by: 'adapter' },
    });

    // Model the real Claim #16 legacy shape: a prior browser generation exists,
    // points back to the email/current generation, but omitted location.
    const gen1 = db.prepare('SELECT * FROM listings WHERE id=?').get(first.body.listing_id);
    const legacyInfo = db.prepare(\`
      INSERT INTO listings (
        source, source_url, raw_payload, company, role, location, description,
        snapshot_hash, external_job_id, verified, snapshot_generation, parsed
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 1, 2, ?)
    \`).run(
      'LinkedIn',
      identity.source_url,
      'legacy-generation-two',
      identity.company,
      identity.role,
      'Legacy browser capture with missing location.',
      'legacy-hash',
      identity.external_job_id,
      JSON.stringify({
        capture_source: 'browser-extension',
        verification_status: 'browser-captured',
        supersedes_listing_id: gen1.id,
      }),
    );
    const legacyListingId = Number(legacyInfo.lastInsertRowid);
    db.prepare("UPDATE claims SET listing_id=? WHERE id=?").run(legacyListingId, first.body.claim_id);
    const legacyBefore = db.prepare('SELECT * FROM listings WHERE id=?').get(legacyListingId);
    const gen1Before = db.prepare('SELECT * FROM listings WHERE id=?').get(gen1.id);

    const refreshedBody = {
      ...identity,
      raw_payload: 'generation-three',
      description: 'Fresh browser description with new duties.',
      parsed: { parsed_by: 'adapter' },
    };
    const refreshed = await api(refreshedBody);
    const exactRepeat = await api(refreshedBody);

    const rapidBody = {
      ...identity,
      raw_payload: 'generation-four-rapid',
      description: 'Another fresh browser snapshot.',
      parsed: { parsed_by: 'adapter' },
    };
    const rapid = await Promise.all([api(rapidBody), api(rapidBody)]);

    const claim = db.prepare('SELECT * FROM claims WHERE id=?').get(first.body.claim_id);
    const listings = db.prepare(
      'SELECT * FROM listings WHERE external_job_id=? ORDER BY snapshot_generation, id'
    ).all(identity.external_job_id);
    const transitions = db.prepare(
      'SELECT * FROM stage_transitions WHERE claim_id=? ORDER BY id'
    ).all(first.body.claim_id);
    const claimsCount = db.prepare('SELECT COUNT(*) AS n FROM claims').get().n;
    const gen1After = db.prepare('SELECT * FROM listings WHERE id=?').get(gen1.id);
    const legacyAfter = db.prepare('SELECT * FROM listings WHERE id=?').get(legacyListingId);

    console.log('RESULT_JSON:' + JSON.stringify({
      first,
      refreshed,
      exactRepeat,
      rapid,
      claim,
      listings,
      transitions,
      claimsCount,
      gen1Before,
      gen1After,
      legacyBefore,
      legacyAfter,
    }));
    process.exit(0);
  `);

  try {
    const output = execFileSync(process.execPath, [scriptPath], {
      env: { ...process.env, PROSPECT_DB_PATH: dbPath, PORT: String(port) },
      timeout: 10000,
    }).toString();
    const line = output.split('\n').find((value) => value.startsWith('RESULT_JSON:'));
    assert.ok(line, `missing child result: ${output}`);
    const result = JSON.parse(line.slice('RESULT_JSON:'.length));

    assert.equal(result.first.status, 201);
    assert.equal(result.refreshed.status, 201);
    assert.equal(result.refreshed.body.claim_id, result.first.body.claim_id);
    assert.equal(result.refreshed.body.refreshed_existing_claim, true);
    assert.equal(result.refreshed.body.upgraded_existing_claim, false);
    assert.equal(result.refreshed.body.duplicate_capture, false);
    assert.equal(result.refreshed.body.created_snapshot, true);
    assert.equal(result.refreshed.body.snapshot_generation, 3);
    assert.equal(result.refreshed.body.repost_candidate, null);

    assert.equal(result.exactRepeat.status, 200);
    assert.equal(result.exactRepeat.body.claim_id, result.first.body.claim_id);
    assert.equal(result.exactRepeat.body.duplicate_capture, true);
    assert.equal(result.exactRepeat.body.created_snapshot, false);
    assert.equal(result.exactRepeat.body.snapshot_generation, 3);
    assert.equal(result.exactRepeat.body.repost_candidate, null);

    const rapidStatuses = result.rapid.map((entry) => entry.status).sort();
    assert.deepEqual(rapidStatuses, [200, 201], 'rapid identical POSTs append exactly once');
    assert.ok(result.rapid.every((entry) => entry.body.claim_id === result.first.body.claim_id));
    assert.ok(result.rapid.every((entry) => entry.body.snapshot_generation === 4));
    assert.equal(result.rapid.filter((entry) => entry.body.created_snapshot).length, 1);
    assert.equal(result.rapid.filter((entry) => entry.body.duplicate_capture).length, 1);

    assert.equal(result.claimsCount, 1, 're-survey never creates another claim');
    assert.equal(result.transitions.length, 1, 're-survey never creates another initial transition');
    assert.equal(result.listings.length, 4, 'only gen1, legacy gen2, gen3, and one rapid gen4 exist');
    assert.equal(result.claim.listing_id, result.listings[3].id);
    assert.deepEqual(result.gen1After, result.gen1Before, 'generation 1 remains byte-unchanged');
    assert.deepEqual(result.legacyAfter, result.legacyBefore, 'legacy generation 2 remains byte-unchanged');

    const gen3 = result.listings.find((listing) => listing.snapshot_generation === 3);
    const gen4 = result.listings.find((listing) => listing.snapshot_generation === 4);
    assert.equal(gen3.location, 'Dallas, Texas');
    assert.equal(gen4.location, 'Dallas, Texas');
    const parsed3 = JSON.parse(gen3.parsed);
    const parsed4 = JSON.parse(gen4.parsed);
    assert.equal(parsed3.supersedes_listing_id, result.legacyBefore.id);
    assert.equal(parsed3.inherited_from_listing_id, result.gen1Before.id);
    assert.deepEqual(parsed3.inherited_fields, ['location']);
    assert.equal(parsed3.resurvey_of_claim_id, result.first.body.claim_id);
    assert.equal(parsed3.resurvey_kind, 'verified-resurvey');
    assert.equal(parsed4.supersedes_listing_id, gen3.id);
    assert.equal(parsed4.inherited_from_listing_id, gen3.id);
    assert.deepEqual(parsed4.inherited_fields, ['location']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
