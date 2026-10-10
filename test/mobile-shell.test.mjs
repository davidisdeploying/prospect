// §PWA shell v2 — the compact (<=960px) shell contract: the stacked desktop rail is removed from
// layout entirely (display:none), replaced by a sticky top app bar (safe-area-inset-top, compact
// page-specific Prospect seal, section title, 44x44 Stake plus) and a fixed bottom tab bar (safe-area-inset-
// bottom, five icon+text tabs, verdigris active state). Both are driven by one shared nav-data
// module (shared/nav.mjs) consumed by the SPA (AppShell.jsx) and the four server-rendered pages
// (server/shell.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Database from 'better-sqlite3';

import { NAV_ITEMS, TOPBAR_ICON_SHAPES, activeNavPath, stripNavQuery } from '../shared/nav.mjs';
import { renderSidebarNav, renderTopBar, renderTabBar, SHELL_STYLE } from '../server/shell.js';
import { loadVecExtension } from '../server/vecExtension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const shellSource = fs.readFileSync(path.join(repoRoot, 'app/src/AppShell.jsx'), 'utf8');
const shellCss = fs.readFileSync(path.join(repoRoot, 'app/src/app-shell.css'), 'utf8');
const appSource = fs.readFileSync(path.join(repoRoot, 'app/src/App.jsx'), 'utf8');
const claimDetailSource = fs.readFileSync(path.join(repoRoot, 'app/src/ClaimDetail.jsx'), 'utf8');
const motionCss = fs.readFileSync(path.join(repoRoot, 'design-system/tokens/motion.css'), 'utf8');

const SERVER_PAGE_SOURCES = [
  ['diggings', fs.readFileSync(path.join(repoRoot, 'server/diggings.js'), 'utf8')],
  ['scout', fs.readFileSync(path.join(repoRoot, 'server/scout.js'), 'utf8')],
  ['huntReport', fs.readFileSync(path.join(repoRoot, 'server/huntReport.js'), 'utf8')],
  ['claimoffice', fs.readFileSync(path.join(repoRoot, 'server/claimoffice.js'), 'utf8')],
];

const EXPECTED_ORDER = ['/diggings', '/', '/scout', '/report', '/claim-office'];
const EXPECTED_MOBILE_LABELS = ['Today', 'Claims', 'Scout', 'Report', 'Office'];

// React's renderToStaticMarkup HTML-escapes text nodes (e.g. "'" -> "&#x27;"); server/shell.js's
// plain string templates don't. Normalize both sides to a plain-text needle search.
function indexOfTagText(html, text) {
  const plain = html.indexOf(`>${text}<`);
  if (plain > -1) return plain;
  return html.indexOf(`>${text.replace(/'/g, '&#x27;')}<`);
}

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(repoRoot, 'schema.sql'), 'utf8'));
  return db;
}

// ---------------------------------------------------------------------------------------------
// Shared nav data (shared/nav.mjs) — the single source of truth for both consumers.
// ---------------------------------------------------------------------------------------------

test('shared nav data: five destinations in the required order with desktop/mobile labels', () => {
  assert.deepEqual(NAV_ITEMS.map((i) => i.path), EXPECTED_ORDER);
  assert.deepEqual(NAV_ITEMS.map((i) => i.mobileLabel), EXPECTED_MOBILE_LABELS);
  assert.equal(NAV_ITEMS.find((i) => i.path === '/diggings').desktopTitle, "The Day's Diggings");
  assert.equal(NAV_ITEMS.find((i) => i.path === '/').desktopTitle, 'Claim Map');
  assert.equal(NAV_ITEMS.find((i) => i.path === '/claim-office').desktopTitle, 'Claim Office');
  for (const item of NAV_ITEMS) assert.ok(item.gloss && item.icon, `${item.path} has a gloss and an icon key`);
});

