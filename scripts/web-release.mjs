import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(repoRoot, 'app');
const liveDir = path.join(appDir, 'dist');
const previousDir = path.join(appDir, 'dist.previous');

function requireDirectory(dir, label) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`${label} is missing: ${dir}`);
  }
}

export function validateWebBundle(dir) {
  requireDirectory(dir, 'web bundle');
  const indexPath = path.join(dir, 'index.html');
  if (!fs.existsSync(indexPath)) throw new Error(`web bundle has no index.html: ${dir}`);

  const html = fs.readFileSync(indexPath, 'utf8');
  const assetUrls = [...html.matchAll(/["'](\/assets\/[^"']+)["']/g)].map((match) => match[1]);
  if (!assetUrls.some((asset) => asset.endsWith('.js'))) {
    throw new Error(`web bundle index names no JavaScript entry asset: ${indexPath}`);
  }
  if (!assetUrls.some((asset) => asset.endsWith('.css'))) {
    throw new Error(`web bundle index names no CSS entry asset: ${indexPath}`);
  }

  for (const assetUrl of new Set(assetUrls)) {
    const assetPath = path.join(dir, assetUrl.slice(1));
    if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
      throw new Error(`web bundle index references a missing asset: ${assetUrl}`);
    }
  }

  const manifestPath = path.join(dir, 'manifest.webmanifest');
  if (!fs.existsSync(manifestPath)) throw new Error(`web bundle missing manifest.webmanifest: ${dir}`);
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.id !== '/' || manifest.name !== 'Prospect' || manifest.display !== 'standalone') {
      throw new Error(`invalid manifest contents in ${manifestPath}`);
    }
  } catch (err) {
    throw new Error(`web bundle manifest invalid: ${err.message}`);
  }

  const swPath = path.join(dir, 'sw.js');
  if (!fs.existsSync(swPath) || !fs.statSync(swPath).isFile()) throw new Error(`web bundle missing sw.js: ${dir}`);
  const swContent = fs.readFileSync(swPath, 'utf8');
  if (swContent.trim().startsWith('<') || !swContent.includes('prospect-v')) {
    throw new Error(`web bundle sw.js is not valid JavaScript: ${swPath}`);
  }

  const regPath = path.join(dir, 'pwa-register.js');
  if (!fs.existsSync(regPath) || !fs.statSync(regPath).isFile()) throw new Error(`web bundle missing pwa-register.js: ${dir}`);
  const regContent = fs.readFileSync(regPath, 'utf8');
  if (regContent.trim().startsWith('<')) {
    throw new Error(`web bundle pwa-register.js is HTML instead of JS: ${regPath}`);
  }

  const offlinePath = path.join(dir, 'offline.html');
  if (!fs.existsSync(offlinePath) || !fs.statSync(offlinePath).isFile()) throw new Error(`web bundle missing offline.html: ${dir}`);

  for (const icon of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
    const iconPath = path.join(dir, icon);
    if (!fs.existsSync(iconPath) || !fs.statSync(iconPath).isFile() || fs.statSync(iconPath).size < 100) {
      throw new Error(`web bundle missing or invalid icon ${icon}: ${dir}`);
    }
  }

  return { indexPath, assetUrls: [...new Set(assetUrls)] };
}

export function promoteWebBundle({ stagedDir, currentDir = liveDir, rollbackDir = previousDir }) {
  validateWebBundle(stagedDir);
  requireDirectory(currentDir, 'current production bundle');

  if (fs.existsSync(rollbackDir)) fs.rmSync(rollbackDir, { recursive: true, force: true });
  fs.renameSync(currentDir, rollbackDir);
  try {
    fs.renameSync(stagedDir, currentDir);
  } catch (error) {
    fs.renameSync(rollbackDir, currentDir);
    throw error;
  }
  return { currentDir, rollbackDir };
}

