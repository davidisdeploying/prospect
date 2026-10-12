import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const detail = fs.readFileSync(path.join(root, 'app/src/ClaimDetail.jsx'), 'utf8');
const api = fs.readFileSync(path.join(root, 'app/src/api.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');

test('claimed-job UI exposes grounded interview preparation and explicit resume provenance', () => {
  for (const phrase of [
    'Prepare for Interview', 'Interview type', 'Résumé source', 'Scheduled time', 'Duration (minutes)',
    'I confirm this is the résumé I sent for this job.', 'Audited baseline — not confirmed sent.',
    'Your 60-second spine', 'Your verified evidence bridges', 'Be precise about the training ramp',
    'Questions you are likely to hear', 'Compensation answer', 'Questions to ask', 'Before the interview',
    'Download self-contained guide', 'Immutable preparations',
    'Agent company and role research', 'Research queued.', 'Retry agent research', 'Research sources',
  ]) assert.match(detail, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(detail, /disabled=\{busy \|\| !form\.resume_version_id\}/);
  assert.doesNotMatch(detail, /send (?:email|message)|schedule interview|contact employer/i);
});

test('interview-preparation API is create/read/download only and never mutates claim stage', () => {
  assert.match(api, /prepareInterview/); assert.match(api, /interviewPrepArtifactDownloadUrl/);
  assert.match(api, /getInterviewPreparation/); assert.match(api, /retryInterviewResearch/);
  assert.match(server, /post\('\/api\/claims\/:id\/interview-preparations'/);
  assert.match(server, /get\('\/api\/interview-preparations\/:id'/);
  assert.match(server, /post\('\/api\/interview-preparations\/:id\/research\/retry'/);
  assert.match(server, /interview-preparation-artifacts\/:id\/download/);
  assert.doesNotMatch(server, /(?:patch|delete)\('\/api\/interview-preparations/);
});
