import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { loadVecExtension } from '../server/vecExtension.js';
import { careerClaimsFixture } from './helpers/careerClaims.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

test('fake provider drives an isolated full pipeline to four verified registered documents', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-package-worker-'));
  const careerPath = path.join(dir, 'career.md'); const artifactRoot = path.join(dir, 'career-files'); const stagingRoot = path.join(dir, 'staging');
  fs.writeFileSync(careerPath, careerClaimsFixture()); fs.mkdirSync(artifactRoot);
  process.env.CAREER_CLAIMS_PATH = careerPath; process.env.CAREER_ARTIFACT_ROOT = artifactRoot;
  const queue = await import(`../server/applicationGenerationQueue.js?worker=${Date.now()}`);
  const { FakePackageProvider } = await import(`../server/towerPackageProvider.js?worker=${Date.now()}`);
  const { processGenerationJob } = await import(`../server/packageWorker.js?worker=${Date.now()}`);
  const packages = await import(`../server/applicationPackages.js?worker-test=${Date.now()}`);
  const renderer = await import(`../server/applicationPackageRenderer.js?worker-test=${Date.now()}`);
  const database = new Database(':memory:'); loadVecExtension(database); database.exec(schema);
  const description = 'Required: Linux administration and troubleshooting.';
  const rawPayload = JSON.stringify({ description, source: 'fixture' });
  database.prepare("INSERT INTO listings (id,source,source_url,company,role,description,raw_payload,desc_hash,snapshot_hash,snapshot_generation,captured_at) VALUES (1,'test','https://invalid.example/job','Example','Infrastructure Technician',?,?,?,?,?,?)")
    .run(description, rawPayload, hash(description), null, 2, '2026-08-29T00:00:00Z');
  database.prepare("INSERT INTO listing_skills (listing_id,skill,tier) VALUES (1,'Linux administration','required')").run();
  const careerHash = hash(fs.readFileSync(careerPath));
  database.prepare("INSERT INTO resume_versions (id,label,body,kind,source_path,source_sha256,style_reference_path,style_reference_sha256,career_claims_sha256,audit_status,audit_json) VALUES (1,'Audited baseline','David Gomez baseline employment facts','baseline','/source.pdf',?,'/style.pdf',?,?,?,?)")
    .run('c'.repeat(64), 'd'.repeat(64), careerHash, 'audited_with_corrections_required', JSON.stringify({ blocked_statements: [{ text: 'unsupported secret clearance' }], conditional_statements: [] }));
  database.prepare("INSERT INTO claims (id,listing_id,stage,resume_version_id) VALUES (1,1,'Staked',1)").run();
  const queued = queue.enqueueApplicationGeneration(database, 1);
  assert.equal(queued.job.listing_snapshot_hash, hash(rawPayload), 'null stored snapshot_hash uses the shared deterministic fallback');
  const leased = queue.leaseNextGenerationJob(database, 'fixture-worker');
  const draft = {
    resume: {
      name: 'David Gomez', contact_line: 'Dallas, Texas | david@example.test',
      summary: 'Infrastructure support professional with grounded Linux administration experience.',
      skills: ['Linux administration', 'Troubleshooting'],
      experience: [{ employer: 'Example Employer', title: 'Infrastructure Support', dates: '2020–2025', location: 'Dallas, Texas', bullets: ['Administered Linux systems in documented lab and support contexts.'] }],
      education: ['Grounded education from audited baseline'], certifications: [],
    },
    cover_letter: { salutation: 'Dear Hiring Team,', paragraphs: ['I am interested in the Infrastructure Technician role.', 'My grounded Linux administration evidence aligns with the captured requirements.'], closing: 'Sincerely,\nDavid Gomez' },
    verification: [{ statement: 'Linux administration wording is grounded.', evidence_claim_ids: ['skill-linux-administration'] }],
  };
  const provider = new FakePackageProvider(draft, { token: 'FLEET-BUILD-20260829-prospect-package-fixture', provider: 'fake', model: 'fixture-v1' });
  const baseDraft = provider.draft.bind(provider);
  provider.draft = async (options) => {
    const result = await baseDraft(options);
    database.prepare("UPDATE application_generation_jobs SET lease_expires_at=datetime('now','-1 second') WHERE id=?").run(leased.id);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(queue.leaseNextGenerationJob(database, 'competing-worker'), null, 'heartbeat renews during the draft wait before another worker can lease');
    return result;
  };
  const result = await processGenerationJob(database, leased, {
    owner: 'fixture-worker', provider, stagingRoot, artifactRoot,
    now: new Date('2026-08-29T21:00:00Z'), leaseSeconds: 30, leaseHeartbeatMs: 5,
  });
  assert.equal(result.status, 'ready'); assert.equal(provider.calls, 1); assert.equal(queued.created, true);
  const packageRow = packages.getApplicationPackage(database, result.package_id);
  assert.equal(packageRow.artifacts.length, 4);
  const outputDir = path.join(artifactRoot, '2026', '2026-08-29', `prospect-worker-prospect-package-${result.package_id}`);
  for (const name of ['resume.docx', 'resume.pdf', 'cover_letter.docx', 'cover_letter.pdf', 'verification.json', 'MANIFEST.md']) assert.equal(fs.statSync(path.join(outputDir, name)).isFile(), true);
  assert.equal(fs.readFileSync(path.join(outputDir, 'resume.docx')).subarray(0, 2).toString(), 'PK');
  assert.equal(fs.readFileSync(path.join(outputDir, 'resume.pdf')).subarray(0, 5).toString(), '%PDF-');
  for (const name of ['resume.docx', 'cover_letter.docx']) {
    const archive = await JSZip.loadAsync(fs.readFileSync(path.join(outputDir, name)));
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/numbering.xml']) {
      assert.ok(archive.file(part), `${name} contains standard DOCX part ${part}`);
    }
    const relationships = await archive.file('word/_rels/document.xml.rels').async('string');
    const styles = await archive.file('word/styles.xml').async('string');
    const numbering = await archive.file('word/numbering.xml').async('string');
    const documentXml = await archive.file('word/document.xml').async('string');
    assert.match(relationships, /relationships\/styles/);
    assert.match(relationships, /relationships\/numbering/);
    assert.match(styles, /w:styleId="ProspectHeading"/);
    assert.match(numbering, /w:numFmt w:val="bullet"/);
    if (name === 'resume.docx') assert.match(documentXml, /<w:numPr>/, 'resume DOCX uses real list numbering');
  }
  for (const name of ['resume.pdf', 'cover_letter.pdf']) {
    const pdf = fs.readFileSync(path.join(outputDir, name), 'latin1');
    assert.match(pdf, /^%PDF-/);
    assert.match(pdf, /xref\s/);
    assert.match(pdf, /startxref\s+\d+\s+%%EOF\s*$/);
    assert.match(pdf, /\/MediaBox \[0 0 612 792\]/, `${name} uses US Letter`);
    const pages = (pdf.match(/\/Type \/Page\b/g) || []).length;
    assert.ok(pages >= 1 && pages <= 2, `${name} has one or two valid PDFKit pages`);
    if (name === 'resume.pdf') assert.equal(pages, 1, 'fixture resume fits one US Letter page');
  }
  for (const artifact of packageRow.artifacts) assert.equal(artifact.sha256, hash(fs.readFileSync(artifact.path)));
  assert.match(fs.readFileSync(path.join(outputDir, 'MANIFEST.md'), 'utf8'), /Producing seat: `prospect-worker`/);
  assert.throws(() => renderer.validatePackageDraft({ ...draft, extra: true }, packageRow), /must contain exactly/);
  const blockedDraft = structuredClone(draft); blockedDraft.resume.summary = 'Unsupported secret clearance';
  assert.throws(() => renderer.validatePackageDraft(blockedDraft, packageRow), /baseline-blocked statement/);
  database.prepare("UPDATE application_generation_jobs SET status='rendering', lease_owner='fixture-worker', lease_expires_at=datetime('now','+5 minutes'), completed_at=NULL WHERE id=?").run(result.id);
  const replay = await processGenerationJob(database, database.prepare('SELECT * FROM application_generation_jobs WHERE id=?').get(result.id), { owner: 'fixture-worker', provider, stagingRoot, artifactRoot, now: new Date('2026-08-29T21:00:00Z') });
  assert.equal(replay.status, 'ready'); assert.equal(provider.calls, 1, 'recovery must not refire the provider token');
  assert.equal(database.prepare('SELECT COUNT(*) n FROM application_package_artifacts WHERE package_id=?').get(result.package_id).n, 4);
  assert.throws(() => packages.verifiedApplicationPackageArtifact(database, 999), (error) => error.status === 404);
  database.prepare("UPDATE listings SET company='Lumen Technologies' WHERE id=1").run();
  const pdf = packageRow.artifacts.find((item) => item.kind === 'resume' && item.format === 'pdf');
  assert.equal(packages.verifiedApplicationPackageArtifact(database, pdf.id).safe_filename, 'Lumen-Resume.pdf');
  const downloadCoverDocx = packageRow.artifacts.find((item) => item.kind === 'cover_letter' && item.format === 'docx');
  assert.equal(packages.verifiedApplicationPackageArtifact(database, downloadCoverDocx.id).safe_filename, 'Lumen-Cover-Letter.docx');
  fs.appendFileSync(pdf.path, 'tamper');
  assert.throws(() => packages.verifiedApplicationPackageArtifact(database, pdf.id), /hash drift/);
  const outside = path.join(dir, 'outside.docx'); fs.writeFileSync(outside, 'outside');
  const coverDocx = packageRow.artifacts.find((item) => item.kind === 'cover_letter' && item.format === 'docx');
  database.prepare('UPDATE application_package_artifacts SET path=?, sha256=? WHERE id=?').run(outside, hash('outside'), coverDocx.id);
  assert.throws(() => packages.verifiedApplicationPackageArtifact(database, coverDocx.id), /artifact is unavailable/);
  const coverPdf = packageRow.artifacts.find((item) => item.kind === 'cover_letter' && item.format === 'pdf');
  database.prepare('UPDATE application_package_artifacts SET path=? WHERE id=?').run(path.join(artifactRoot, 'missing.pdf'), coverPdf.id);
  assert.throws(() => packages.verifiedApplicationPackageArtifact(database, coverPdf.id), /artifact is unavailable/);
  database.close();
});

