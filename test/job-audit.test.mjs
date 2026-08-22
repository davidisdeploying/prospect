import test from 'node:test';
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

test('job audit grounds requirements, gates market intelligence, and records append-only provenance', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-job-audit-'));
  const dbPath = path.join(dir, 'audit.db');
  const careerPath = path.join(dir, 'claims.md');
  fs.writeFileSync(careerPath, `
claim_id: skill-windows-endpoint-deployment
claim_id: skill-firmware-device-security-configuration
claim_id: skill-hardware-lifecycle-breakfix
claim_id: skill-asset-inventory-operations
claim_id: skill-linux-administration
claim_id: skill-networking-foundations
claim_id: skill-containers
claim_id: skill-python-automation
claim_id: skill-aws-coursework
claim_id: skill-azure-coursework
claim_id: skill-vmware-coursework
claim_id: skill-windows-server-active-directory
claim_id: credential-cs50p
claim_id: education-collin-aas-cloud-infrastructure
claim_id: target-exclusion-cybersecurity
  `);
  const setup = new Database(dbPath);
  loadVecExtension(setup);
  setup.exec(schema);
  setup.prepare(`INSERT INTO listings (id, source, role, company, description, desc_hash, job_family) VALUES (1, 'test', 'Junior Infrastructure Technician', 'Example', 'Requires Linux and 5 years of professional experience.', 'desc-1', 'infrastructure-support')`).run();
  setup.prepare(`INSERT INTO claims (id, listing_id) VALUES (1, 1)`).run();
  setup.prepare(`INSERT INTO listing_skills (listing_id, skill, tier) VALUES (1, 'Linux', 'required'), (1, 'SCCM', 'required'), (1, 'Azure', 'preferred')`).run();
  setup.close();
  const script = `
    globalThis.fetch = async () => { throw new Error('model offline'); };
    const mod = await import(${JSON.stringify(pathToFileURL(path.join(root, 'server/jobAudit.js')).href)});
    const { db } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'server/db.js')).href)});
    const deterministic = mod.buildDeterministicAudit(db, {listingId: 1, claimId: 1});
    const first = mod.createJobAudit({listingId: 1, claimId: 1});
    const same = mod.createJobAudit({listingId: 1, claimId: 1});
    const forced = mod.createJobAudit({listingId: 1, claimId: 1, force: true});
    console.log(JSON.stringify({deterministic, first: first.id, same: same.id, forced: forced.id, rows: db.prepare('SELECT COUNT(*) n FROM job_listing_audits').get().n}));
    process.exit(0);
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: {...process.env, PROSPECT_DB_PATH: dbPath, CAREER_CLAIMS_PATH: careerPath},
  }).toString();
  const result = JSON.parse(output.trim());
  const linux = result.deterministic.requirements.find((item) => item.skill === 'Linux');
  const sccm = result.deterministic.requirements.find((item) => item.skill === 'SCCM');
  assert.equal(linux.classification, 'competitive_gap');
  assert.deepEqual(linux.claim_ids, ['skill-linux-administration']);
  assert.equal(sccm.classification, 'supported');
  assert.ok(result.deterministic.requirements.some((item) => item.hard_blocker === 'years_experience'));
  assert.equal(result.deterministic.overall.decision, 'premature');
  assert.equal(result.deterministic.market_intelligence.status, 'insufficient_corpus');
  assert.equal(result.first, result.same);
  assert.notEqual(result.first, result.forced);
  assert.equal(result.rows, 2);
});
