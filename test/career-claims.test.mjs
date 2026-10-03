import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractCareerClaimsYaml, loadCareerClaims, parseCareerClaimsMarkdown } from '../server/careerClaims.js';
import { careerClaimsFixture } from './helpers/careerClaims.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const livePath = '/home/david/Vaults/career-vault/research/skills-credentials-claims.md';

test('loads all 25 live canonical claims and all 18 match-term records', () => {
  const result = loadCareerClaims(livePath);
  assert.equal(result.schema_version, 2);
  assert.equal(result.claims.length, 25);
  assert.equal(new Set(result.claims.map((claim) => claim.claim_id)).size, 25);
  assert.equal(result.claims.filter((claim) => claim.match_terms.length).length, 18);
  assert.ok(result.claims.every((claim) => typeof claim.public_safe === 'boolean'));
  assert.match(result.source_sha256, /^[a-f0-9]{64}$/);
});

test('extracts exactly one yaml fence and rejects zero, multiple, or malformed blocks', () => {
  assert.match(extractCareerClaimsYaml(careerClaimsFixture()), /schema_version: 2/);
  assert.throws(() => parseCareerClaimsMarkdown('# none'), /exactly one/);
  assert.throws(() => parseCareerClaimsMarkdown(`${careerClaimsFixture()}\n${careerClaimsFixture()}`), /exactly one/);
  assert.throws(() => parseCareerClaimsMarkdown('```yaml\nclaims: [\n```'), /malformed YAML/);
});

test('rejects duplicate IDs and missing required fields', () => {
  const fixture = careerClaimsFixture();
  const duplicate = fixture.replace(/claims:\n/, 'claims:\n  - claim_id: skill-linux-administration\n    kind: skill\n    status: current\n    evidence_class: P2\n    claim: x\n    safe_language: x\n    prohibited_inference: []\n    source_refs: []\n    confidence: high\n    public_safe: true\n');
  assert.throws(() => parseCareerClaimsMarkdown(duplicate), /duplicate claim_id/);
  assert.throws(() => parseCareerClaimsMarkdown(fixture.replace(/    safe_language: Safe language for skill-windows-endpoint-deployment\.\n/, '')), /safe_language/);
});

test('job audit source has no hard-coded factual EVIDENCE array and uses canonical match_terms', () => {
  const source = fs.readFileSync(path.join(root, 'server/jobAudit.js'), 'utf8');
  assert.doesNotMatch(source, /const\s+EVIDENCE\s*=\s*\[/);
  assert.match(source, /entry\.match_terms/);
  assert.match(source, /loadCareerClaims/);
});
