import crypto from 'node:crypto';

export const INTERVIEW_RESEARCH_STATES = Object.freeze(['queued', 'researching', 'ready', 'failed']);
const ACTIVE_STATES = new Set(['queued', 'researching']);
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

export function enqueueInterviewResearch(database, preparationId, { retry = false } = {}) {
  const preparation = database.prepare('SELECT * FROM interview_preparations WHERE id=?').get(preparationId);
  if (!preparation) throw new Error('interview preparation not found');
  const active = database.prepare(`
    SELECT * FROM interview_research_jobs
    WHERE preparation_id=? AND status IN ('queued','researching') ORDER BY id DESC LIMIT 1
  `).get(preparationId);
  if (active) return { job: active, created: false };
  if (!retry) {
    const ready = database.prepare(`
      SELECT * FROM interview_research_jobs
      WHERE preparation_id=? AND status='ready' ORDER BY id DESC LIMIT 1
    `).get(preparationId);
    if (ready) return { job: ready, created: false };
  }
  const nonce = retry ? crypto.randomUUID() : 'research-v1';
  const sourceInputHash = sha256(JSON.stringify({
    preparation_id: preparation.id,
    preparation_source_input_hash: preparation.source_input_hash,
    deterministic_prompt_version: preparation.prompt_version,
    research_prompt_version: 'interview-research-v1',
  }));
  const requestKey = sha256(`${sourceInputHash}\n${nonce}`);
  const info = database.prepare(`
    INSERT INTO interview_research_jobs
      (request_key,source_input_hash,preparation_id,claim_id,listing_id,status,next_attempt_at)
    VALUES (?,?,?,?,?,'queued',datetime('now'))
    ON CONFLICT(request_key) DO NOTHING
  `).run(requestKey, sourceInputHash, preparation.id, preparation.claim_id, preparation.listing_id);
  const job = database.prepare('SELECT * FROM interview_research_jobs WHERE request_key=?').get(requestKey);
  if (info.changes === 1) {
    database.prepare("INSERT INTO interview_preparation_events (preparation_id,kind,payload) VALUES (?,'research_queued',?)")
      .run(preparation.id, JSON.stringify({ research_job_id: job.id, source_input_hash: sourceInputHash }));
  }
  return { job, created: info.changes === 1 };
}

export function latestInterviewResearchJob(database, preparationId) {
  return database.prepare('SELECT * FROM interview_research_jobs WHERE preparation_id=? ORDER BY id DESC LIMIT 1').get(preparationId) || null;
}

export function leaseNextInterviewResearchJob(database, owner, { leaseSeconds = 300 } = {}) {
  if (!owner || !String(owner).trim()) throw new Error('lease owner is required');
  const lease = Math.max(30, Math.min(3600, Number(leaseSeconds) || 300));
  return database.transaction(() => {
    const candidate = database.prepare(`
      SELECT * FROM interview_research_jobs
      WHERE attempts < max_attempts
        AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))
        AND (status='queued' OR (status='researching' AND lease_expires_at <= datetime('now')))
      ORDER BY id LIMIT 1
    `).get();
    if (!candidate) return null;
    const result = database.prepare(`
      UPDATE interview_research_jobs
      SET lease_owner=?, lease_expires_at=datetime('now', ?), attempts=attempts+1,
          started_at=COALESCE(started_at, datetime('now')), updated_at=datetime('now'),
          error=NULL, status='researching'
      WHERE id=? AND (lease_owner IS NULL OR lease_expires_at <= datetime('now'))
    `).run(String(owner), `+${lease} seconds`, candidate.id);
    return result.changes === 1
      ? database.prepare('SELECT * FROM interview_research_jobs WHERE id=?').get(candidate.id)
      : null;
  })();
}

export function renewInterviewResearchLease(database, id, owner, { leaseSeconds = 300 } = {}) {
  const result = database.prepare(`
    UPDATE interview_research_jobs SET lease_expires_at=datetime('now', ?), updated_at=datetime('now')
    WHERE id=? AND lease_owner=? AND status='researching'
  `).run(`+${Math.max(30, Math.min(3600, Number(leaseSeconds) || 300))} seconds`, id, String(owner));
  if (result.changes !== 1) throw new Error('interview research lease is not owned by this worker');
  return database.prepare('SELECT * FROM interview_research_jobs WHERE id=?').get(id);
}

export function updateInterviewResearchJob(database, id, owner, status, fields = {}) {
  if (!INTERVIEW_RESEARCH_STATES.includes(status)) throw new Error(`invalid interview research status: ${status}`);
  const current = database.prepare('SELECT * FROM interview_research_jobs WHERE id=?').get(id);
  if (!current) throw new Error('interview research job not found');
  if (ACTIVE_STATES.has(current.status) && current.lease_owner !== owner) throw new Error('interview research lease is not owned by this worker');
  const terminal = ['ready', 'failed'].includes(status);
  database.prepare(`
    UPDATE interview_research_jobs SET status=@status,
      provider=COALESCE(@provider,provider), model=COALESCE(@model,model),
      run_token=COALESCE(@run_token,run_token), staging_path=COALESCE(@staging_path,staging_path),
      response_token_match=COALESCE(@response_token_match,response_token_match),
      error=@error, next_attempt_at=@next_attempt_at, updated_at=datetime('now'),
      completed_at=CASE WHEN @terminal=1 THEN datetime('now') ELSE completed_at END,
      lease_owner=CASE WHEN @terminal=1 THEN NULL ELSE lease_owner END,
      lease_expires_at=CASE WHEN @terminal=1 THEN NULL ELSE lease_expires_at END
    WHERE id=@id
  `).run({
    id, status, provider: fields.provider ?? null, model: fields.model ?? null,
    run_token: fields.runToken ?? null, staging_path: fields.stagingPath ?? null,
    response_token_match: fields.responseTokenMatch == null ? null : Number(Boolean(fields.responseTokenMatch)),
    error: fields.error == null ? null : String(fields.error).slice(0, 2000),
    next_attempt_at: fields.nextAttemptAt ?? null, terminal: Number(terminal),
  });
  return database.prepare('SELECT * FROM interview_research_jobs WHERE id=?').get(id);
}

export function failOrRetryInterviewResearch(database, job, owner, error, {
  backoffSeconds = 60, resetProviderAttempt = false,
} = {}) {
  const message = String(error?.message || error).slice(0, 2000);
  if (job.attempts >= job.max_attempts) return updateInterviewResearchJob(database, job.id, owner, 'failed', { error: message });
  database.prepare(`
    UPDATE interview_research_jobs SET status='queued', error=?, next_attempt_at=datetime('now', ?),
      provider=CASE WHEN ?=1 THEN NULL ELSE provider END,
      model=CASE WHEN ?=1 THEN NULL ELSE model END,
      run_token=CASE WHEN ?=1 THEN NULL ELSE run_token END,
      staging_path=CASE WHEN ?=1 THEN NULL ELSE staging_path END,
      response_token_match=CASE WHEN ?=1 THEN NULL ELSE response_token_match END,
      lease_owner=NULL, lease_expires_at=NULL, updated_at=datetime('now')
    WHERE id=? AND lease_owner=?
  `).run(message, `+${Math.max(1, Number(backoffSeconds) || 60)} seconds`,
    ...Array(5).fill(Number(Boolean(resetProviderAttempt))), job.id, owner);
  return database.prepare('SELECT * FROM interview_research_jobs WHERE id=?').get(job.id);
}
