// H18 -- build-freshness guard.
//
// Why this file exists: on 2026-07-29 the deployed app/dist bundle was found to be ~3d15h older than
// the commit that added the 6.7.1 posting-judgment panel. The panel's source shipped, was committed,
// and passed its own test suite -- while the artifact users actually received did not contain it.
//
// The rest of the suite cannot catch this by construction: every other UI test esbuilds app/src/*.jsx
// FRESH at test time and asserts against that. Those tests pass against source no matter how stale
// app/dist is. A green suite is not, by itself, evidence about what is deployed.
//
// This is the only test that asserts against the BUILT artifact.
//
// app/dist is git-ignored and no timer rebuilds it, so the deployed bundle can silently fall behind
// HEAD with nothing reporting it. If this test fails, the fix is almost always:  npm run build

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// Test-only override, so the negative controls below can point the same checkers at a synthetic
// fixture. Nothing in production sets this; the default is the real deployed bundle.
const distDir = process.env.PROSPECT_DIST_DIR || path.join(repoRoot, 'app', 'dist');

// Everything vite reads to produce app/dist. app/src, design-system (aliased @ds in
// app/vite.config.js), and shared (imported by AppShell.jsx) are the source trees;
// index.html and vite.config.js change the output too.
const SOURCE_ROOTS = [
  path.join(repoRoot, 'app', 'src'),
  path.join(repoRoot, 'design-system'),
  path.join(repoRoot, 'app', 'public'),
  path.join(repoRoot, 'shared'),
];
const SOURCE_FILES = [
  path.join(repoRoot, 'app', 'index.html'),
  path.join(repoRoot, 'app', 'vite.config.js'),
  path.join(repoRoot, 'server', 'pwaHead.js'),
];

// Minification-proof strings ONLY. Never assert on a component or function name -- vite mangles
// those, so a zero is a false negative (PostingJudgmentPanel greps zero in a CORRECT bundle).
// These three are property reads on an object parsed from JSON at runtime, so they survive.
const POSTING_JUDGMENT_MARKERS = ['seniority_assessment', 'repost_assessment', 'comp_assessment'];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function newestSource() {
  const files = [
    ...SOURCE_ROOTS.flatMap(walk),
    ...SOURCE_FILES.filter((f) => fs.existsSync(f)),
  ];
  let newest = null;
  for (const f of files) {
    const mtimeMs = fs.statSync(f).mtimeMs;
    if (!newest || mtimeMs > newest.mtimeMs) newest = { file: f, mtimeMs };
  }
  return newest;
}

// Resolve the entry bundle the way the server does: express.static serves app/dist/index.html from
// disk, and index.html names the hashed asset. Never guess or hardcode the hash.
function resolveDeployedBundle(dir) {
  const indexHtml = path.join(dir, 'index.html');
  assert.ok(
    fs.existsSync(indexHtml),
    `${indexHtml} does not exist -- app/dist has never been built. Fix: npm run build`,
  );
  const html = fs.readFileSync(indexHtml, 'utf8');
  const match = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
  assert.ok(match, `${indexHtml} names no assets/index-*.js entry bundle`);
  const bundlePath = path.join(dir, match[0]);
  assert.ok(
    fs.existsSync(bundlePath),
    `${indexHtml} references ${match[0]} but that file is missing from ${dir} -- `
      + 'half-deployed build. Fix: npm run build',
  );
  return { indexHtml, bundlePath, assetName: match[0] };
}

// Returns null when fresh, or an explanatory string when stale.
function freshnessFailure(dir) {
  const { bundlePath, assetName } = resolveDeployedBundle(dir);
  const bundleMtimeMs = fs.statSync(bundlePath).mtimeMs;
  const newest = newestSource();
  if (!newest) return 'found no source files to compare against -- SOURCE_ROOTS is wrong';
  if (bundleMtimeMs >= newest.mtimeMs) return null;
  return [
    'Deployed bundle is STALE.',
    `  deployed:     ${assetName} (built ${new Date(bundleMtimeMs).toISOString()})`,
    `  newer source: ${path.relative(repoRoot, newest.file)} (edited ${new Date(newest.mtimeMs).toISOString()})`,
    '  Committed source has changed since this bundle was built, so users are being served an',
    '  artifact that does not contain it. Fix: npm run build',
  ].join('\n');
}

// Returns null when every marker is present, or an explanatory string naming what is missing.
function markerFailure(dir) {
  const { bundlePath, assetName } = resolveDeployedBundle(dir);
  const source = fs.readFileSync(bundlePath, 'utf8');
  const missing = POSTING_JUDGMENT_MARKERS.filter((m) => !source.includes(m));
  if (missing.length === 0) return null;
  return [
    `Deployed bundle ${assetName} is missing: ${missing.join(', ')}`,
    '  ClaimDetail.jsx renders the posting-judgment panel in source, but the built artifact',
    '  predates it. This is the exact 2026-07-29 defect. Fix: npm run build',
  ].join('\n');
}

test('build-freshness: deployed bundle is not older than any build input', () => {
  assert.equal(freshnessFailure(distDir), null);
});

test('build-freshness: deployed bundle actually contains the 6.7.1 posting-judgment panel', () => {
  assert.equal(markerFailure(distDir), null);
});

// --- negative controls ---------------------------------------------------------------------------
// A guard that can only ever pass is not a guard. These build synthetic fixtures in a temp dir and
// prove the same checkers reject them. They never touch the repo or the real app/dist.

function makeFixture({ body, mtimeMs }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-freshness-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    '<script type="module" crossorigin src="/assets/index-FIXTURE0.js"></script>',
  );
  const bundlePath = path.join(dir, 'assets', 'index-FIXTURE0.js');
  fs.writeFileSync(bundlePath, body);
  if (mtimeMs) {
    const seconds = mtimeMs / 1000;
    fs.utimesSync(bundlePath, seconds, seconds);
  }
  return { dir, bundlePath };
}

test('build-freshness negative control: a bundle older than source IS rejected', () => {
  const { dir } = makeFixture({
    body: POSTING_JUDGMENT_MARKERS.join(' '),
    mtimeMs: Date.now() - 1000 * 60 * 60 * 24 * 30,
  });
  try {
    const failure = freshnessFailure(dir);
    assert.ok(failure, 'a 30-day-old bundle must be reported stale, but the checker passed it');
    assert.match(failure, /STALE/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build-freshness negative control: a bundle missing the panel markers IS rejected', () => {
  const { dir } = makeFixture({ body: 'a fresh bundle that predates the panel', mtimeMs: Date.now() });
  try {
    const failure = markerFailure(dir);
    assert.ok(failure, 'a bundle without the markers must be rejected, but the checker passed it');
    assert.match(failure, /is missing/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build-freshness negative control: a half-deployed dist IS rejected', () => {
  const { dir, bundlePath } = makeFixture({ body: 'x', mtimeMs: Date.now() });
  try {
    fs.rmSync(bundlePath);
    assert.throws(() => resolveDeployedBundle(dir), /half-deployed build/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
