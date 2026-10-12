import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  promoteWebBundle,
  rollbackWebBundle,
  validateWebBundle,
} from '../scripts/web-release.mjs';

function writeBundle(dir, marker) {
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    `<link rel="stylesheet" href="/assets/index-${marker}.css">`
      + `<script type="module" src="/assets/index-${marker}.js"></script>`,
  );
  fs.writeFileSync(path.join(dir, `assets/index-${marker}.css`), `/* ${marker} */`);
  fs.writeFileSync(path.join(dir, `assets/index-${marker}.js`), `window.release="${marker}"`);
  fs.writeFileSync(
    path.join(dir, 'manifest.webmanifest'),
    JSON.stringify({ id: '/', name: 'Prospect', display: 'standalone' }),
  );
  fs.writeFileSync(path.join(dir, 'sw.js'), '/* prospect-v1 */');
  fs.writeFileSync(path.join(dir, 'pwa-register.js'), '/* pwa-register */');
  fs.writeFileSync(path.join(dir, 'offline.html'), '<h1>Offline</h1>');
  const dummyIcon = Buffer.alloc(200);
  fs.writeFileSync(path.join(dir, 'icon-192.png'), dummyIcon);
  fs.writeFileSync(path.join(dir, 'icon-512.png'), dummyIcon);
  fs.writeFileSync(path.join(dir, 'apple-touch-icon.png'), dummyIcon);
}

function readMarker(dir) {
  return fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
}

test('validateWebBundle rejects a dangling production asset', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-web-release-'));
  try {
    writeBundle(root, 'broken');
    fs.rmSync(path.join(root, 'assets/index-broken.js'));
    assert.throws(() => validateWebBundle(root), /missing asset/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('promoteWebBundle atomically retains the prior production release', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-web-release-'));
  const currentDir = path.join(root, 'dist');
  const stagedDir = path.join(root, 'stage');
  const rollbackDir = path.join(root, 'dist.previous');
  try {
    writeBundle(currentDir, 'current');
    writeBundle(stagedDir, 'staged');
    promoteWebBundle({ stagedDir, currentDir, rollbackDir });
    assert.match(readMarker(currentDir), /staged/);
    assert.match(readMarker(rollbackDir), /current/);
    assert.equal(fs.existsSync(stagedDir), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rollbackWebBundle swaps the verified releases without discarding either one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-web-release-'));
  const currentDir = path.join(root, 'dist');
  const rollbackDir = path.join(root, 'dist.previous');
  try {
    writeBundle(currentDir, 'new');
    writeBundle(rollbackDir, 'old');
    rollbackWebBundle({ currentDir, rollbackDir });
    assert.match(readMarker(currentDir), /old/);
    assert.match(readMarker(rollbackDir), /new/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