test('activeNavPath ignores query strings and hash, and treats /scout?... as Scout', () => {
  assert.equal(activeNavPath('/scout?status=new'), '/scout');
  assert.equal(activeNavPath('/claim-office#section'), '/claim-office');
  assert.equal(activeNavPath('/'), '/');
  assert.equal(activeNavPath('/report?x=1&y=2'), '/report');
  assert.equal(activeNavPath('/not-a-real-page'), null);
  assert.equal(stripNavQuery('/scout?status=new'), '/scout');
  assert.equal(stripNavQuery(''), '/');
});

// ---------------------------------------------------------------------------------------------
// SPA shell (AppShell.jsx / app-shell.css) — desktop preserved, compact chrome replaces the rail.
// ---------------------------------------------------------------------------------------------

test('desktop shell is preserved: 272px sidebar, full lockup, nav-card language, verdigris rail, footer', () => {
  assert.match(shellSource, /gridTemplateColumns: '272px 1fr'/);
  assert.match(shellSource, /className="prospect-sidebar"/);
  assert.match(shellSource, /<Wordmark className="prospect-wordmark"/);
  assert.match(shellSource, /className="prospect-stake-button"/);
  assert.match(shellSource, /className=\{`nav-indicator/);
  assert.match(shellSource, /prospect-sidebar-footer/);
});

test('compact shell removes the stacked rail from layout entirely (display:none), not a shrink', () => {
  assert.match(shellCss, /@media \(max-width: 960px\)/);
  assert.match(shellCss, /\.prospect-sidebar\s*\{\s*display: none !important;/);
  assert.doesNotMatch(shellCss, /\.prospect-wordmark[\s\S]*height: 64px/, 'no leftover shrink-to-64px mobile wordmark rule');
  assert.doesNotMatch(shellCss, /\.prospect-nav\s*\{\s*display: grid/, 'no leftover 2-col mobile nav-card grid');
});

test('compact top bar: sticky, owns safe-area-inset-top, uses page-specific gold Prospect seals, 44x44 neutral plus', () => {
  assert.match(shellSource, /TOPBAR_ICON_SHAPES/);
  assert.match(shellSource, /<PageSeal icon=\{activeItem\?\.icon \?\? 'map'\}/);
  assert.match(shellSource, /prospect-page-seal-accent/);
  assert.doesNotMatch(shellSource, /prospect-mark-compact/);
  assert.match(shellCss, /\.prospect-topbar\s*\{[\s\S]*position: sticky;[\s\S]*top: 0;/);
  assert.match(shellCss, /\.prospect-topbar\s*\{[\s\S]*var\(--sat, 0px\)/);
  assert.match(shellCss, /\.prospect-page-seal\s*\{[\s\S]*width: 40px;[\s\S]*height: 40px;/);
  assert.match(shellCss, /\.prospect-page-seal-accent\s*\{[\s\S]*color: var\(--placer-gold, var\(--gold, #CDA349\)\)/);
  assert.match(shellCss, /\.prospect-page-seal-accent\s*\{[\s\S]*stroke: var\(--placer-gold, var\(--gold, #CDA349\)\)/);
  assert.match(shellCss, /\.prospect-topbar-stake\s*\{[\s\S]*width: 44px;[\s\S]*height: 44px;/);
  // Quartz/neutral, never gold — the page seal stays the one gold accent.
  const stakeBtnBlock = shellCss.slice(shellCss.indexOf('.prospect-topbar-stake {'), shellCss.indexOf('.prospect-tabbar {'));
  assert.doesNotMatch(stakeBtnBlock, /--placer-gold|--accent\b|gold/i);
});

test('top-bar seal symbols are distinct and mining-office themed for all five destinations', () => {
  assert.deepEqual(Object.keys(TOPBAR_ICON_SHAPES), ['diggings', 'map', 'scout', 'report', 'office']);
  for (const item of NAV_ITEMS) {
    const seal = TOPBAR_ICON_SHAPES[item.icon];
    assert.ok(seal, `${item.mobileLabel} has a seal`);
    assert.ok(seal.base.length > 0, `${item.mobileLabel} has a structural drawing`);
    assert.ok(seal.accent.length > 0, `${item.mobileLabel} has a controlled gold detail`);
  }
  const shovel = TOPBAR_ICON_SHAPES.diggings;
  assert.match(shovel.base[0].attrs.d, /C9 3\.6 10\.3 2\.5 12 2\.5s3 1\.1 3 3/, 'Today has a recognizable D-grip');
  assert.equal(shovel.base[1].attrs.d, 'M12 6v10.5', 'Today has a straight shovel shaft');
  assert.equal(shovel.accent[0].attrs.fill, 'currentColor', 'Today’s pointed spade blade is the gold mass');
  assert.equal(shovel.accent[0].attrs.stroke, 'none', 'the small blade stays visually solid at 40px');
});

test('compact bottom tab bar: fixed, owns safe-area-inset-bottom, verdigris (not gold) active state, 44px targets', () => {
  assert.match(shellCss, /\.prospect-tabbar\s*\{[\s\S]*position: fixed;[\s\S]*bottom: 0;/);
  assert.match(shellCss, /\.prospect-tabbar\s*\{[\s\S]*padding-bottom: var\(--sab, 0px\);/);
  assert.match(shellCss, /\.prospect-tab\s*\{[\s\S]*min-height: 44px;/);
  assert.match(shellCss, /\.prospect-tab\.is-active\s*\{\s*color: var\(--verdigris\);/);
  assert.doesNotMatch(shellCss, /\.prospect-tab\.is-active\s*\{\s*color: var\(--placer-gold\)/);
  assert.match(shellSource, /aria-current=\{isActive \? 'page' : undefined\}/);
});

test('safe-area ownership moved off the blanket body rule to the compact chrome; content reserves tab-bar space', () => {
  assert.doesNotMatch(shellCss, /^body \{[\s\S]*?padding-top: var\(--sat\)/m);
  assert.doesNotMatch(shellCss, /^body \{[\s\S]*?padding-bottom: var\(--sab\)/m);
  assert.match(shellCss, /body \{[\s\S]*padding-right: var\(--sar\)/);
  assert.match(shellCss, /body \{[\s\S]*padding-left: var\(--sal\)/);
  assert.match(shellCss, /--prospect-tabbar-safe: calc\(60px \+ var\(--sab, 0px\)\)/);
  assert.match(shellCss, /\.prospect-field\s*\{\s*padding-bottom: var\(--prospect-tabbar-safe, 60px\);/);
});

test('Claim Detail is a centered wide modal on desktop and a safe-area-aware full-screen workspace on phones', () => {
  assert.match(shellCss, /\.claim-scrim\s*\{[\s\S]*?align-items: center;[\s\S]*?justify-content: center;[\s\S]*?padding: 32px;/);
  assert.match(shellCss, /\.claim-panel\s*\{[\s\S]*?width: min\(1120px, 100%\);[\s\S]*?height: min\(92dvh, 1040px\);/);
  assert.match(shellCss, /@media \(max-width: 640px\)[\s\S]*?\.claim-scrim\s*\{[\s\S]*?padding: var\(--sat, 0px\) 0 var\(--sab, 0px\);/);
  assert.match(shellCss, /@media \(max-width: 640px\)[\s\S]*?\.claim-panel\s*\{[\s\S]*?border-radius: 0;/);
  assert.match(shellCss, /\.claim-detail-header\s*\{[\s\S]*?position: sticky;[\s\S]*?top: 0;/);
  assert.match(shellCss, /\.claim-detail-footer\s*\{[\s\S]*?position: sticky;[\s\S]*?bottom: 0;/);
  assert.match(claimDetailSource, /className="claim-detail-header"/);
  assert.match(claimDetailSource, /className="claim-detail-footer"/);
  assert.match(claimDetailSource, /className=\{`claim-panel on-light/);
  assert.match(claimDetailSource, /How well does this role fit you\?/);
  assert.match(claimDetailSource, /Evidence details and audit history/);
  assert.doesNotMatch(claimDetailSource, /<strong style=\{\{ fontSize: 13 \}\}>Requirement matrix<\/strong>/);
  assert.match(shellCss, /\.job-audit\s*\{[\s\S]*?background: var\(--surface-raised\);/);
  assert.match(shellCss, /\.audit-requirement-groups,[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(motionCss, /\.claim-panel\s*\{\s*transform: translateY\(0\) scale\(1\);/);
  assert.match(motionCss, /@starting-style\s*\{\s*\.claim-panel\s*\{\s*transform: translateY\(12px\) scale\(0\.985\);/);
});

test('compact chrome respects keyboard focus visibility', () => {
  assert.match(shellCss, /\.prospect-topbar-stake:focus-visible,\s*\n\s*\.prospect-tab:focus-visible \{/);
});

test('AppShell imports the shared nav module rather than maintaining its own duplicate array', () => {
  assert.match(shellSource, /import \{ NAV_ITEMS, NAV_ICON_SHAPES, TOPBAR_ICON_SHAPES, activeNavPath \} from '\.\.\/\.\.\/shared\/nav\.mjs'/);
  assert.doesNotMatch(shellSource, /const NAV_ITEMS = \[/, 'AppShell no longer hardcodes its own nav array');
});

// ---------------------------------------------------------------------------------------------
// AppShell rendered output — order, active state, compact plus is a button (opens dialog inline).
// ---------------------------------------------------------------------------------------------

function bundleAppShell() {
  const bundlePath = path.join(__dirname, '.mobile-shell-appshell-bundle.cjs');
  const result = esbuild.buildSync({
    entryPoints: [path.join(repoRoot, 'app/src/AppShell.jsx')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    loader: { '.css': 'empty', '.svg': 'text' },
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    alias: { '@ds': path.join(repoRoot, 'design-system') },
    logLevel: 'silent',
  });
  fs.writeFileSync(bundlePath, result.outputFiles[0].text);
  delete require.cache[require.resolve(bundlePath)];
  const { AppShell } = require(bundlePath);
  return { AppShell, bundlePath };
}

function renderAppShellAt(pathname, search = '') {
  const { AppShell, bundlePath } = bundleAppShell();
  global.window = { location: { pathname, search } };
  try {
    return renderToStaticMarkup(React.createElement(AppShell, { onStake: () => {} }, 'content'));
  } finally {
    delete global.window;
    fs.rmSync(bundlePath, { force: true });
  }
}

test('AppShell desktop sidebar renders all five destinations in the shared order with desktopTitle', () => {
  const html = renderAppShellAt('/');
  const idxs = NAV_ITEMS.map((item) => indexOfTagText(html, item.desktopTitle));
  assert.ok(idxs.every((i) => i > -1), 'every desktopTitle appears in the sidebar markup');
  assert.deepEqual([...idxs].sort((a, b) => a - b), idxs, 'sidebar items appear in shared-order sequence');
});

test('AppShell compact tab bar renders five tabs with mobileLabel text in the shared order, aria-current on the active one', () => {
  const html = renderAppShellAt('/');
  // "Claims" also appears earlier in the top bar's section title (same text, different element) —
  // scope the ordering check to the tab bar fragment itself, not the whole document.
  const tabBarHtml = html.slice(html.indexOf('<nav class="prospect-tabbar"'));
  const idxs = NAV_ITEMS.map((item) => indexOfTagText(tabBarHtml, item.mobileLabel));
  assert.ok(idxs.every((i) => i > -1), 'every mobileLabel appears in the tab bar markup');
  assert.deepEqual([...idxs].sort((a, b) => a - b), idxs, 'tabs appear in shared-order sequence');
  assert.match(tabBarHtml, /class="prospect-tab is-active" aria-current="page"[^>]*>[\s\S]*?>Claims</, 'Claim Map ("/") is active by default');
});

test('AppShell compact top bar plus is a real button that opens the dialog inline (not a query-param link)', () => {
  const html = renderAppShellAt('/');
  assert.match(html, /<button[^>]*class="prospect-topbar-stake"[^>]*aria-label="Stake a claim"/);
  assert.doesNotMatch(html, /class="prospect-topbar-stake" href=/, 'the SPA plus is a button, unlike the SSR pages\' deep-link anchor');
});

// ---------------------------------------------------------------------------------------------
// Shared server shell (server/shell.js) consumed by all four SSR pages.
// ---------------------------------------------------------------------------------------------

test('renderTopBar deep-links the compact plus and selects Scout’s binocular seal', () => {
  const html = renderTopBar('/scout');
  assert.match(html, /<a class="prospect-topbar-stake" href="\/\?stake=1" aria-label="Stake a claim">/);
  assert.match(html, /class="prospect-page-seal"/);
  assert.match(html, /class="prospect-page-seal-accent"/);
  assert.match(html, /m5\.5 14 2-7h3l1\.5 7 1\.5-7h3l2 7/, 'Scout renders the binoculars geometry');
  assert.doesNotMatch(html, /prospect-mark-compact/);
  assert.match(html, />Scout</, 'top bar title reflects the active page\'s mobileLabel');
});

test('renderTabBar renders five tabs in shared order with aria-current on the active page only', () => {
  const html = renderTabBar('/claim-office');
  const idxs = NAV_ITEMS.map((item) => html.indexOf(`>${item.mobileLabel}<`));
  assert.deepEqual([...idxs].sort((a, b) => a - b), idxs);
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
  assert.match(html, /class="prospect-tab is-active" aria-current="page"[\s\S]*?>Office</);
});

test('renderSidebarNav marks exactly the requested page active', () => {
  const html = renderSidebarNav('/report');
  assert.equal((html.match(/is-active/g) || []).length, 2, 'one is-active on the nav-item, one on its indicator');
  assert.match(html, /<a href="\/report" class="nav-item is-active">/);
});

test('SHELL_STYLE centralizes the desktop rail + compact chrome CSS shared by all four SSR pages', () => {
  assert.match(SHELL_STYLE, /\.report-shell \{ display: grid; grid-template-columns: 272px 1fr/);
  assert.match(SHELL_STYLE, /\.prospect-topbar/);
  assert.match(SHELL_STYLE, /\.prospect-tabbar/);
  assert.match(SHELL_STYLE, /\.report-aside \{ display: none; \}/);
});

test('all four SSR page modules render the shared top bar + tab bar via server/shell.js, not a bespoke duplicate', () => {
  for (const [name, source] of SERVER_PAGE_SOURCES) {
    assert.match(source, /from '\.\/shell\.js'/, `${name} imports server/shell.js`);
    assert.match(source, /renderSidebarNav\(/, `${name} calls renderSidebarNav`);
    assert.match(source, /renderTopBar\(/, `${name} calls renderTopBar`);
    assert.match(source, /renderTabBar\(/, `${name} calls renderTabBar`);
    // No page keeps its own copy of the five-link literal array anymore.
    assert.doesNotMatch(source, /<span class="nav-title">Claim Office<\/span>/, `${name} has no leftover literal nav markup`);
    assert.doesNotMatch(source, /<span class="nav-title">The Day's Diggings<\/span>/, `${name} has no leftover literal nav markup`);
  }
});

test('all five pages surface a top bar and a tab bar with correct active state (rendered HTML)', () => {
  const db = freshDb();
  const cases = [
    ['diggings', async () => {
      const { renderDailyDiggingsHtml, getDailyDiggings } = await import('../server/diggings.js');
      return renderDailyDiggingsHtml(getDailyDiggings(db));
    }, 'Today'],
    ['scout', async () => {
      const { renderScoutHtml, getScout } = await import('../server/scout.js');
      return renderScoutHtml(getScout(db));
    }, 'Scout'],
    ['report', async () => {
      const { renderHuntReportHtml, getHuntReport } = await import('../server/huntReport.js');
      return renderHuntReportHtml(getHuntReport(db));
    }, 'Report'],
    ['claim-office', async () => {
      const { renderClaimOfficeHtml, getClaimOffice } = await import('../server/claimoffice.js');
      return renderClaimOfficeHtml(getClaimOffice(db));
    }, 'Office'],
  ];
  return Promise.all(cases.map(async ([name, render, mobileLabel]) => {
    const html = await render();
    assert.match(html, /class="prospect-topbar"/, `${name} has a top bar`);
    assert.match(html, /class="prospect-tabbar"/, `${name} has a tab bar`);
    assert.match(html, /class="prospect-page-seal"/, `${name} has its page seal`);
    assert.match(html, /class="prospect-page-seal-accent"/, `${name} seal has a gold accent layer`);
    assert.doesNotMatch(html, /prospect-mark-compact\.svg/, `${name} no longer repeats the generic pickaxe mark`);
    const tabBarHtml = html.slice(html.indexOf('<nav class="prospect-tabbar"'));
    assert.equal((tabBarHtml.match(/aria-current="page"/g) || []).length, 1, `${name} has exactly one active tab`);
    const activeTabRe = new RegExp(`class="prospect-tab is-active" aria-current="page"[\\s\\S]*?>${mobileLabel}<`);
    assert.match(html, activeTabRe, `${name} tab bar marks ${mobileLabel} active`);
  }));
});

// ---------------------------------------------------------------------------------------------
// Pure stake=1 deep-link helpers (App.jsx) — initial open + close strips only `stake`.
// ---------------------------------------------------------------------------------------------

function bundleApp() {
  const bundlePath = path.join(__dirname, '.mobile-shell-app-bundle.cjs');
  const result = esbuild.buildSync({
    entryPoints: [path.join(repoRoot, 'app/src/App.jsx')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    loader: { '.css': 'empty', '.svg': 'text' },
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'better-sqlite3'],
    alias: { '@ds': path.join(repoRoot, 'design-system') },
    logLevel: 'silent',
  });
  fs.writeFileSync(bundlePath, result.outputFiles[0].text);
  delete require.cache[require.resolve(bundlePath)];
  return { mod: require(bundlePath), bundlePath };
}

test('parseInitialStake / stripStakeParam: initial open, and close removes only stake, preserving other params', () => {
  const { mod, bundlePath } = bundleApp();
  try {
    assert.equal(mod.parseInitialStake('?stake=1'), true);
    assert.equal(mod.parseInitialStake('?source=pwa&stake=1'), true);
    assert.equal(mod.parseInitialStake('?stake=0'), false);
    assert.equal(mod.parseInitialStake(''), false);
    assert.equal(mod.parseInitialStake(null), false);

    assert.equal(mod.stripStakeParam('?stake=1'), '');
    assert.equal(mod.stripStakeParam('?stake=1&claim=7'), '?claim=7');
    assert.equal(mod.stripStakeParam('?claim=7&stake=1&source=pwa'), '?claim=7&source=pwa');
    assert.equal(mod.stripStakeParam('?claim=7'), '?claim=7', 'no-op when stake is already absent');
  } finally {
    fs.rmSync(bundlePath, { force: true });
  }
});

test('App.jsx seeds the Stake dialog from the initial stake=1 param and preserves the hash on close, mirroring the claim deep-link pattern', () => {
  assert.match(appSource, /useState\(\(\) => \{\s*if \(typeof window === 'undefined'\) return false;\s*return parseInitialStake\(window\.location\.search\);/);
  assert.match(appSource, /function closeStakeUrlParam\(\)/);
  assert.match(appSource, /stripStakeParam\(window\.location\.search\)/);
  assert.match(appSource, /window\.location\.pathname \+ newSearch \+ window\.location\.hash/);
});