test('invalid grounded draft stops for review after one attempt instead of retrying cached output', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-package-validation-'));
  const careerPath = path.join(dir, 'career.md'); const artifactRoot = path.join(dir, 'career-files'); const stagingRoot = path.join(dir, 'staging');
  fs.writeFileSync(careerPath, careerClaimsFixture()); fs.mkdirSync(artifactRoot);
  process.env.CAREER_CLAIMS_PATH = careerPath; process.env.CAREER_ARTIFACT_ROOT = artifactRoot;
  const queue = await import(`../server/applicationGenerationQueue.js?validation=${Date.now()}`);
  const { FakePackageProvider } = await import(`../server/towerPackageProvider.js?validation=${Date.now()}`);
  const { processGenerationJob } = await import(`../server/packageWorker.js?validation=${Date.now()}`);
  const database = new Database(':memory:'); loadVecExtension(database); database.exec(schema);
  const description = 'Required: Linux administration.'; const rawPayload = JSON.stringify({ description });
  database.prepare("INSERT INTO listings (id,source,company,role,description,raw_payload,desc_hash,snapshot_hash,snapshot_generation,captured_at) VALUES (1,'test','Example','Infrastructure Technician',?,?,?,?,?,?)")
    .run(description, rawPayload, hash(description), null, 1, '2026-08-29T00:00:00Z');
  database.prepare("INSERT INTO listing_skills (listing_id,skill,tier) VALUES (1,'Linux administration','required')").run();
  const careerHash = hash(fs.readFileSync(careerPath));
  database.prepare("INSERT INTO resume_versions (id,label,body,kind,source_path,source_sha256,style_reference_path,style_reference_sha256,career_claims_sha256,audit_status,audit_json) VALUES (1,'Audited baseline','David Gomez baseline employment facts','baseline','/source.pdf',?,'/style.pdf',?,?,?,?)")
    .run('c'.repeat(64), 'd'.repeat(64), careerHash, 'audited_with_corrections_required', JSON.stringify({ blocked_statements: [], conditional_statements: [] }));
  database.prepare("INSERT INTO claims (id,listing_id,stage,resume_version_id) VALUES (1,1,'Staked',1)").run();
  queue.enqueueApplicationGeneration(database, 1);
  const leased = queue.leaseNextGenerationJob(database, 'validation-worker');
  const invalidDraft = {
    resume: { name: 'David Gomez', contact_line: 'Dallas, Texas', summary: 'Grounded summary.', skills: ['Linux'], experience: [{ employer: 'Example', title: 'Technician', dates: '2020-2025', location: 'Dallas', bullets: ['Grounded work.'] }], education: [], certifications: [] },
    cover_letter: { salutation: 'Dear Hiring Team,', paragraphs: ['First grounded paragraph.', 'Second grounded paragraph.'], closing: 'Sincerely,\nDavid Gomez' },
    verification: [{ statement: 'Linux evidence.', evidence_claim_ids: [] }],
  };
  const provider = new FakePackageProvider(invalidDraft);
  const result = await processGenerationJob(database, leased, { owner: 'validation-worker', provider, stagingRoot, artifactRoot });
  assert.equal(result.status, 'needs_review');
  assert.equal(result.attempts, 1);
  assert.match(result.error, /failed the grounding contract/);
  assert.equal(provider.calls, 1);
  assert.equal(queue.leaseNextGenerationJob(database, 'second-worker'), null);
  database.close();
});

