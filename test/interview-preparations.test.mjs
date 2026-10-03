import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { loadVecExtension } from '../server/vecExtension.js';
import { deleteClaimById } from '../server/deleteClaim.js';
import { careerClaimsFixture } from './helpers/careerClaims.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-interview-prep-'));
  const careerPath = path.join(dir, 'claims.md'); fs.writeFileSync(careerPath, careerClaimsFixture());
  const artifactRoot = path.join(dir, 'prospect-files'); fs.mkdirSync(artifactRoot);
  process.env.CAREER_CLAIMS_PATH = careerPath;
  const mod = await import(`../server/interviewPreparations.js?fixture=${Date.now()}-${Math.random()}`);
  const database = new Database(':memory:'); loadVecExtension(database); database.pragma('foreign_keys = ON'); database.exec(schema);
  database.prepare("INSERT INTO companies (id, name, canonical_name) VALUES (1, 'Lumen Technologies', 'lumen technologies')").run();
  const description = `Troubleshoot service interruption and restore network service through hardware break-fix and networking. Install and decommission equipment.
    Maintain asset management, inventory, spares, shipping and receiving, trouble tickets, and installation records.
    Work with SONET, DS1, fiber, OTDR, fusion splicing, outside plant, DC power, AC power, and HVAC.
    Rotating on-call dispatch, overtime, valid driver's license, outdoor all-weather work, climbing and lifting.
    Base salary $41,000 - $63,000.`;
  database.prepare(`INSERT INTO listings
    (id, source, source_url, company_id, company, role, location, description, snapshot_hash, snapshot_generation)
    VALUES (47, 'fixture', 'https://employer.invalid/job', 1, 'Lumen Technologies',
      'Field Technician I', 'Dallas, TX', ?, ?, 1)`).run(description, hash(description));
  database.prepare("INSERT INTO claims (id, listing_id, stage) VALUES (39, 47, 'Staked')").run();
  database.prepare(`INSERT INTO resume_versions
    (id, label, body, kind, source_path, source_sha256, career_claims_sha256, audit_status, audit_json)
    VALUES (7, 'Audited baseline', 'Private resume source', 'baseline', '/career/resume.pdf', ?, ?,
      'audited_with_corrections_required', ?)`).run('a'.repeat(64), hash(fs.readFileSync(careerPath)), JSON.stringify({
        blocked_statements: [{ text: 'unverified certification' }], conditional_statements: [{ text: 'scope requires confirmation' }],
      }));
  return { dir, artifactRoot, database, mod };
}

const input = {
  interview_kind: 'recruiter_screen', interview_format: 'video', scheduled_at: '2026-09-04T10:00',
  duration_minutes: 30, interviewer_name: 'Recruiter', resume_version_id: 7, resume_confirmed_sent: false,
};

