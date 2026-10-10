import crypto from 'node:crypto';
import { listingSnapshotHash } from './listingSnapshot.js';

export const GENERATION_STATES = Object.freeze(['queued', 'auditing', 'drafting', 'rendering', 'needs_review', 'ready', 'failed']);
const ACTIVE_STATES = new Set(['queued', 'auditing', 'drafting', 'rendering']);
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

function currentSource(database, claimId, baselineId = null) {
  const claim = database.prepare('SELECT * FROM claims WHERE id=?').get(claimId);
  if (!claim) throw new Error('claim not found');
  const listing = database.prepare('SELECT * FROM listings WHERE id=?').get(claim.listing_id);
  if (!listing) throw new Error('claim has no listing snapshot');
  let baseline = baselineId == null
    ? (claim.resume_version_id == null ? null : database.prepare('SELECT * FROM resume_versions WHERE id=?').get(claim.resume_version_id))
    : database.prepare('SELECT * FROM resume_versions WHERE id=?').get(baselineId);
  if (!baseline) baseline = database.prepare("SELECT * FROM resume_versions WHERE kind='baseline' ORDER BY id DESC LIMIT 1").get() || null;
  const snapHash = listingSnapshotHash(listing);
  const sourceInputHash = sha256(JSON.stringify({
    claim_id: claim.id,
    listing_id: listing.id,
    listing_snapshot_generation: listing.snapshot_generation || 1,
    listing_snapshot_hash: snapHash,
    baseline_resume_version_id: baseline?.id || null,
    baseline_career_claims_sha256: baseline?.career_claims_sha256 || null,
  }));
  return { claim, listing, baseline, snapshotHash: snapHash, sourceInputHash };
}

export function enqueueApplicationGeneration(database, claimId, {
  triggerKind = 'staked_transition', baselineId = null, regenerate = false,
} = {}) {
  const source = currentSource(database, claimId, baselineId);
  const nonce = regenerate ? crypto.randomUUID() : 'automatic-v1';
  const requestKey = sha256(`${source.sourceInputHash}\n${triggerKind}\n${nonce}`);
  const insert = database.prepare(`
    INSERT INTO application_generation_jobs
      (request_key, source_input_hash, trigger_kind, claim_id, listing_id,
       listing_snapshot_generation, listing_snapshot_hash, baseline_resume_version_id,
       status, next_attempt_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', datetime('now'))
    ON CONFLICT(request_key) DO NOTHING
  `).run(requestKey, source.sourceInputHash, triggerKind, source.claim.id, source.listing.id,
    source.listing.snapshot_generation || 1, source.snapshotHash, source.baseline?.id || null);
  const job = database.prepare('SELECT * FROM application_generation_jobs WHERE request_key=?').get(requestKey);
  return { job, created: insert.changes === 1, source };
}

export function latestGenerationJob(database, claimId) {
  return database.prepare('SELECT * FROM application_generation_jobs WHERE claim_id=? ORDER BY id DESC LIMIT 1').get(claimId) || null;
}

export function leaseNextGenerationJob(database, owner, { leaseSeconds = 300 } = {}) {
  if (!owner || !String(owner).trim()) throw new Error('lease owner is required');
  const lease = Math.max(30, Math.min(3600, Number(leaseSeconds) || 300));
  return database.transaction(() => {
    const candidate = database.prepare(`
      SELECT * FROM application_generation_jobs
      WHERE attempts < max_attempts
        AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))
        AND (
          status='queued'
          OR (status IN ('auditing','drafting','rendering') AND lease_expires_at <= datetime('now'))
        )
      ORDER BY id LIMIT 1
    `).get();
    if (!candidate) return null;
    const result = database.prepare(`
      UPDATE application_generation_jobs
      SET lease_owner=?, lease_expires_at=datetime('now', ?), attempts=attempts+1,
          started_at=COALESCE(started_at, datetime('now')), updated_at=datetime('now'), error=NULL,
          status=CASE WHEN status='queued' THEN 'auditing' ELSE status END
      WHERE id=? AND (lease_owner IS NULL OR lease_expires_at <= datetime('now'))
    `).run(String(owner), `+${lease} seconds`, candidate.id);
    return result.changes === 1
      ? database.prepare('SELECT * FROM application_generation_jobs WHERE id=?').get(candidate.id)
      : null;
  })();
}

