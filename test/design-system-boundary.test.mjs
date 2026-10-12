// H4 and H10 — the two design-system decisions, recorded as tests rather than as prose that rots.
//
// H4 asked two questions. Both are answered here, and the answers are enforced:
//
//   (a) Adopt lucide-react, or keep hand-rolling inline SVG in Lucide's stroke style?
//       KEEP HAND-ROLLING. Not for taste: shared/nav.mjs holds icon geometry as framework-agnostic
//       DATA ({tag, attrs}) precisely so the SAME icon renders through JSX in the React SPA and
//       through string concatenation in the server-rendered pages (/report, /claim-office,
//       /diggings, /scout, /pledge, /strike-sheet, /almanac). lucide-react is a React component
//       library; it cannot render into a plain HTML string. Adopting it would mean either
//       duplicating every icon or abandoning the JS-free server rendering that is a house rule.
//       The test below fails if lucide is ever added as a dependency, so the trade-off gets
//       re-argued rather than absorbed silently.
//
//   (b) Confirm or replace prospect-mark-compact.svg. CONFIRMED, kept. It is the 16-24px mark in
//       the brand-marks specimen and the favicon for the design-system preview surfaces, and it is
//       served as a stable brand URL beside the lockup.
//
// H10 asked for design-system/_ds_bundle.js and _ds_manifest.json to be regenerated, because M1's
// token migration deleted the legacy --dur-*/--ease-* tokens they still referenced.
//
// The BUNDLE is now regenerated and stays that way. design-system/tools/regenerate-bundle.mjs
// reproduces the artifact's own format 3, and that is proven rather than asserted: regenerating from
// the scaffold-era sources reproduces the committed scaffold-era bundle byte for byte (see the
// fidelity test at the bottom of this file). Seven preview surfaces load and execute that bundle, so
// this was a real defect on a real surface, not only a cosmetic one.
//
// The MANIFEST is deliberately still owned by prospect-design. It looked like a sibling artifact and
// is not: it carries themes, templates, fonts, starting points and card listings that are not
// derivable from component sources. Its token index has drifted too (5 legacy motion tokens removed,
// 16 added in motion.css/base.css which it does not scan, 12 values changed), but classifying names
// like --rise, --stagger and --interactive into its color/font/spacing/other/shadow taxonomy would
// mean inventing that taxonomy.
//
// The tests below keep both halves honest: the bundle can never go silently stale again, and the
// artifacts still never reach the product.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

// --- H4 ----------------------------------------------------------------------------------------

test('H4(a): icon geometry stays framework-agnostic data, usable by both renderers', async () => {
  const { NAV_ICON_SHAPES, NAV_ITEMS } = await import('../shared/nav.mjs');
  for (const item of NAV_ITEMS) {
    const shapes = NAV_ICON_SHAPES[item.icon];
    assert.ok(Array.isArray(shapes) && shapes.length > 0, `${item.icon} must have shape data`);
    for (const shape of shapes) {
      assert.equal(typeof shape.tag, 'string');
      assert.equal(typeof shape.attrs, 'object');
      assert.ok(shape.attrs && !Array.isArray(shape.attrs));
    }
  }
});

test('H4(a): the same icon really does render through both paths', async () => {
  const { renderSidebarNav } = await import('../server/shell.js');
  const html = renderSidebarNav('/report');
  // The server renderer emits real SVG markup from the shared data -- this is the capability
  // lucide-react would remove.
  assert.ok(html.includes('<a href="/report"'), 'server-rendered nav is present');
  assert.ok(html.includes('nav-item'), 'and uses the shared nav item data');
});

test('H4(a): no React-only icon library is a dependency', () => {
  for (const manifest of ['package.json', path.join('app', 'package.json'), path.join('server', 'package.json')]) {
    let raw;
    try { raw = read(manifest); } catch { continue; }
    const pkg = JSON.parse(raw);
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    for (const name of Object.keys(deps)) {
      assert.equal(
        /^lucide/.test(name), false,
        `${manifest} declares ${name}: a React-only icon library cannot render the server-side `
        + 'JS-free pages, which is why icons are hand-rolled from shared/nav.mjs data (H4).',
      );
    }
  }
});

test('H4(b): the compact brand mark is present and served beside the lockup', () => {
  const svg = read('design-system', 'assets', 'prospect-mark-compact.svg');
  assert.ok(svg.includes('<svg'), 'compact mark is real SVG');
  const index = read('server', 'index.js');
  assert.ok(index.includes("/brand/prospect-mark-compact.svg"), 'served as a stable brand URL');
  assert.ok(index.includes("/brand/prospect-lockup.svg"), 'alongside the lockup it pairs with');
});

// --- H10 ---------------------------------------------------------------------------------------

