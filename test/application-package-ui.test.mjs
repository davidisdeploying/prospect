import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const detail = fs.readFileSync(path.join(root, 'app/src/ClaimDetail.jsx'), 'utf8');
const api = fs.readFileSync(path.join(root, 'app/src/api.js'), 'utf8');

test('Claim Detail exposes plain-language package readiness, generation, history, artifacts, and review controls', () => {
  for (const phrase of ['Application package', 'Job listing captured', 'Career evidence loaded', 'Baseline résumé ready', 'Job audit complete', 'Generate tailored résumé & cover letter', 'Create brief only', 'Copy application brief', 'Immutable package history', 'Register artifact', 'Mark reviewed', 'Mark finalized']) {
    assert.match(detail, new RegExp(phrase));
  }
  for (const phrase of ['queued', 'auditing', 'drafting', 'rendering', 'needs_review', 'failed', 'ready', 'Download Tailored Resume', 'Download Cover Letter', 'Regenerate documents']) {
    assert.match(detail, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing generation UI: ${phrase}`);
  }
  assert.doesNotMatch(detail, />\s*Submit\s*</i);
  assert.match(detail, /disabled=\{busy \|\| !readiness\?\.ready\}/);
  assert.doesNotMatch(detail, /submit application|upload application|email application/i);
});

test('audit starts once automatically and both waits expose phase-based live progress', () => {
  assert.match(detail, /autoStartedClaimRef/);
  assert.match(detail, /hasCurrentBaselineAudit/);
  assert.match(detail, /baselineResumeVersionId/);
  assert.match(detail, /run\(false\)/);
  assert.match(detail, /onChanged\?\.\(\)/);
  assert.match(detail, /readinessRevision/);
  assert.match(api, /resume_version_id/);
  assert.match(detail, /role="progressbar"/);
  assert.match(detail, /aria-valuenow=\{boundedValue\}/);
  for (const phrase of ['Reviewing this job', 'Writing the explanation', 'Checking your evidence', 'Writing your documents', 'Creating and verifying files']) {
    assert.match(detail, new RegExp(phrase));
  }
});

test('copy keeps secure-context clipboard plus hidden-textarea fallback', () => {
  assert.match(detail, /navigator\.clipboard/);
  assert.match(detail, /document\.createElement\('textarea'\)/);
  assert.match(detail, /document\.execCommand\('copy'\)/);
});

test('obsolete tailoring endpoint and button are absent from active frontend and server source', () => {
  const server = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
  assert.doesNotMatch(detail + api + server, /tailoring-template|CopyTailoringPromptButton|getTailoringTemplate/);
  assert.match(api, /registerApplicationPackageArtifact/);
  assert.match(api, /appendApplicationPackageEvent/);
});
