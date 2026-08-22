import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function readPngDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  assert.ok(buf.length > 24, `${filePath} is not a valid file`);
  assert.equal(buf.toString('hex', 0, 8), '89504e470d0a1a0a', `${filePath} is not a PNG file`);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return { w, h };
}

test('PWA manifest validity and fields', () => {
  const manifestPath = path.join(repoRoot, 'app/public/manifest.webmanifest');
  assert.ok(fs.existsSync(manifestPath), 'manifest.webmanifest exists');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.equal(manifest.id, '/');
  assert.equal(manifest.name, 'Prospect');
  assert.equal(manifest.short_name, 'Prospect');
  // §PWA shell v2: launches straight into the daily action queue rather than the Claim Map;
  // `id` and `scope` stay "/" so the installed app identity/navigation scope are unaffected.
  assert.equal(manifest.start_url, '/diggings?source=pwa');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#1B2327');
  assert.equal(manifest.theme_color, '#1B2327');

  assert.ok(Array.isArray(manifest.icons), 'manifest has icons array');
  const has192 = manifest.icons.some(
    (i) => i.src === '/icon-192.png' && i.sizes === '192x192' && i.type === 'image/png'
  );
  const has512 = manifest.icons.some(
    (i) => i.src === '/icon-512.png' && i.sizes === '512x512' && i.type === 'image/png'
  );
  assert.ok(has192, 'manifest includes 192x192 PNG icon');
  assert.ok(has512, 'manifest includes 512x512 PNG icon');
});

test('PWA icon dimensions match specifications', () => {
  const icon192 = readPngDimensions(path.join(repoRoot, 'app/public/icon-192.png'));
  assert.deepEqual(icon192, { w: 192, h: 192 });

  const icon512 = readPngDimensions(path.join(repoRoot, 'app/public/icon-512.png'));
  assert.deepEqual(icon512, { w: 512, h: 512 });

  const appleIcon = readPngDimensions(path.join(repoRoot, 'app/public/apple-touch-icon.png'));
  assert.deepEqual(appleIcon, { w: 180, h: 180 });
});

test('PWA icon mark is enlarged, centered, and synchronized with brand assets', () => {
  const source = fs.readFileSync(
    path.join(repoRoot, 'design-system/assets/prospect-favicon-pick.svg'),
    'utf8',
  );
  const transform = source.match(/<g transform="translate\(([-\d.]+),([-\d.]+)\) scale\(([-\d.]+)\)"/);
  assert.ok(transform, 'icon source declares one translate/scale transform for the pickaxe');

  const [, txText, tyText, scaleText] = transform;
  const tx = Number(txText);
  const ty = Number(tyText);
  const scale = Number(scaleText);
  assert.ok(scale >= 1, 'pickaxe fills more of the icon than the original 0.82-scale mark');

  // The untransformed stroked mark spans x=10..54 and y=12..58. Its transformed
  // visible bounds must share the SVG viewport's exact 32,32 center.
  assert.equal(tx + scale * ((10 + 54) / 2), 32, 'pickaxe is horizontally centered');
  assert.equal(ty + scale * ((12 + 58) / 2), 32, 'pickaxe is vertically centered');

  const sha256 = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  assert.equal(
    sha256(path.join(repoRoot, 'app/public/icon-512.png')),
    sha256(path.join(repoRoot, 'design-system/assets/prospect-icon-512.png')),
    'PWA 512 icon matches the canonical design-system rendition',
  );
  assert.equal(
    sha256(path.join(repoRoot, 'app/public/apple-touch-icon.png')),
    sha256(path.join(repoRoot, 'design-system/assets/apple-touch-icon.png')),
    'PWA Apple touch icon matches the canonical design-system rendition',
  );
});

test('PWA head metadata is present across all 5 pages', async () => {
  const spaHtml = fs.readFileSync(path.join(repoRoot, 'app/index.html'), 'utf8');

  const { db } = await import('../server/db.js');
  const { renderScoutHtml, getScout } = await import('../server/scout.js');
  const scoutHtml = renderScoutHtml(getScout(db));

  const { renderHuntReportHtml, getHuntReport } = await import('../server/huntReport.js');
  const huntHtml = renderHuntReportHtml(getHuntReport(db));

  const { renderClaimOfficeHtml, getClaimOffice } = await import('../server/claimoffice.js');
  const officeHtml = renderClaimOfficeHtml(getClaimOffice(db));

  const { renderDailyDiggingsHtml, getDailyDiggings } = await import('../server/diggings.js');
  const diggingsHtml = renderDailyDiggingsHtml(getDailyDiggings(db));

  const pages = [
    { name: 'SPA /', html: spaHtml },
    { name: 'Scout /scout', html: scoutHtml },
    { name: 'Hunt Report /report', html: huntHtml },
    { name: 'Claim Office /claim-office', html: officeHtml },
    { name: 'Diggings /diggings', html: diggingsHtml },
  ];

  for (const { name, html } of pages) {
    assert.match(html, /viewport-fit=cover/, `${name} has viewport-fit=cover`);
    assert.match(html, /name="theme-color" content="#1B2327"/, `${name} has theme-color`);
    assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/, `${name} has apple-mobile-web-app-capable`);
    assert.match(html, /name="apple-mobile-web-app-status-bar-style" content="black-translucent"/, `${name} has status bar style`);
    assert.match(html, /name="apple-mobile-web-app-title" content="Prospect"/, `${name} has web app title`);
    assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/, `${name} links manifest`);
    assert.match(html, /rel="apple-touch-icon"/, `${name} links apple-touch-icon`);
    assert.match(html, /src="\/pwa-register\.js"/, `${name} loads registration script`);
  }
});

