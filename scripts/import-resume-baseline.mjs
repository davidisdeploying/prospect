#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { regularFile, regularFileBeneath, sha256File } from '../server/fileSafety.js';
import { createResumeVersion, SHA256_RE } from '../server/resumeVersions.js';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const required = ['--db-path', '--label', '--body-file', '--source-path', '--source-sha256', '--style-reference-path', '--style-reference-sha256', '--career-claims-sha256', '--audit-json-file'];
for (const flag of required) if (!args.get(flag)) throw new Error(`${flag} is required`);
for (const flag of ['--source-sha256', '--style-reference-sha256', '--career-claims-sha256']) {
  if (!SHA256_RE.test(args.get(flag))) throw new Error(`${flag} must be a 64-character lowercase SHA-256`);
}

const artifactRoot = args.get('--career-artifact-root') || '/home/david/Vaults/career-vault/files';
const dbPath = path.resolve(args.get('--db-path'));
if (fs.lstatSync(dbPath).isSymbolicLink() || !fs.statSync(dbPath).isFile()) throw new Error('--db-path must identify an existing regular database file');
const bodyFile = regularFile(args.get('--body-file'));
const sourcePath = regularFileBeneath(args.get('--source-path'), artifactRoot);
const stylePath = regularFileBeneath(args.get('--style-reference-path'), artifactRoot);
if (sha256File(sourcePath) !== args.get('--source-sha256')) throw new Error('source SHA-256 does not match the supplied source file');
if (sha256File(stylePath) !== args.get('--style-reference-sha256')) throw new Error('style-reference SHA-256 does not match the supplied file');
const auditPath = regularFile(args.get('--audit-json-file'));
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
if (!audit || typeof audit !== 'object' || Array.isArray(audit)) throw new Error('audit JSON must be an object');
const body = fs.readFileSync(bodyFile, 'utf8');
if (!body.trim()) throw new Error('body file must contain resume text');

const database = new Database(dbPath);
try {
  const existing = database.prepare(`
    SELECT * FROM resume_versions
    WHERE kind='baseline' AND source_sha256=? AND style_reference_sha256=?
    ORDER BY id LIMIT 1
  `).get(args.get('--source-sha256'), args.get('--style-reference-sha256'));
  if (existing) {
    console.log(JSON.stringify({ outcome: 'already_imported', resume_version_id: existing.id, source_sha256: existing.source_sha256 }));
  } else {
    const created = createResumeVersion(database, {
      label: args.get('--label'), notes: args.get('--notes'), body, kind: 'baseline',
      source_path: sourcePath, source_sha256: args.get('--source-sha256'),
      style_reference_path: stylePath, style_reference_sha256: args.get('--style-reference-sha256'),
      career_claims_sha256: args.get('--career-claims-sha256'), audit_status: audit.status,
      audit_json: audit,
    });
    console.log(JSON.stringify({ outcome: 'imported', resume_version_id: created.id, source_sha256: created.source_sha256 }));
  }
} finally {
  database.close();
}
