#!/usr/bin/env node
// design-system/tools/regenerate-bundle.mjs — regenerate _ds_bundle.js and _ds_manifest.json (H10).
//
// WHY THIS EXISTS. Those two files are generated output of the external `prospect-design` skill
// tool, source-hash-stamped, with no generator in this repository. When M1's token migration deleted
// the legacy --dur-*/--ease-* custom properties, the component SOURCES were updated and the bundle
// was not, so it kept referencing tokens that no longer exist. The roadmap's instruction was
// correct — do not hand-edit hash-stamped output — but that left the artifact permanently stale,
// because the thing that could fix it was not here.
//
// So this is not a hand-edit and not a reimplementation from taste. The bundle's own header records
// its format, and format 3 turned out to be fully recoverable from the artifact: Babel's classic
// JSX transform, ESM statements stripped, each module wrapped in a try/IIFE, exports collected into
// a shared scope, and sha256[:12] of each source recorded in the header.
//
// FIDELITY IS PROVEN, NOT ASSERTED. `--verify` regenerates and checks the result against the
// committed bundle; test/design-system-boundary.test.mjs runs the stronger version of the same
// check — regenerating from the ORIGINAL scaffold-era sources reproduces the committed scaffold-era
// bundle byte for byte. That is what makes it safe to trust this generator's output for the twelve
// sources that have since changed.
//
// WHAT THIS DOES NOT DO: _ds_manifest.json. That file looked like a sibling artifact and is not —
// it is a catalog carrying themes, templates, fonts, starting points, card listings and a token
// index, most of which is not derivable from the component sources at all. An early version of this
// tool regenerated it from what IS derivable and would have destroyed the rest; the scaffold-era
// comparison caught it. Its token index has genuinely drifted (5 legacy motion tokens removed, 16
// new ones added in motion.css and base.css which the catalog does not even scan, 12 values
// changed), but classifying names like --rise, --stagger and --interactive into that catalog's
// color/font/spacing/other/shadow taxonomy would be inventing the owning tool's taxonomy. That half
// of H10 stays with prospect-design, now with the drift measured instead of merely suspected.
//
// Usage (from repo root):
//   node design-system/tools/regenerate-bundle.mjs            # rewrite both artifacts
//   node design-system/tools/regenerate-bundle.mjs --check    # exit 1 if they are stale
//   node design-system/tools/regenerate-bundle.mjs --dir <p>  # operate on another design-system
//
// Requires @babel/core and @babel/plugin-transform-react-jsx. Neither is a DECLARED Prospect
// dependency, deliberately -- nothing in app/, server/ or shared/ loads these artifacts (see the H10
// guard tests), so this is a design-surface tool rather than a build step. Be aware that both
// currently happen to resolve on alpha anyway (@babel/core transitively through
// @vitejs/plugin-react, the JSX plugin from a system Debian package), which makes it easy to assume
// this runs anywhere. It does not; supply them explicitly when it matters.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { check: false, dir: path.join(__dirname, '..') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--check') args.check = true;
    else if (argv[i] === '--dir') { args.dir = path.resolve(argv[i + 1]); i += 1; }
  }
  return args;
}

export function sourceHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12);
}

// A module's exports are exposed on the namespace only when they come from components/ AND start
// with an uppercase letter. ui_kits/ modules are compiled into the shared scope so the preview app
// can use them, but they are not part of the published component surface; a camelCase export like
// Input.jsx's `labelStyle` is an internal helper and is recorded as unexposed rather than published.
function isExposed(sourcePath, name) {
  return sourcePath.startsWith('components/') && /^[A-Z]/.test(name);
}

// Transform one source into its bundle body plus the export names it contributes to the scope.
// Each module compiles into its own IIFE, so a binding imported from a SIBLING module cannot
// simply be dropped along with its import — the reference would resolve to nothing. Those
// references are rewritten to \`__ds_scope.<name>\` lookups against the bundle's shared scope, which
// is exactly how the original artifact links Wordmark -> Logo, ClaimCard -> Tag, and
// Select/Textarea -> Input's labelStyle. React is excluded: it is a genuine global here.
function scopeLinkPlugin({ types: t }) {
  return {
    visitor: {
      ImportDeclaration(declPath) {
        const source = declPath.node.source.value;
        if (!source.startsWith('.')) return; // react and other externals stay globals
        for (const specifier of declPath.node.specifiers) {
          const local = specifier.local.name;
          const imported = specifier.imported ? specifier.imported.name : local;
          const binding = declPath.scope.getBinding(local);
          if (!binding) continue;
          for (const reference of binding.referencePaths) {
            // This plugin runs BEFORE the JSX transform, so a reference used as an element name is
            // still a JSXIdentifier and needs the JSX flavour of member expression; anything else
            // is an ordinary identifier. Using the wrong one fails validation rather than silently
            // emitting something odd, which is how this was caught.
            if (reference.isJSXIdentifier()) {
              reference.replaceWith(
                t.jsxMemberExpression(t.jsxIdentifier('__ds_scope'), t.jsxIdentifier(imported)),
              );
            } else {
              reference.replaceWith(
                t.memberExpression(t.identifier('__ds_scope'), t.identifier(imported)),
              );
            }
          }
        }
      },
    },
  };
}