test('PWA safe-area CSS rules in app-shell.css', () => {
  const css = fs.readFileSync(path.join(repoRoot, 'app/src/app-shell.css'), 'utf8');
  const serverHead = fs.readFileSync(path.join(repoRoot, 'server/pwaHead.js'), 'utf8');
  const shell = fs.readFileSync(path.join(repoRoot, 'server/shell.js'), 'utf8');
  assert.match(css, /env\(safe-area-inset-top/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(serverHead, /env\(safe-area-inset-top/, '--sat custom property is still defined for SSR pages');
  assert.match(serverHead, /env\(safe-area-inset-bottom/, '--sab custom property is still defined for SSR pages');
  // Shared SSR chrome (server/shell.js) owns top/bottom insets on its own topbar/tabbar.
  assert.match(shell, /var\(--sat, 0px\)/, 'compact top bar consumes --sat itself');
  assert.match(shell, /var\(--sab, 0px\)/, 'compact tab bar consumes --sab itself');
});

test('§PWA shell v2: top/bottom safe-area ownership moved off the blanket body rule to dedicated chrome', () => {
  const css = fs.readFileSync(path.join(repoRoot, 'app/src/app-shell.css'), 'utf8');
  const serverHead = fs.readFileSync(path.join(repoRoot, 'server/pwaHead.js'), 'utf8');
  // The SPA and the SSR pages both keep body owning left/right (no dedicated chrome there)...
  assert.match(css, /body \{[\s\S]*padding-right: var\(--sar\)/);
  assert.match(css, /body \{[\s\S]*padding-left: var\(--sal\)/);
  assert.match(serverHead, /body \{[\s\S]*padding-right: var\(--sar\)/);
  assert.match(serverHead, /body \{[\s\S]*padding-left: var\(--sal\)/);
  // ...but no longer double up top/bottom padding on body now that the compact top bar and
  // bottom tab bar own those insets directly.
  assert.doesNotMatch(css, /body \{[\s\S]*?padding-top: var\(--sat\)/m);
  assert.doesNotMatch(css, /body \{[\s\S]*?padding-bottom: var\(--sab\)/m);
  assert.doesNotMatch(serverHead, /body \{[\s\S]*?padding-top: var\(--sat\)/m);
  assert.doesNotMatch(serverHead, /body \{[\s\S]*?padding-bottom: var\(--sab\)/m);
});

test('PWA registration script safeguards and update/iOS UI', () => {
  const script = fs.readFileSync(path.join(repoRoot, 'app/public/pwa-register.js'), 'utf8');
  assert.match(script, /serviceWorker/);
  assert.match(script, /display-mode: standalone/);
  assert.match(script, /Install Prospect: tap/);
  assert.match(script, /A new version of Prospect is ready/);
  assert.match(script, /SKIP_WAITING/);
  assert.match(script, /controllerchange/, 'reload waits for the new worker to control the page');
  assert.match(
    script,
    /bottom: calc\(20px \+ var\(--prospect-tabbar-safe, 0px\)\)/,
    'the update banner clears the compact navigation bar',
  );
  assert.match(
    script,
    /bottom: var\(--prospect-tabbar-safe, 0px\)/,
    'the iOS install guidance clears the compact navigation bar',
  );
});

test('PWA service worker caching and bypass rules', () => {
  const sw = fs.readFileSync(path.join(repoRoot, 'app/src/sw.js'), 'utf8');
  const vite = fs.readFileSync(path.join(repoRoot, 'app/vite.config.js'), 'utf8');
  // §PWA shell v2: /diggings is now the manifest start_url and is server-rendered like /scout,
  // /report, and /claim-office — it must be classified alongside them, never cached as the SPA
  // shell (authenticated, per-request HTML).
  assert.match(sw, /\["\/scout", "\/report", "\/claim-office", "\/diggings"\]/, 'SW classifies /diggings as server-rendered, not the SPA');
  assert.match(sw, /\/api\//, 'SW bypasses /api/ endpoints');
  assert.match(sw, /request\.method !== ['"]GET['"]/, 'SW bypasses non-GET requests');
  assert.match(sw, /offline\.html/, 'SW includes offline fallback');
  assert.match(sw, /redirected/, 'SW checks for redirected responses');
  assert.match(sw, /content-type/, 'SW validates content types before caching');
  assert.match(sw, /responseUrl\.origin !== self\.location\.origin/, 'SW rejects cross-origin login responses');
  assert.match(sw, /id="root"/, 'SW identifies the real SPA shell before caching HTML');
  assert.equal(
    (sw.match(/self\.skipWaiting\(\)/g) || []).length,
    1,
    'SW only skips waiting after the explicit update action'
  );
  assert.match(sw, /prospect-v/, 'SW defines build-versioned cache name');
  assert.doesNotMatch(vite, /Date\.now/, 'cache version is deterministic for identical build inputs');
  assert.match(vite, /buildDigest\.update\(swTemplate\)/, 'cache version includes service-worker source');
  assert.match(vite, /buildDigest\.update\(fs\.readFileSync\(filePath\)\)/, 'cache version includes public PWA assets');
});
