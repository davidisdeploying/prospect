import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const popupPath = path.join(
  process.cwd(),
  'extension',
  'src',
  'popup',
  'popup.js',
);

test('extension reports re-survey/idempotency before repost and Scout acknowledgements', () => {
  const source = fs.readFileSync(popupPath, 'utf8');
  const duplicateBranch = source.indexOf('if (claim && claim.duplicate_capture)');
  const refreshBranch = source.indexOf('else if (claim && claim.refreshed_existing_claim)');
  const repostBranch = source.indexOf('if (claim && claim.repost_candidate)');
  const scoutBranch = source.indexOf('else if (claim && claim.scout_enriched)');
  const duplicateMessage = source.indexOf('is already current · no duplicate created.');
  const refreshMessage = source.indexOf('refreshed · snapshot generation');
  const repostMessage = source.indexOf('Claim staked · possible repost');
  const scoutMessage = source.indexOf('Claim staked · Scout lead enriched & linked.');

  assert.ok(duplicateBranch >= 0, 'duplicate result branch exists');
  assert.ok(refreshBranch > duplicateBranch, 'refresh follows exact-duplicate acknowledgement');
  assert.ok(repostBranch > refreshBranch, 'ordinary repost warning remains below same-claim results');
  assert.ok(scoutBranch > repostBranch, 'Scout acknowledgement remains lower precedence');
  assert.ok(duplicateMessage > duplicateBranch && duplicateMessage < refreshBranch);
  assert.ok(refreshMessage > refreshBranch && refreshMessage < repostBranch);
  assert.ok(repostMessage > repostBranch && repostMessage < scoutBranch);
  assert.ok(scoutMessage > scoutBranch);
  assert.match(source, /if \(submitting\) return;/, 'double-submit guard remains present');
});