export function rollbackWebBundle({ currentDir = liveDir, rollbackDir = previousDir } = {}) {
  requireDirectory(currentDir, 'current production bundle');
  requireDirectory(rollbackDir, 'rollback bundle');
  validateWebBundle(rollbackDir);

  const swapDir = path.join(
    path.dirname(currentDir),
    `.dist-rollback-swap-${process.pid}-${Date.now()}`,
  );
  fs.renameSync(currentDir, swapDir);
  try {
    fs.renameSync(rollbackDir, currentDir);
    fs.renameSync(swapDir, rollbackDir);
  } catch (error) {
    if (!fs.existsSync(currentDir) && fs.existsSync(swapDir)) fs.renameSync(swapDir, currentDir);
    throw error;
  }
  return { currentDir, rollbackDir };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}`);
  }
}

async function verifyLiveBundle(dir) {
  const { assetUrls } = validateWebBundle(dir);
  const response = await fetch('http://127.0.0.1:8787/');
  if (!response.ok) throw new Error(`production root returned HTTP ${response.status}`);
  const html = await response.text();
  for (const assetUrl of assetUrls) {
    if (!html.includes(assetUrl)) {
      throw new Error(`production root is not serving the promoted asset: ${assetUrl}`);
    }
    const assetResponse = await fetch(`http://127.0.0.1:8787${assetUrl}`);
    if (!assetResponse.ok) {
      throw new Error(`promoted asset returned HTTP ${assetResponse.status}: ${assetUrl}`);
    }
  }

  const pwaRoutes = [
    { path: '/manifest.webmanifest', isJs: false },
    { path: '/sw.js', isJs: true },
    { path: '/pwa-register.js', isJs: true },
    { path: '/scout-push.js', isJs: true },
    { path: '/offline.html', isJs: false },
    { path: '/icon-192.png', isJs: false },
    { path: '/icon-512.png', isJs: false },
    { path: '/apple-touch-icon.png', isJs: false },
  ];

  for (const route of pwaRoutes) {
    const res = await fetch(`http://127.0.0.1:8787${route.path}`);
    if (!res.ok) throw new Error(`live PWA asset ${route.path} returned HTTP ${res.status}`);
    const text = await res.text();
    if (route.isJs && text.trim().startsWith('<')) {
      throw new Error(`live PWA asset ${route.path} returned HTML instead of JavaScript`);
    }
  }
}

async function deploy() {
  const stagedDir = fs.mkdtempSync(path.join(appDir, '.dist-stage-'));
  let promoted = false;
  try {
    console.log(`Building staged web release: ${stagedDir}`);
    run('npm', [
      'run',
      'build',
      '--workspace=app',
      '--',
      '--outDir',
      stagedDir,
      '--emptyOutDir',
    ]);
    validateWebBundle(stagedDir);
    run('node', ['--test', 'test/build-freshness.test.mjs'], {
      env: { PROSPECT_DIST_DIR: stagedDir },
    });

    promoteWebBundle({ stagedDir });
    promoted = true;
    console.log(`Promoted staged release; rollback retained at ${previousDir}`);

    try {
      run('npm', ['test']);
      await verifyLiveBundle(liveDir);
    } catch (error) {
      console.error(`Post-deploy verification failed: ${error.message}`);
      console.error('Restoring the previous production bundle.');
      rollbackWebBundle();
      await verifyLiveBundle(liveDir);
      throw error;
    }

    console.log('Web release deployed and verified.');
  } finally {
    if (!promoted && fs.existsSync(stagedDir)) {
      fs.rmSync(stagedDir, { recursive: true, force: true });
    }
  }
}

async function main() {
  const command = process.argv[2];
  if (command === 'deploy') {
    await deploy();
    return;
  }
  if (command === 'rollback') {
    rollbackWebBundle();
    await verifyLiveBundle(liveDir);
    console.log(`Rollback complete; displaced release retained at ${previousDir}`);
    return;
  }
  throw new Error('Usage: node scripts/web-release.mjs <deploy|rollback>');
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
