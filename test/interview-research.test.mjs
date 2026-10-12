import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { loadVecExtension } from '../server/vecExtension.js';
import { prepareInterviewPreparation, getInterviewPreparation } from '../server/interviewPreparations.js';
import { enqueueInterviewResearch, leaseNextInterviewResearchJob } from '../server/interviewResearchQueue.js';
import { FakeInterviewResearchProvider } from '../server/interviewResearchProvider.js';
import { processInterviewResearchJob, validateInterviewResearch } from '../server/interviewResearchWorker.js';
import { deleteClaimById } from '../server/deleteClaim.js';
import { careerClaimsFixture } from './helpers/careerClaims.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-interview-research-'));
  const careerPath = path.join(dir, 'claims.md'); fs.writeFileSync(careerPath, careerClaimsFixture());
  process.env.CAREER_CLAIMS_PATH = careerPath;
  const database = new Database(':memory:'); loadVecExtension(database); database.pragma('foreign_keys = ON'); database.exec(schema);
  database.prepare("INSERT INTO companies (id,name,canonical_name) VALUES (1,'Lumen Technologies','lumen technologies')").run();
  const description = 'Troubleshoot network service, repair hardware, maintain inventory and trouble tickets, and support on-call field work.';
  database.prepare(`INSERT INTO listings
    (id,source,source_url,company_id,company,role,location,description,snapshot_hash,snapshot_generation)
    VALUES (47,'fixture','https://careers.example/job',1,'Lumen Technologies','Field Technician I','Dallas, TX',?,?,1)`).run(description, hash(description));
  database.prepare("INSERT INTO claims (id,listing_id,stage) VALUES (39,47,'Staked')").run();
  database.prepare("INSERT INTO resume_versions (id,label,body,kind,audit_status) VALUES (7,'Audited baseline','source','baseline','audited')").run();
  const preparation = prepareInterviewPreparation(database, 39, {
    interview_kind: 'recruiter_screen', duration_minutes: 30, resume_version_id: 7, resume_confirmed_sent: false,
  }, { artifactRoot: path.join(dir, 'artifacts') }).preparation;
  return { dir, database, preparation };
}

const research = {
  schema_version: 1,
  summary: 'Lumen is prioritizing network reliability and disciplined field execution.',
  company_findings: [{ finding: 'Lumen operates fiber-network infrastructure.', why_it_matters: 'Connect answers to service reliability.', source_ids: ['S1'] }],
  role_findings: [{ finding: 'The role combines repair and inventory control.', why_it_matters: 'Prepare examples covering both.', source_ids: ['S1', 'S2'] }],
  interview_findings: [{ finding: 'Candidate reports mention structured recruiter screens.', why_it_matters: 'Practice a concise introduction.', confidence: 'low', source_ids: ['S3'] }],
  questions_to_ask: [{ question: 'How is field success measured?', rationale: 'The operating model emphasizes reliability.', source_ids: ['S1'] }],
  sources: [
    { id: 'S1', title: 'Company overview', publisher: 'Lumen', url: 'https://www.lumen.com/about.html', published_at: null, accessed_at: '2026-09-03T10:00:00Z', source_type: 'official' },
    { id: 'S2', title: 'Network operations report', publisher: 'Example News', url: 'https://news.example/lumen-network', published_at: '2026-08-20', accessed_at: '2026-09-03T10:01:00Z', source_type: 'reputable_reporting' },
    { id: 'S3', title: 'Interview report', publisher: 'Candidate Forum', url: 'https://candidate.example/lumen-interview', published_at: null, accessed_at: '2026-09-03T10:02:00Z', source_type: 'candidate_report' },
  ],
  caveats: ['One interview-process source is anecdotal and is not treated as a recurring company process.'],
};

test('queues one research job and records validated source-linked agent enrichment', async () => {
  const f = await fixture();
  const first = enqueueInterviewResearch(f.database, f.preparation.id);
  const repeat = enqueueInterviewResearch(f.database, f.preparation.id);
  assert.equal(first.created, true); assert.equal(repeat.created, false); assert.equal(repeat.job.id, first.job.id);
  const job = leaseNextInterviewResearchJob(f.database, 'fixture-owner', { leaseSeconds: 30 });
  const provider = new FakeInterviewResearchProvider(research, { provider: 'codex', model: 'gpt-test' });
  const completed = await processInterviewResearchJob(f.database, job, {
    owner: 'fixture-owner', provider, stagingRoot: path.join(f.dir, 'staging'), leaseSeconds: 30,
  });
  assert.equal(completed.status, 'ready'); assert.equal(completed.response_token_match, 1);
  const preparation = getInterviewPreparation(f.database, f.preparation.id);
  assert.equal(preparation.status, 'ready'); assert.equal(preparation.provider_status, 'complete');
  assert.equal(preparation.provider, 'codex'); assert.equal(preparation.provider_result.sources.length, 3);
  assert.deepEqual(preparation.provider_result.role_findings[0].source_ids, ['S1', 'S2']);
  assert.deepEqual(preparation.events.map((event) => event.kind), ['prepared', 'generated', 'research_queued', 'research_dispatched', 'research_completed']);
  assert.equal(f.database.prepare('SELECT stage FROM claims WHERE id=39').get().stage, 'Staked');
  f.database.close(); fs.rmSync(f.dir, { recursive: true, force: true });
});

test('rejects ungrounded research while preserving the deterministic guide', async () => {
  const f = await fixture();
  assert.throws(() => validateInterviewResearch({ ...research, sources: research.sources.slice(0, 2) }), /3-10 sources/);
  assert.throws(() => validateInterviewResearch({
    ...research,
    interview_findings: [{ ...research.interview_findings[0], confidence: 'high' }],
  }), /candidate reports and must be low confidence/);
  const queued = enqueueInterviewResearch(f.database, f.preparation.id).job;
  const job = leaseNextInterviewResearchJob(f.database, 'fixture-owner', { leaseSeconds: 30 });
  const failed = await processInterviewResearchJob(f.database, job, {
    owner: 'fixture-owner', provider: new FakeInterviewResearchProvider({ ...research, sources: [] }),
    stagingRoot: path.join(f.dir, 'staging'), leaseSeconds: 30,
  });
  assert.equal(failed.id, queued.id); assert.equal(failed.status, 'failed');
  const preparation = getInterviewPreparation(f.database, f.preparation.id);
  assert.equal(preparation.status, 'ready'); assert.equal(preparation.provider_status, 'failed');
  assert.ok(preparation.deterministic.likely_questions.length > 0);
  f.database.close(); fs.rmSync(f.dir, { recursive: true, force: true });
});

test('approved deletion backs up and releases research jobs before preparations', async () => {
  const f = await fixture(); enqueueInterviewResearch(f.database, f.preparation.id);
  const result = deleteClaimById(f.database, 39, path.join(f.dir, 'deleted'));
  const backup = JSON.parse(fs.readFileSync(result.backup_path, 'utf8'));
  assert.equal(backup.interview_research_jobs.length, 1);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM interview_research_jobs').get().n, 0);
  assert.deepEqual(f.database.pragma('foreign_key_check'), []);
  f.database.close(); fs.rmSync(f.dir, { recursive: true, force: true });
});