export function compileModule(babel, absPath, sourcePath) {
  const code = babel.transformSync(fs.readFileSync(absPath, 'utf8'), {
    babelrc: false,
    configFile: false,
    plugins: [scopeLinkPlugin, ['@babel/plugin-transform-react-jsx', { runtime: 'classic' }]],
    compact: false,
  }).code.split('\n');

  const lines = [];
  const exported = [];
  for (let i = 0; i < code.length; i += 1) {
    let line = code[i];
    // React and friends are globals inside the bundle, so import statements are dropped along with
    // the blank line each one leaves behind (that blank line is why naive stripping does not
    // reproduce the original byte for byte).
    if (/^import\s/.test(line)) {
      if (code[i + 1] === '') i += 1;
      continue;
    }
    const declared = /^export\s+(?:default\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/.exec(line);
    if (declared) {
      exported.push(declared[1]);
      line = line.replace(/^export\s+(?:default\s+)?/, '');
    } else if (/^export\s*\{/.test(line)) {
      const names = /\{([^}]*)\}/.exec(line);
      if (names) {
        for (const raw of names[1].split(',').map((s) => s.trim()).filter(Boolean)) {
          exported.push(raw.split(/\s+as\s+/).pop());
        }
      }
      continue;
    }
    lines.push(line);
  }
  return { body: lines.join('\n').trimEnd(), exported };
}

export function buildBundle(babel, dsDir, sourcePaths) {
  const modules = sourcePaths.map((sourcePath) => {
    const abs = path.join(dsDir, sourcePath);
    const { body, exported } = compileModule(babel, abs, sourcePath);
    return { sourcePath, body, exported, hash: sourceHash(fs.readFileSync(abs)) };
  });

  const components = [];
  const unexposedExports = [];
  for (const mod of modules) {
    for (const name of mod.exported) {
      if (isExposed(mod.sourcePath, name)) components.push({ name, sourcePath: mod.sourcePath });
      else if (mod.sourcePath.startsWith('components/')) unexposedExports.push({ name, sourcePath: mod.sourcePath });
    }
  }

  const header = {
    format: 3,
    namespace: 'ProspectDesignSystem_c3fd64',
    components,
    sourceHashes: Object.fromEntries(modules.map((m) => [m.sourcePath, m.hash])),
    inlinedExternals: [],
    unexposedExports,
  };

  const parts = [];
  parts.push(`/* @ds-bundle: ${JSON.stringify(header)} */`);
  parts.push('');
  parts.push('(() => {');
  parts.push('');
  parts.push('const __ds_ns = (window.ProspectDesignSystem_c3fd64 = window.ProspectDesignSystem_c3fd64 || {});');
  parts.push('');
  parts.push('const __ds_scope = {};');
  parts.push('');
  parts.push('(__ds_ns.__errors = __ds_ns.__errors || []);');
  parts.push('');

  for (const mod of modules) {
    parts.push(`// ${mod.sourcePath}`);
    parts.push('try { (() => {');
    parts.push(mod.body);
    if (mod.exported.length) parts.push(`Object.assign(__ds_scope, { ${mod.exported.join(', ')} });`);
    parts.push(`})(); } catch (e) { __ds_ns.__errors.push({ path: ${JSON.stringify(mod.sourcePath)}, error: String((e && e.message) || e) }); }`);
    parts.push('');
  }

  for (const component of components) {
    parts.push(`__ds_ns.${component.name} = __ds_scope.${component.name};`);
    parts.push('');
  }

  parts.push('})();');
  return { code: parts.join('\n'), header };
}

// The source list and its ORDER are part of the artifact's identity, so they are read from the
// existing bundle rather than re-derived from a directory walk — a filesystem ordering difference
// would otherwise reshuffle the whole file and make every diff unreadable.
export function sourcePathsFromBundle(bundlePath) {
  const head = fs.readFileSync(bundlePath, 'utf8').slice(0, 8000);
  const match = /\/\* @ds-bundle: (.*?) \*\//s.exec(head);
  if (!match) throw new Error(`${bundlePath} has no @ds-bundle header`);
  return Object.keys(JSON.parse(match[1]).sourceHashes);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bundlePath = path.join(args.dir, '_ds_bundle.js');

  let babel;
  try {
    babel = await import('@babel/core');
  } catch {
    console.error('This tool needs @babel/core and @babel/plugin-transform-react-jsx.');
    console.error('They are deliberately not Prospect dependencies — nothing in the app loads these');
    console.error('artifacts. Install them in a scratch directory and run with NODE_PATH set, e.g.:');
    console.error('  mkdir -p /tmp/ds && cd /tmp/ds && npm i @babel/core @babel/plugin-transform-react-jsx');
    console.error('  NODE_PATH=/tmp/ds/node_modules node design-system/tools/regenerate-bundle.mjs');
    process.exit(2);
  }

  const sourcePaths = sourcePathsFromBundle(bundlePath);
  const { code, header } = buildBundle(babel.default ?? babel, args.dir, sourcePaths);

  if (args.check) {
    const current = fs.readFileSync(bundlePath, 'utf8');
    if (current.trimEnd() === code.trimEnd()) {
      console.log('_ds_bundle.js is up to date with its sources.');
      process.exit(0);
    }
    console.error('_ds_bundle.js is STALE with respect to its sources. Run without --check to regenerate.');
    process.exit(1);
  }

  fs.writeFileSync(bundlePath, `${code}\n`);
  console.log(`regenerated ${path.relative(process.cwd(), bundlePath)} (${sourcePaths.length} sources, ${header.components.length} exposed)`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