export function renewGenerationJobLease(database, id, owner, { leaseSeconds = 300 } = {}) {
  if (!owner || !String(owner).trim()) throw new Error('lease owner is required');
  const lease = Math.max(30, Math.min(3600, Number(leaseSeconds) || 300));
  const result = database.prepare(`
    UPDATE application_generation_jobs
    SET lease_expires_at=datetime('now', ?), updated_at=datetime('now')
    WHERE id=? AND lease_owner=? AND status IN ('auditing','drafting','rendering')
  `).run(`+${lease} seconds`, id, String(owner));
  if (result.changes !== 1) throw new Error('generation job lease is not owned by this worker');
  return database.prepare('SELECT * FROM application_generation_jobs WHERE id=?').get(id);
}

export function updateGenerationJob(database, id, owner, status, fields = {}) {
  if (!GENERATION_STATES.includes(status)) throw new Error(`invalid generation status: ${status}`);
  const current = database.prepare('SELECT * FROM application_generation_jobs WHERE id=?').get(id);
  if (!current) throw new Error('generation job not found');
  if (ACTIVE_STATES.has(current.status) && current.lease_owner !== owner) throw new Error('generation job lease is not owned by this worker');
  const terminal = ['needs_review', 'ready', 'failed'].includes(status);
  database.prepare(`
    UPDATE application_generation_jobs SET
      status=@status, package_id=COALESCE(@package_id, package_id),
      provider=COALESCE(@provider, provider), model=COALESCE(@model, model),
      run_token=COALESCE(@run_token, run_token), staging_path=COALESCE(@staging_path, staging_path),
      response_token_match=COALESCE(@response_token_match, response_token_match),
      error=@error, next_attempt_at=@next_attempt_at, updated_at=datetime('now'),
      completed_at=CASE WHEN @terminal=1 THEN datetime('now') ELSE completed_at END,
      lease_owner=CASE WHEN @terminal=1 THEN NULL ELSE lease_owner END,
      lease_expires_at=CASE WHEN @terminal=1 THEN NULL ELSE lease_expires_at END
    WHERE id=@id
  `).run({
    id, status, package_id: fields.packageId ?? null, provider: fields.provider ?? null,
    model: fields.model ?? null, run_token: fields.runToken ?? null,
    staging_path: fields.stagingPath ?? null,
    response_token_match: fields.responseTokenMatch == null ? null : Number(Boolean(fields.responseTokenMatch)),
    error: fields.error == null ? null : String(fields.error).slice(0, 2000),
    next_attempt_at: fields.nextAttemptAt ?? null, terminal: Number(terminal),
  });
  return database.prepare('SELECT * FROM application_generation_jobs WHERE id=?').get(id);
}

export function failOrRetryGenerationJob(database, job, owner, error, {
  backoffSeconds = 60, resetProviderAttempt = false,
} = {}) {
  const message = String(error?.message || error).slice(0, 2000);
  if (job.attempts >= job.max_attempts) return updateGenerationJob(database, job.id, owner, 'failed', { error: message });
  database.prepare(`
    UPDATE application_generation_jobs SET status='queued', error=?, next_attempt_at=datetime('now', ?),
      provider=CASE WHEN ?=1 THEN NULL ELSE provider END,
      model=CASE WHEN ?=1 THEN NULL ELSE model END,
      run_token=CASE WHEN ?=1 THEN NULL ELSE run_token END,
      staging_path=CASE WHEN ?=1 THEN NULL ELSE staging_path END,
      response_token_match=CASE WHEN ?=1 THEN NULL ELSE response_token_match END,
      lease_owner=NULL, lease_expires_at=NULL, updated_at=datetime('now')
    WHERE id=? AND lease_owner=?
  `).run(message, `+${Math.max(1, Number(backoffSeconds) || 60)} seconds`,
    ...Array(5).fill(Number(Boolean(resetProviderAttempt))), job.id, owner);
  return database.prepare('SELECT * FROM application_generation_jobs WHERE id=?').get(job.id);
}
