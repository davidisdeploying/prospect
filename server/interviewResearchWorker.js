import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  failOrRetryInterviewResearch, renewInterviewResearchLease, updateInterviewResearchJob,
} from './interviewResearchQueue.js';
import { TowerInterviewResearchProvider } from './interviewResearchProvider.js';
import { getInterviewPreparation } from './interviewPreparations.js';
import { listingSnapshotHash } from './listingSnapshot.js';

const DEFAULT_STAGING_ROOT = '/home/david/prospect/data/interview-research';

export class InterviewResearchValidationError extends Error {}

function text(value, label, max = 1200) {
  if (typeof value !== 'string' || !value.trim()) throw new InterviewResearchValidationError(`${label} must be non-empty text`);
  if (value.trim().length > max) throw new InterviewResearchValidationError(`${label} is too long`);
  return value.trim();
}

export function validateInterviewResearch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InterviewResearchValidationError('research result must be an object');
  if (value.schema_version !== 1) throw new InterviewResearchValidationError('schema_version must be 1');
  if (!Array.isArray(value.sources) || value.sources.length < 3 || value.sources.length > 10) {
    throw new InterviewResearchValidationError('research must contain 3-10 sources');
  }
  const ids = new Set();
  const urls = new Set();
  let official = 0;
  const sources = value.sources.map((source, index) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new InterviewResearchValidationError(`sources[${index}] must be an object`);
    const id = text(source.id, `sources[${index}].id`, 20);
    if (!/^S[1-9][0-9]*$/.test(id) || ids.has(id)) throw new InterviewResearchValidationError(`sources[${index}].id is invalid or duplicated`);
    ids.add(id);
    let url;
    try { url = new URL(text(source.url, `sources[${index}].url`, 2000)); } catch { throw new InterviewResearchValidationError(`sources[${index}].url is invalid`); }
    if (url.protocol !== 'https:') throw new InterviewResearchValidationError(`sources[${index}].url must use HTTPS`);
    if (urls.has(url.href)) throw new InterviewResearchValidationError(`sources[${index}].url is duplicated`);
    urls.add(url.href);
    const sourceType = text(source.source_type, `sources[${index}].source_type`, 40);
    if (!['official', 'reputable_reporting', 'candidate_report'].includes(sourceType)) throw new InterviewResearchValidationError(`sources[${index}].source_type is invalid`);
    if (sourceType === 'official') official += 1;
    const publishedAt = source.published_at == null ? null : text(source.published_at, `sources[${index}].published_at`, 40);
    if (publishedAt != null && !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) throw new InterviewResearchValidationError(`sources[${index}].published_at must be YYYY-MM-DD or null`);
    const accessedAt = text(source.accessed_at, `sources[${index}].accessed_at`, 60);
    if (!Number.isFinite(Date.parse(accessedAt))) throw new InterviewResearchValidationError(`sources[${index}].accessed_at is invalid`);
    return { id, title: text(source.title, `sources[${index}].title`, 300), publisher: text(source.publisher, `sources[${index}].publisher`, 200), url: url.href, published_at: publishedAt, accessed_at: accessedAt, source_type: sourceType };
  });
  if (official < 1) throw new InterviewResearchValidationError('research must include at least one official source');
  const sourceTypeById = Object.fromEntries(sources.map((source) => [source.id, source.source_type]));

  const findings = (name, { confidence = false, question = false } = {}) => {
    const items = value[name];
    if (!Array.isArray(items) || items.length < 1 || items.length > 12) throw new InterviewResearchValidationError(`${name} must contain 1-12 items`);
    return items.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new InterviewResearchValidationError(`${name}[${index}] must be an object`);
      if (!Array.isArray(item.source_ids) || item.source_ids.length < 1 || item.source_ids.some((id) => !ids.has(id))) {
        throw new InterviewResearchValidationError(`${name}[${index}] has missing or unknown source_ids`);
      }
      const normalized = question
        ? { question: text(item.question, `${name}[${index}].question`), rationale: text(item.rationale, `${name}[${index}].rationale`) }
        : { finding: text(item.finding, `${name}[${index}].finding`), why_it_matters: text(item.why_it_matters, `${name}[${index}].why_it_matters`) };
      if (confidence) {
        normalized.confidence = text(item.confidence, `${name}[${index}].confidence`, 20);
        if (!['high', 'medium', 'low'].includes(normalized.confidence)) throw new InterviewResearchValidationError(`${name}[${index}].confidence is invalid`);
        if (item.source_ids.every((id) => sourceTypeById[id] === 'candidate_report') && normalized.confidence !== 'low') {
          throw new InterviewResearchValidationError(`${name}[${index}] relies only on candidate reports and must be low confidence`);
        }
      }
      normalized.source_ids = [...new Set(item.source_ids)];
      return normalized;
    });
  };
  return {
    schema_version: 1,
    summary: text(value.summary, 'summary', 2000),
    company_findings: findings('company_findings'),
    role_findings: findings('role_findings'),
    interview_findings: findings('interview_findings', { confidence: true }),
    questions_to_ask: findings('questions_to_ask', { question: true }),
    sources,
    caveats: Array.isArray(value.caveats) ? value.caveats.slice(0, 12).map((item, index) => text(item, `caveats[${index}]`)) : [],
  };
}

