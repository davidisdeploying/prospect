// H19 — running-service freshness guard.
//
// H18 proves app/dist is current with frontend source. This file closes the other half of the
// same failure mode: server source can change while prospect.service keeps serving the old code
// already loaded in memory. If the live check fails, deploy by restarting the USER unit:
//   systemctl --user restart prospect.service

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const serviceName = process.env.PROSPECT_SERVICE_NAME || 'prospect.service';
const serverDir = process.env.PROSPECT_SERVER_SOURCE_DIR || path.join(repoRoot, 'server');

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

function parseSystemdShow(output) {
  return Object.fromEntries(
    String(output).trim().split('\n').filter(Boolean).map((line) => {
      const index = line.indexOf('=');
      return index === -1 ? [line, ''] : [line.slice(0, index), line.slice(index + 1)];
    }),
  );
}

function readServiceState() {
  const output = execFileSync('systemctl', [
    '--user', 'show', serviceName,
    '-p', 'MainPID',
    '-p', 'ExecMainStartTimestamp',
    '-p', 'FragmentPath',
  ], { encoding: 'utf8' });
  const values = parseSystemdShow(output);
  const pid = Number(values.MainPID);
  const startedMs = Date.parse(values.ExecMainStartTimestamp);

  assert.ok(Number.isInteger(pid) && pid > 0, `${serviceName} has no running MainPID`);
  assert.ok(Number.isFinite(startedMs), `could not parse ${serviceName} ExecMainStartTimestamp`);
  assert.ok(fs.existsSync(`/proc/${pid}`), `${serviceName} MainPID ${pid} is not present in /proc`);

  return { pid, startedMs, fragmentPath: values.FragmentPath || null };
}

function newestInput(sourceDir, extraFiles = []) {
  const files = [
    ...walk(sourceDir).filter((file) => /\.(?:js|mjs|json)$/.test(file)),
    ...extraFiles.filter((file) => file && fs.existsSync(file)),
  ];
  let newest = null;
  for (const file of files) {
    const mtimeMs = fs.statSync(file).mtimeMs;
    if (!newest || mtimeMs > newest.mtimeMs) newest = { file, mtimeMs };
  }
  return newest;
}

// Returns null when the process started after every server input, or a precise failure otherwise.
function processFreshnessFailure(sourceDir, startedMs, extraFiles = []) {
  const newest = newestInput(sourceDir, extraFiles);
  if (!newest) return `found no service inputs under ${sourceDir}`;
  if (startedMs >= newest.mtimeMs) return null;
  return [
    'Running Prospect service is STALE.',
    `  process started: ${new Date(startedMs).toISOString()}`,
    `  newer input:     ${path.relative(repoRoot, newest.file)} (${new Date(newest.mtimeMs).toISOString()})`,
    '  The process loaded server code before that file changed. Fix: systemctl --user restart prospect.service',
  ].join('\n');
}

test('service-process-freshness: running prospect.service is current with server inputs', () => {
  const state = readServiceState();
  const extraFiles = [
    path.join(repoRoot, 'package.json'),
    path.join(repoRoot, 'package-lock.json'),
    state.fragmentPath,
  ];
  assert.equal(processFreshnessFailure(serverDir, state.startedMs, extraFiles), null);
});

// Negative controls: prove the comparison rejects a stale process and accepts a current one.
function makeInputFixture(mtimeMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-service-freshness-'));
  const file = path.join(dir, 'index.js');
  fs.writeFileSync(file, 'export const fixture = true;\n');
  fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
  return dir;
}

test('service-process-freshness negative control: an older process IS rejected', () => {
  const sourceDir = makeInputFixture(Date.now());
  try {
    const failure = processFreshnessFailure(sourceDir, Date.now() - 60_000);
    assert.ok(failure, 'a process older than its source must be reported stale');
    assert.match(failure, /service is STALE/);
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('service-process-freshness control: a process newer than its source passes', () => {
  const sourceDir = makeInputFixture(Date.now() - 60_000);
  try {
    assert.equal(processFreshnessFailure(sourceDir, Date.now()), null);
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});