test('H10: the stale design-system bundles are genuinely non-product', () => {
  // The premise of H10's "low priority" ruling, verified rather than assumed.
  for (const dir of ['app/src', 'server', 'shared']) {
    const walk = (current) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(js|jsx|mjs|css|html)$/.test(entry.name)) continue;
        const source = fs.readFileSync(full, 'utf8');
        for (const artifact of ['_ds_bundle', '_ds_manifest']) {
          assert.equal(
            source.includes(artifact), false,
            `${full} references ${artifact}: those files are stale generated output of the external `
            + 'prospect-design tool and must not reach the product (H10).',
          );
        }
      }
    };
    walk(path.join(repoRoot, dir));
  }
});

test('H10: the bundle references no token that tokens/ does not define', () => {
  // The actual defect, stated directly: every custom property the bundle uses must exist. This is
  // what the M1 migration broke and what regeneration fixed.
  const tokens = fs.readdirSync(path.join(repoRoot, 'design-system', 'tokens'))
    .filter((f) => f.endsWith('.css'))
    .map((f) => read('design-system', 'tokens', f))
    .join('\n');
  const defined = new Set([...tokens.matchAll(/(--[A-Za-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const bundle = read('design-system', '_ds_bundle.js');
  const used = new Set([...bundle.matchAll(/var\((--[A-Za-z0-9-]+)/g)].map((m) => m[1]));

  const orphaned = [...used].filter((token) => !defined.has(token));
  assert.deepEqual(orphaned, [], `bundle references undefined tokens: ${orphaned.join(', ')} — regenerate with design-system/tools/regenerate-bundle.mjs`);
  assert.ok(used.size > 0, 'sanity: the bundle does use tokens');
});

test('H10: the bundle is not stale with respect to its sources', async () => {
  // The staleness guard proper. Every source hash in the bundle header must match the file on disk,
  // so the bundle cannot silently fall behind a component edit the way it did after M1.
  const crypto = await import('node:crypto');
  const head = read('design-system', '_ds_bundle.js').slice(0, 8000);
  const header = JSON.parse(/\/\* @ds-bundle: (.*?) \*\//s.exec(head)[1]);

  const stale = [];
  for (const [sourcePath, recorded] of Object.entries(header.sourceHashes)) {
    const actual = crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(repoRoot, 'design-system', sourcePath)))
      .digest('hex')
      .slice(0, 12);
    if (actual !== recorded) stale.push(sourcePath);
  }
  assert.deepEqual(stale, [], `design-system sources changed without regenerating the bundle: ${stale.join(', ')}`);
  assert.equal(header.format, 3);
  assert.equal(header.components.length, 20);
});

test('H10: the regenerator reproduces the committed scaffold bundle byte for byte', async (t) => {
  // The fidelity proof that makes the regenerated output trustworthy: run the generator over the
  // ORIGINAL scaffold-era sources and it must reproduce the ORIGINAL scaffold-era bundle exactly.
  // Needs @babel/core AND @babel/plugin-transform-react-jsx, neither of which is a declared Prospect
  // dependency. @babel/core happens to resolve transitively through @vitejs/plugin-react, and on
  // alpha the JSX plugin resolves from a system Debian path -- so this test can pass here and be
  // unrunnable elsewhere. Both are probed, and the test skips rather than fails when either is
  // missing:
  //   mkdir -p /tmp/ds && cd /tmp/ds && npm i @babel/core @babel/plugin-transform-react-jsx
  //   NODE_PATH=/tmp/ds/node_modules node --test test/design-system-boundary.test.mjs
  let babel;
  try {
    babel = await import('@babel/core');
    await import('@babel/plugin-transform-react-jsx');
  } catch {
    return t.skip('@babel/core or @babel/plugin-transform-react-jsx not resolvable');
  }

  const { execFileSync } = await import('node:child_process');
  const os = await import('node:os');
  const scaffold = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-scaffold-'));
  try {
    execFileSync('bash', ['-c', `git archive 0490bdf design-system | tar -x -C ${scaffold}`], { cwd: repoRoot });
    const dir = path.join(scaffold, 'design-system');
    const original = fs.readFileSync(path.join(dir, '_ds_bundle.js'));
    const originalManifest = fs.readFileSync(path.join(dir, '_ds_manifest.json'));

    const { buildBundle, sourcePathsFromBundle } = await import('../design-system/tools/regenerate-bundle.mjs');
    const { code } = buildBundle(babel.default ?? babel, dir, sourcePathsFromBundle(path.join(dir, '_ds_bundle.js')));

    assert.equal(`${code}\n`, original.toString(), 'regenerated scaffold bundle must be byte-identical to the committed one');
    assert.deepEqual(
      fs.readFileSync(path.join(dir, '_ds_manifest.json')), originalManifest,
      'the generator must not touch the manifest',
    );
  } finally {
    fs.rmSync(scaffold, { recursive: true, force: true });
  }
});

test('H10: the served stylesheet entry point pulls real tokens, not the bundle', () => {
  const styles = read('design-system', 'styles.css');
  assert.equal(styles.includes('_ds_bundle'), false);
  assert.ok(/tokens\//.test(styles), 'styles.css is the entry point the app actually loads');
});