function startLeaseHeartbeat(database, jobId, owner, { leaseSeconds, heartbeatMs }) {
  let failure = null;
  const renew = () => {
    if (failure) return;
    try { renewInterviewResearchLease(database, jobId, owner, { leaseSeconds }); } catch (error) { failure = error; }
  };
  renew();
  if (failure) throw failure;
  const timer = setInterval(renew, heartbeatMs); timer.unref?.();
  return { assertOwned() { if (failure) throw failure; }, stop() { clearInterval(timer); } };
}

function appendEvent(database, preparationId, kind, payload) {
  database.prepare('INSERT INTO interview_preparation_events (preparation_id,kind,payload) VALUES (?,?,?)')
    .run(preparationId, kind, payload == null ? null : JSON.stringify(payload));
}

export async function processInterviewResearchJob(database, job, {
  owner, provider = new TowerInterviewResearchProvider(),
  stagingRoot = process.env.PROSPECT_INTERVIEW_RESEARCH_STAGING_ROOT || DEFAULT_STAGING_ROOT,
  leaseSeconds = 300, leaseHeartbeatMs = Math.max(1000, Math.floor(leaseSeconds * 1000 / 3)),
} = {}) {
  if (!owner) throw new Error('worker owner is required');
  const heartbeat = startLeaseHeartbeat(database, job.id, owner, { leaseSeconds, heartbeatMs: Math.max(1, Number(leaseHeartbeatMs) || 1000) });
  try {
    const preparation = getInterviewPreparation(database, job.preparation_id);
    if (!preparation || preparation.status !== 'ready') throw new InterviewResearchValidationError('deterministic preparation is not ready');
    const listing = database.prepare('SELECT * FROM listings WHERE id=?').get(job.listing_id);
    if (!listing || listingSnapshotHash(listing) !== preparation.listing_snapshot_hash) {
      throw new InterviewResearchValidationError('listing snapshot is unavailable');
    }
    const stageDir = path.join(path.resolve(stagingRoot), `job-${job.id}`);
    fs.mkdirSync(stageDir, { recursive: true });
    const stagingPath = path.join(stageDir, 'research.json');
    const refreshed = database.prepare('SELECT * FROM interview_research_jobs WHERE id=?').get(job.id);
    let providerResult;
    if (fs.existsSync(stagingPath) && refreshed.response_token_match === 1) {
      providerResult = { token: refreshed.run_token, provider: refreshed.provider, model: refreshed.model, responseTokenMatch: true, draft: JSON.parse(fs.readFileSync(stagingPath, 'utf8')) };
    } else if (refreshed.run_token && typeof provider.resume === 'function') {
      providerResult = await provider.resume({ token: refreshed.run_token, stagingPath });
    } else if (refreshed.run_token) {
      throw new InterviewResearchValidationError('prior research token cannot be resumed safely');
    } else {
      providerResult = await provider.research({
        job: refreshed, preparation, listing, stagingPath,
        onToken: (metadata) => database.transaction(() => {
          updateInterviewResearchJob(database, job.id, owner, 'researching', {
            provider: metadata.provider, model: metadata.model, runToken: metadata.token, stagingPath,
          });
          appendEvent(database, preparation.id, 'research_dispatched', { research_job_id: job.id, run_token: metadata.token });
        })(),
      });
    }
    heartbeat.assertOwned();
    if (providerResult.responseTokenMatch !== true) throw new InterviewResearchValidationError('research provider did not prove response_token_match');
    const research = validateInterviewResearch(providerResult.draft);
    return database.transaction(() => {
      database.prepare(`
        UPDATE interview_preparations SET provider_status='complete',provider_json=?,provider=?,model=?,provider_error=NULL
        WHERE id=?
      `).run(JSON.stringify(research), providerResult.provider, providerResult.model, preparation.id);
      appendEvent(database, preparation.id, 'research_completed', {
        research_job_id: job.id, run_token: providerResult.token,
        provider: providerResult.provider, model: providerResult.model, source_count: research.sources.length,
      });
      return updateInterviewResearchJob(database, job.id, owner, 'ready', {
        provider: providerResult.provider, model: providerResult.model, runToken: providerResult.token,
        stagingPath, responseTokenMatch: true,
      });
    })();
  } catch (error) {
    const current = database.prepare('SELECT * FROM interview_research_jobs WHERE id=?').get(job.id);
    let next;
    if (error instanceof InterviewResearchValidationError) {
      next = updateInterviewResearchJob(database, current.id, owner, 'failed', { error: error.message });
    } else {
      if (error?.retryWithFreshToken === true) {
        appendEvent(database, current.preparation_id, 'research_attempt_failed', {
          research_job_id: current.id, run_token: error.runToken || current.run_token,
          phase: error.providerPhase || 'unknown', error: String(error.message || error).slice(0, 2000),
        });
      }
      next = failOrRetryInterviewResearch(database, current, owner, error, { resetProviderAttempt: error?.retryWithFreshToken === true });
    }
    if (next.status === 'failed') {
      database.transaction(() => {
        database.prepare("UPDATE interview_preparations SET provider_status='failed',provider_error=? WHERE id=?")
          .run(String(error.message || error).slice(0, 2000), current.preparation_id);
        appendEvent(database, current.preparation_id, 'research_failed', {
          research_job_id: current.id, run_token: error?.runToken || current.run_token,
          error: String(error.message || error).slice(0, 2000),
        });
      })();
    }
    return next;
  } finally {
    heartbeat.stop();
  }
}

export function defaultInterviewResearchOwner() { return `${os.hostname()}:${process.pid}`; }
