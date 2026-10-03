// Regression guard for the M2 native-<dialog> Dialog migration: confirms
// the motion refactor did not weaken TailingsDialog's fail-closed Confirm
// gate (app/src/TailingsDialog.jsx: disabled={!outcome_reason || submitting}).
//
// No jsdom in this repo, and jsdom doesn't implement HTMLDialogElement
// .showModal()/.close() anyway — so this renders with react-dom/server
// (effects, where Dialog calls showModal(), never run during SSR) and
// asserts on the static markup rather than driving a real DOM/modal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

function confirmButtonIsDisabled(html) {
  const match = html.match(/<button[^>]*>Confirm<\/button>/);
  assert.ok(match, `expected a "Confirm" button in rendered markup, got: ${html}`);
  return /\sdisabled(=|\/|>)/.test(match[0]);
}

test('TailingsDialog Confirm stays fail-closed without an outcome_reason', () => {
  const bundlePath = path.join(__dirname, '.tailings-dialog-bundle.cjs');
  const result = esbuild.buildSync({
    entryPoints: [path.join(repoRoot, 'app/src/TailingsDialog.jsx')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    alias: { '@ds': path.join(repoRoot, 'design-system') },
    logLevel: 'silent',
  });

  fs.writeFileSync(bundlePath, result.outputFiles[0].text);
  try {
    delete require.cache[require.resolve(bundlePath)];
    const { TailingsDialog } = require(bundlePath);

    const noReasonHtml = renderToStaticMarkup(
      React.createElement(TailingsDialog, {
        open: true, onClose: () => {}, onConfirm: () => {}, initialReason: '', ghostOrigin: false,
      })
    );
    assert.equal(confirmButtonIsDisabled(noReasonHtml), true, 'Confirm must be disabled with no outcome_reason selected');

    const withReasonHtml = renderToStaticMarkup(
      React.createElement(TailingsDialog, {
        open: true, onClose: () => {}, onConfirm: () => {}, initialReason: 'rejected', ghostOrigin: false,
      })
    );
    assert.equal(confirmButtonIsDisabled(withReasonHtml), false, 'Confirm must be enabled once an outcome_reason is selected');
  } finally {
    fs.rmSync(bundlePath, { force: true });
  }
});