test('prepares an immutable grounded guide and self-contained verified artifact without external action', async () => {
  const f = await fixture();
  const first = f.mod.prepareInterviewPreparation(f.database, 39, input, {
    artifactRoot: f.artifactRoot, now: new Date('2026-09-03T00:00:00Z'),
  });
  assert.equal(first.created, true);
  assert.equal(first.preparation.status, 'ready');
  assert.equal(first.preparation.resume_confirmed_sent, false);
  assert.equal(first.preparation.deterministic.resume_source.display_status, 'Audited baseline - not confirmed sent');
  assert.deepEqual(first.preparation.deterministic.evidence_bridges.slice(0, 3).map((item) => item.claim_id), [
    'skill-asset-inventory-operations', 'skill-hardware-lifecycle-breakfix', 'skill-networking-foundations',
  ]);
  assert.deepEqual(first.preparation.deterministic.boundaries.map((item) => item.key), [
    'carrier_transport', 'fiber_outside_plant', 'power_critical',
  ]);
  assert.equal(first.preparation.deterministic.salary.range_text, '$41,000 to $63,000');
  assert.equal(first.preparation.provider_status, 'not_requested');
  assert.equal(f.database.prepare('SELECT stage FROM claims WHERE id=39').get().stage, 'Staked');
  const artifact = first.preparation.artifacts[0];
  assert.ok(artifact.path.startsWith(f.artifactRoot));
  assert.equal(hash(fs.readFileSync(artifact.path)), artifact.sha256);
  const html = fs.readFileSync(artifact.path, 'utf8');
  assert.match(html, /Field Technician I/);
  assert.match(html, /Audited baseline - not confirmed sent/);
  assert.match(html, /Carrier transport and SONET/);
  assert.match(html, /fully readable without JavaScript|Practice mode/);
  assert.doesNotMatch(html, /employer\.invalid|Find available times/);
  assert.equal(f.mod.verifiedInterviewPreparationArtifact(f.database, artifact.id, f.artifactRoot).path, artifact.path);

  const repeat = f.mod.prepareInterviewPreparation(f.database, 39, input, { artifactRoot: f.artifactRoot });
  assert.equal(repeat.created, false); assert.equal(repeat.preparation.id, first.preparation.id);
  f.database.prepare("UPDATE interview_preparations SET status='failed', error='fixture failure' WHERE id=?").run(first.preparation.id);
  const retry = f.mod.prepareInterviewPreparation(f.database, 39, input, { artifactRoot: f.artifactRoot });
  assert.equal(retry.created, true); assert.notEqual(retry.preparation.id, first.preparation.id);
  const regenerated = f.mod.prepareInterviewPreparation(f.database, 39, { ...input, regenerate: true }, { artifactRoot: f.artifactRoot });
  assert.equal(regenerated.created, true); assert.notEqual(regenerated.preparation.id, retry.preparation.id);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM interview_preparations').get().n, 3);
  f.database.close(); fs.rmSync(f.dir, { recursive: true, force: true });
});

test('validates kind and resume source before creating preparation rows', async () => {
  const f = await fixture();
  assert.throws(() => f.mod.prepareInterviewPreparation(f.database, 39, { ...input, interview_kind: 'surprise' }, { artifactRoot: f.artifactRoot }), (error) => error.status === 400);
  assert.throws(() => f.mod.prepareInterviewPreparation(f.database, 39, { ...input, resume_version_id: null }, { artifactRoot: f.artifactRoot }), (error) => error.status === 400);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM interview_preparations').get().n, 0);
  f.database.close(); fs.rmSync(f.dir, { recursive: true, force: true });
});

test('artifact verification rejects hash drift', async () => {
  const f = await fixture();
  const prepared = f.mod.prepareInterviewPreparation(f.database, 39, input, { artifactRoot: f.artifactRoot });
  const artifact = prepared.preparation.artifacts[0]; fs.appendFileSync(artifact.path, '\ntampered');
  assert.throws(() => f.mod.verifiedInterviewPreparationArtifact(f.database, artifact.id, f.artifactRoot), (error) => error.status === 409 && /hash drift/.test(error.message));
  f.database.close(); fs.rmSync(f.dir, { recursive: true, force: true });
});

test('approved claim deletion backs up and releases preparation rows in FK order', async () => {
  const f = await fixture();
  const prepared = f.mod.prepareInterviewPreparation(f.database, 39, input, { artifactRoot: f.artifactRoot });
  const result = deleteClaimById(f.database, 39, path.join(f.dir, 'deleted-claims'));
  assert.equal(result.deleted, true);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM interview_preparations').get().n, 0);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM interview_preparation_artifacts').get().n, 0);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM interview_preparation_events').get().n, 0);
  const backup = JSON.parse(fs.readFileSync(result.backup_path, 'utf8'));
  assert.equal(backup.interview_preparations[0].id, prepared.preparation.id);
  assert.equal(backup.interview_preparation_artifacts.length, 1);
  assert.deepEqual(backup.interview_preparation_events.map((event) => event.kind), ['prepared', 'generated']);
  assert.deepEqual(f.database.pragma('foreign_key_check'), []);
  f.database.close(); fs.rmSync(f.dir, { recursive: true, force: true });
});