test('missing Tower run is recorded and retried with fresh provider metadata', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-package-missing-run-'));
  const careerPath = path.join(dir, 'career.md'); const artifactRoot = path.join(dir, 'career-files'); const stagingRoot = path.join(dir, 'staging');
  fs.writeFileSync(careerPath, careerClaimsFixture()); fs.mkdirSync(artifactRoot);
  process.env.CAREER_CLAIMS_PATH = careerPath; process.env.CAREER_ARTIFACT_ROOT = artifactRoot;
  const queue = await import(`../server/applicationGenerationQueue.js?missing-run=${Date.now()}`);
  const { processGenerationJob } = await import(`../server/packageWorker.js?missing-run=${Date.now()}`);
  const database = new Database(':memory:'); loadVecExtension(database); database.exec(schema);
  const description = 'Required: Linux administration.'; const rawPayload = JSON.stringify({ description });
  database.prepare("INSERT INTO listings (id,source,company,role,description,raw_payload,desc_hash,snapshot_hash,snapshot_generation,captured_at) VALUES (1,'test','Example','Infrastructure Technician',?,?,?,?,?,?)")
    .run(description, rawPayload, hash(description), null, 1, '2026-09-01T00:00:00Z');
  database.prepare("INSERT INTO listing_skills (listing_id,skill,tier) VALUES (1,'Linux administration','required')").run();
  const careerHash = hash(fs.readFileSync(careerPath));
  database.prepare("INSERT INTO resume_versions (id,label,body,kind,source_path,source_sha256,style_reference_path,style_reference_sha256,career_claims_sha256,audit_status,audit_json) VALUES (1,'Audited baseline','David Gomez baseline employment facts','baseline','/source.pdf',?,'/style.pdf',?,?,?,?)")
    .run('c'.repeat(64), 'd'.repeat(64), careerHash, 'audited_with_corrections_required', JSON.stringify({ blocked_statements: [], conditional_statements: [] }));
  database.prepare("INSERT INTO claims (id,listing_id,stage,resume_version_id) VALUES (1,1,'Staked',1)").run();
  queue.enqueueApplicationGeneration(database, 1);
  const leased = queue.leaseNextGenerationJob(database, 'missing-run-worker');
  const missingToken = 'FLEET-BUILD-20260901-prospect-package-missing-fixture';
  const provider = {
    async draft({ onToken }) {
      await onToken({ token: missingToken, provider: 'auto', model: null });
      const error = new Error(`Tower run is missing for token ${missingToken}`);
      error.runToken = missingToken;
      error.providerPhase = 'status';
      error.retryWithFreshToken = true;
      throw error;
    },
  };
  const result = await processGenerationJob(database, leased, {
    owner: 'missing-run-worker', provider, stagingRoot, artifactRoot,
  });
  assert.equal(result.status, 'queued');
  assert.equal(result.attempts, 1);
  assert.equal(result.run_token, null, 'the next attempt must generate a fresh single-use token');
  assert.equal(result.provider, null);
  assert.equal(result.lease_owner, null);
  assert.match(result.error, /Tower run is missing/);
  const events = database.prepare('SELECT kind,payload FROM application_package_events WHERE package_id=? ORDER BY id').all(result.package_id);
  assert.deepEqual(events.map((event) => event.kind), ['prepared', 'generation_failed']);
  assert.deepEqual(JSON.parse(events[1].payload), {
    run_token: missingToken,
    phase: 'status',
    error: `Tower run is missing for token ${missingToken}`,
  });
  database.close();
});
