import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { loadVecExtension } from '../server/vecExtension.js';
import { createResumeVersion } from '../server/resumeVersions.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

test('baseline validation enforces provenance, audit object, hashes, and tailored parent baseline', () => {
  const database = new Database(':memory:'); loadVecExtension(database); database.exec(schema);
  const valid = { label: 'Baseline', body: 'private resume body', kind: 'baseline', source_path: '/career/source.pdf', source_sha256: 'a'.repeat(64), style_reference_path: '/career/style.pdf', style_reference_sha256: 'b'.repeat(64), career_claims_sha256: 'c'.repeat(64), audit_status: 'audited', audit_json: { status: 'audited' } };
  const baseline = createResumeVersion(database, valid);
  assert.equal(baseline.kind, 'baseline');
  assert.throws(() => createResumeVersion(database, { ...valid, label: 'bad', source_sha256: 'ABC' }), /lowercase SHA-256/);
  assert.throws(() => createResumeVersion(database, { ...valid, label: 'bad', audit_json: [] }), /JSON object/);
  assert.throws(() => createResumeVersion(database, { label: 'Tailored', kind: 'tailored', body: 'x' }), /parent baseline/);
  assert.equal(createResumeVersion(database, { label: 'Tailored', kind: 'tailored', body: 'x', parent_resume_version_id: baseline.id }).parent_resume_version_id, baseline.id);
  database.close();
});

test('baseline importer verifies files, is idempotent, rejects symlinks, and never prints body text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-baseline-'));
  const artifactRoot = path.join(dir, 'career-files'); fs.mkdirSync(artifactRoot);
  const source = path.join(artifactRoot, 'source.pdf'); fs.writeFileSync(source, 'source pdf');
  const style = path.join(artifactRoot, 'style.pdf'); fs.writeFileSync(style, 'style pdf');
  const body = path.join(dir, 'body.txt'); fs.writeFileSync(body, 'PRIVATE_BODY_SENTINEL');
  const audit = path.join(dir, 'audit.json'); fs.writeFileSync(audit, JSON.stringify({ status: 'audited', blocked_statements: [], conditional_statements: [] }));
  const dbPath = path.join(dir, 'scratch.db');
  const database = new Database(dbPath); loadVecExtension(database); database.exec(schema); database.close();
  const args = ['--db-path', dbPath, '--label', 'Baseline', '--body-file', body, '--source-path', source, '--source-sha256', hash('source pdf'), '--style-reference-path', style, '--style-reference-sha256', hash('style pdf'), '--career-claims-sha256', 'c'.repeat(64), '--audit-json-file', audit, '--career-artifact-root', artifactRoot];
  const first = execFileSync(process.execPath, [path.join(root, 'scripts/import-resume-baseline.mjs'), ...args], { encoding: 'utf8' });
  const second = execFileSync(process.execPath, [path.join(root, 'scripts/import-resume-baseline.mjs'), ...args], { encoding: 'utf8' });
  assert.match(first, /"outcome":"imported"/); assert.match(second, /"outcome":"already_imported"/);
  assert.doesNotMatch(first + second, /PRIVATE_BODY_SENTINEL/);
  const check = new Database(dbPath, { readonly: true }); assert.equal(check.prepare('SELECT COUNT(*) n FROM resume_versions').get().n, 1); check.close();
  const link = path.join(artifactRoot, 'link.pdf'); fs.symlinkSync(source, link);
  assert.throws(() => execFileSync(process.execPath, [path.join(root, 'scripts/import-resume-baseline.mjs'), ...args.map((value) => value === source ? link : value)], { stdio: 'pipe' }), /Command failed/);
  assert.throws(() => execFileSync(process.execPath, [path.join(root, 'scripts/import-resume-baseline.mjs'), ...args.map((value) => value === hash('source pdf') ? '0'.repeat(64) : value)], { stdio: 'pipe' }), /Command failed/);
});

test('resume API source forwards the complete provenance payload', () => {
  const api = fs.readFileSync(path.join(root, 'app/src/api.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
  assert.match(api, /createResumeVersion\(payload\)[\s\S]*JSON\.stringify\(payload\)/);
  assert.match(server, /createResumeVersion\(db, req\.body \|\| \{\}\)/);
});
