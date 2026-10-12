import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { loadVecExtension } from '../server/vecExtension.js';
import {
  enqueueApplicationGeneration, failOrRetryGenerationJob, leaseNextGenerationJob, latestGenerationJob,
} from '../server/applicationGenerationQueue.js';
import { queueNewScoutStakedClaim, queueStakedTransition } from '../server/applicationGenerationOrchestrator.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');

function fixture() {
  const database = new Database(':memory:'); loadVecExtension(database); database.exec(schema);
  database.prepare("INSERT INTO listings (id, source, company, role, snapshot_generation, snapshot_hash) VALUES (1,'test','Example','Tech',4,?)").run('a'.repeat(64));
  database.prepare("INSERT INTO resume_versions (id,label,body,kind) VALUES (1,'Baseline','body','baseline')").run();
  database.prepare("INSERT INTO claims (id,listing_id,stage,resume_version_id) VALUES (1,1,'Staked',1)").run();
  return database;
}

test('automatic queueing is source-snapshot idempotent while regeneration stays immutable', () => {
  const database = fixture();
  const first = enqueueApplicationGeneration(database, 1, { triggerKind: 'staked_transition' });
  const repeated = enqueueApplicationGeneration(database, 1, { triggerKind: 'staked_transition' });
  const regenerated = enqueueApplicationGeneration(database, 1, { triggerKind: 'manual_regenerate', regenerate: true });
  assert.equal(first.created, true); assert.equal(repeated.created, false);
  assert.equal(first.job.id, repeated.job.id); assert.notEqual(regenerated.job.request_key, first.job.request_key);
  assert.equal(database.prepare('SELECT COUNT(*) n FROM application_generation_jobs').get().n, 2);
  assert.equal(latestGenerationJob(database, 1).id, regenerated.job.id);
  database.close();
});

test('leases are atomic, suppress concurrent workers, and recover after expiry', () => {
  const database = fixture(); enqueueApplicationGeneration(database, 1);
  const leased = leaseNextGenerationJob(database, 'worker-a', { leaseSeconds: 30 });
  assert.equal(leased.status, 'auditing'); assert.equal(leased.attempts, 1);
  assert.equal(leaseNextGenerationJob(database, 'worker-b'), null);
  database.prepare("UPDATE application_generation_jobs SET lease_expires_at=datetime('now','-1 second') WHERE id=?").run(leased.id);
  const recovered = leaseNextGenerationJob(database, 'worker-b');
  assert.equal(recovered.id, leased.id); assert.equal(recovered.attempts, 2); assert.equal(recovered.lease_owner, 'worker-b');
  database.close();
});

test('retry can retire a missing provider token before issuing a fresh attempt', () => {
  const database = fixture(); enqueueApplicationGeneration(database, 1);
  const leased = leaseNextGenerationJob(database, 'worker-a', { leaseSeconds: 30 });
  database.prepare(`
    UPDATE application_generation_jobs
    SET status='drafting', provider='auto', model='missing-model', run_token='FLEET-BUILD-missing',
        staging_path='/tmp/missing.json', response_token_match=0
    WHERE id=?
  `).run(leased.id);
  const retried = failOrRetryGenerationJob(database, {
    ...leased, status: 'drafting', run_token: 'FLEET-BUILD-missing',
  }, 'worker-a', new Error('Tower run is missing'), { backoffSeconds: 1, resetProviderAttempt: true });
  assert.equal(retried.status, 'queued');
  assert.equal(retried.run_token, null);
  assert.equal(retried.provider, null);
  assert.equal(retried.model, null);
  assert.equal(retried.staging_path, null);
  assert.equal(retried.response_token_match, null);
  assert.match(retried.error, /Tower run is missing/);
  database.close();
});

test('route orchestrators queue only real future Staked entries', () => {
  const database = fixture();
  database.prepare("UPDATE claims SET stage='Showings' WHERE id=1").run();
  assert.equal(queueStakedTransition(database, 1, 'Showings', 'Staked').created, true);
  assert.equal(queueStakedTransition(database, 1, 'Staked', 'Staked').created, false);
  assert.equal(queueStakedTransition(database, 1, 'Staked', 'Tailings').created, false);
  assert.equal(database.prepare('SELECT COUNT(*) n FROM application_generation_jobs').get().n, 1);
  database.prepare("UPDATE claims SET stage='Staked' WHERE id=1").run();
  assert.equal(queueNewScoutStakedClaim(database, 1, false).created, false, 'already-linked Scout claim');
  assert.equal(queueNewScoutStakedClaim(database, 1, true).created, true, 'genuinely new Staked Scout claim');
  assert.equal(queueNewScoutStakedClaim(database, 1, true).created, false, 'same Scout source is idempotent');
  assert.equal(database.prepare('SELECT COUNT(*) n FROM application_generation_jobs').get().n, 2);
  database.close();
});
