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
const profile = JSON.parse(fs.readFileSync(path.join(root, 'config', 'scout-profile.json'), 'utf8'));
const indexUrl = pathToFileURL(path.join(root, 'server', 'index.js')).href;
const dbModuleUrl = pathToFileURL(path.join(root, 'server', 'db.js')).href;
const port = 8814;

test('Scout HTTP flow imports a lead and existing capture auto-links it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-scout-route-'));
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
    const api = async (route, options = {}) => {
      const response = await realFetch('http://127.0.0.1:${port}' + route, options);
      const body = (response.headers.get('content-type') || '').includes('json')
        ? await response.json() : await response.text();
      return { status: response.status, body };
    };
    const headers = { 'content-type': 'application/json' };
    const profileResult = await api('/api/scout/profile', {
      method: 'POST', headers, body: ${JSON.stringify(JSON.stringify(profile))}
    });
    const importResult = await api('/api/scout/discoveries/import', {
      method: 'POST', headers, body: JSON.stringify({
        source: 'linkedin-alert',
        jobs: [{
          external_job_id: 'route-123',
          source_url: 'https://www.linkedin.com/jobs/view/route-123/',
          company: 'Route Co',
          role: 'Desktop Support Technician',
          location: 'Dallas, Texas',
          description: 'Windows imaging with SCCM and Active Directory.'
        }, {
          external_job_id: 'stake-route-456',
          source_url: 'https://www.linkedin.com/jobs/view/stake-route-456/',
          company: 'Stake Route Co',
          role: 'Desktop Support Specialist',
          location: 'Austin, Texas',
          description: 'Helpdesk and end user support.'
        }]
      })
    });
    const pageResult = await api('/scout');

    // Test provisional stake API route
    const discoveriesResult = await api('/api/scout?status=review');
    const anomalyResult = await api('/api/scout?status=anomalies');
    const stakeDiscoveryItem = discoveriesResult.body.discoveries.find(d => d.external_job_id === 'stake-route-456');

    const stakeResult = await api('/api/scout/discoveries/' + stakeDiscoveryItem.id + '/stake', {
      method: 'POST', headers
    });

    const repeatStakeResult = await api('/api/scout/discoveries/' + stakeDiscoveryItem.id + '/stake', {
      method: 'POST', headers
    });

    // Snapshot the provisional (generation 1) listing + surrounding claim/transition counts
    // BEFORE the upgrade capture, so we can prove the upgrade never mutates generation 1 and
    // never adds a second claim or a second stage transition.
    const claimsBefore = db.prepare('SELECT COUNT(*) AS n FROM claims').get().n;
    const transitionsBefore = db.prepare(
      'SELECT COUNT(*) AS n FROM stage_transitions WHERE claim_id = ?'
    ).get(stakeResult.body.claim_id).n;
    const gen1Before = db.prepare(
      "SELECT * FROM listings WHERE external_job_id = 'stake-route-456' AND snapshot_generation = 1"
    ).get();

    // Test later extension capture upgrading the same claim. No location field in the payload
    // — mirrors the real Chrome extension capture, which doesn't always observe location; the
    // prior provisional (generation 1) listing has location 'Austin, Texas'. This same capture
    // also exercises the false-repost-warning fix: repost detection runs against the whole
    // corpus before the insert, and the provisional listing it would otherwise self-match is
    // this very job, not an actual repost.
    const upgradeCaptureResult = await api('/api/claims', {
      method: 'POST', headers, body: JSON.stringify({
        source: 'LinkedIn',
        source_url: 'https://www.linkedin.com/jobs/view/stake-route-456/',
        external_job_id: 'stake-route-456',
        company: 'Stake Route Co',
        role: 'Desktop Support Specialist',
        description: 'Enriched full posting description captured from browser.',
        verified: true,
        contacts: [{ name: 'Jane Recruiter', email: 'jane@stakeroute.com', role: 'Recruiter' }]
      })
    });

    const claimsAfter = db.prepare('SELECT COUNT(*) AS n FROM claims').get().n;
    const transitionsAfter = db.prepare(
      'SELECT COUNT(*) AS n FROM stage_transitions WHERE claim_id = ?'
    ).get(stakeResult.body.claim_id).n;
    const gen1After = db.prepare(
      "SELECT * FROM listings WHERE external_job_id = 'stake-route-456' AND snapshot_generation = 1"
    ).get();
    const gen2After = db.prepare(
      "SELECT * FROM listings WHERE external_job_id = 'stake-route-456' AND snapshot_generation = 2"
    ).get();

    const claimResult = await api('/api/claims', {
      method: 'POST', headers, body: JSON.stringify({
        source: 'LinkedIn',
        source_url: 'https://www.linkedin.com/jobs/view/route-123/',
        external_job_id: 'route-123',
        company: 'Route Co',
        role: 'Desktop Support Technician',
        description: 'Windows imaging with SCCM and Active Directory.'
      })
    });
    const allResult = await api('/api/scout?status=all');
    const unlinkedClaimResult = await api('/api/claims', {
      method: 'POST', headers, body: JSON.stringify({
        source: 'LinkedIn',
        source_url: 'https://www.linkedin.com/jobs/view/unlinked-999/',
        external_job_id: 'unlinked-999',
        company: 'Standalone Co',
        role: 'Analyst'
      })
    });
    console.log('RESULT_JSON:' + JSON.stringify({
      profileResult, importResult, pageResult, anomalyResult, stakeResult, repeatStakeResult, upgradeCaptureResult, claimResult, allResult, unlinkedClaimResult,
      claimsBefore, claimsAfter, transitionsBefore, transitionsAfter, gen1Before, gen1After, gen2After
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
    assert.equal(result.profileResult.status, 201);
    assert.equal(result.importResult.status, 201);
    assert.equal(result.pageResult.status, 200);
    assert.match(result.pageResult.body, /Desktop Support Technician/);
    assert.equal(result.anomalyResult.status, 200);
    assert.ok(Array.isArray(result.anomalyResult.body.discoveries));
    assert.ok(result.anomalyResult.body.counts.anomalies >= 0);

    // Stake route assertions
    assert.equal(result.stakeResult.status, 201);
    assert.ok(result.stakeResult.body.claim_id > 0);
    assert.equal(result.stakeResult.body.created, true);

    assert.equal(result.repeatStakeResult.status, 200);
    assert.equal(result.repeatStakeResult.body.claim_id, result.stakeResult.body.claim_id);
    assert.equal(result.repeatStakeResult.body.created, false);

    // Upgrade capture assertions
    assert.equal(result.upgradeCaptureResult.status, 201);
    assert.equal(result.upgradeCaptureResult.body.claim_id, result.stakeResult.body.claim_id);
    assert.equal(result.upgradeCaptureResult.body.scout_enriched, true);
    assert.equal(result.upgradeCaptureResult.body.upgraded_existing_claim, true);
    // Fix A: the provisional listing is the same job, not a repost — must never surface a
    // repost warning on the upgrade capture.
    assert.equal(result.upgradeCaptureResult.body.repost_candidate, null);

    // The upgrade must retain exactly one claim (no second claim row created) and exactly one
    // stage transition (the original 'staked' transition; upgrading never adds another).
    assert.equal(result.claimsAfter, result.claimsBefore, 'upgrade capture creates no new claim');
    assert.equal(result.transitionsAfter, result.transitionsBefore, 'upgrade capture adds no new stage transition');
    assert.equal(result.transitionsAfter, 1, 'exactly the original staked transition survives');

    // Generation 1 (the Scout-provisional listing) must be byte-unchanged by the upgrade.
    assert.ok(result.gen1Before, 'generation 1 listing exists before the upgrade');
    assert.deepEqual(result.gen1After, result.gen1Before, 'generation 1 listing is untouched (INSERT-only upgrade)');
    assert.equal(result.gen1Before.location, 'Austin, Texas');

    // Fix B: generation 2 is a new INSERT that carries forward the missing location from
    // generation 1, with explicit inherited-field provenance in its own parsed JSON — never an
    // UPDATE to generation 1, and never a claim that the extension itself captured location.
    assert.ok(result.gen2After, 'generation 2 listing was created');
    assert.equal(result.gen2After.location, 'Austin, Texas');
    const gen2Parsed = JSON.parse(result.gen2After.parsed);
    assert.equal(gen2Parsed.inherited_from_listing_id, result.gen1Before.id);
    assert.deepEqual(gen2Parsed.inherited_fields, ['location']);
    assert.equal(gen2Parsed.verification_status, 'browser-captured');

    assert.equal(result.claimResult.status, 201);
    assert.equal(result.claimResult.body.scout_enriched, true);
    assert.equal(result.allResult.body.discoveries.find(d => d.external_job_id === 'route-123').status, 'captured');
    assert.equal(result.unlinkedClaimResult.status, 201);
    assert.equal(result.unlinkedClaimResult.body.scout_enriched, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
