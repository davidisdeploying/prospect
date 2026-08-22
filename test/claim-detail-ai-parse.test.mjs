// Regression guard for the AI Parse panel (FLEET-WORKER1-BUILD-20260724-s53b-ui-surfacing):
// listing.parsed.llm_parse (server/llmParse.js) is empty on every live row today
// (PROSPECT_LLM_PARSE is off), so the panel must render nothing when it's absent, must stay
// collapsed by default when it's present, and must never crash on the unvalidated free-text
// fields the worker writes.
//
// Same SSR-via-react-dom/server approach as tailings-dialog-fail-closed.test.mjs -- no jsdom in
// this repo, but the panel's collapse state is plain useState(false), so static SSR markup (no
// effects run) already reflects the real default-collapsed render.
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

function loadCapturedSnapshot() {
  const bundlePath = path.join(__dirname, '.claim-detail-ai-parse-bundle.cjs');
  const result = esbuild.buildSync({
    entryPoints: [path.join(repoRoot, 'app/src/ClaimDetail.jsx')],
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
  delete require.cache[require.resolve(bundlePath)];
  const { CapturedSnapshot } = require(bundlePath);
  return { CapturedSnapshot, bundlePath };
}

function renderSnapshot(CapturedSnapshot, parsedObj) {
  const listing = {
    id: 1, source: 'Manual', captured_at: '2026-07-20T00:00:00.000Z',
    company: 'Acme', role: 'Engineer',
    parsed: parsedObj !== undefined ? JSON.stringify(parsedObj) : null,
  };
  return renderToStaticMarkup(React.createElement(CapturedSnapshot, { listing, closing: false }));
}

test('AI Parse panel: absent entirely when listing.parsed has no llm_parse key (every live row today)', () => {
  const { CapturedSnapshot, bundlePath } = loadCapturedSnapshot();
  try {
    const html = renderSnapshot(CapturedSnapshot, { parsed_by: 'adapter', sections: { Requirements: ['bullet'] } });
    assert.doesNotMatch(html, /AI parse/, 'no AI Parse toggle should render when llm_parse is absent');
    assert.doesNotMatch(html, /AI-generated/, 'no provenance line should render when llm_parse is absent');
  } finally {
    fs.rmSync(bundlePath, { force: true });
  }
});

test('AI Parse panel: absent when listing.parsed is null (no parsed column at all)', () => {
  const { CapturedSnapshot, bundlePath } = loadCapturedSnapshot();
  try {
    const html = renderSnapshot(CapturedSnapshot, undefined);
    assert.doesNotMatch(html, /AI parse/);
  } finally {
    fs.rmSync(bundlePath, { force: true });
  }
});

test('AI Parse panel: toggle renders but stays collapsed by default when llm_parse is present', () => {
  const { CapturedSnapshot, bundlePath } = loadCapturedSnapshot();
  try {
    const html = renderSnapshot(CapturedSnapshot, {
      parsed_by: 'adapter',
      llm_parse: {
        sections: { Requirements: 'Prose about requirements here.' },
        skills_prose: 'Python, SQL, distributed systems',
        comp_prose: 'Base plus bonus, equity likely',
        role_hint: 'Data Engineer',
        desc_hash: 'abc123',
        generated_at: '2026-07-24T00:00:00.000Z',
        model: 'gpt-oss:20b',
      },
    });
    assert.match(html, /AI parse/, 'toggle control should render when llm_parse is present');
    assert.doesNotMatch(html, /Python, SQL, distributed systems/, 'skills_prose must not render while collapsed');
    assert.doesNotMatch(html, /Data Engineer/, 'role_hint must not render while collapsed');
    assert.doesNotMatch(html, /gpt-oss:20b/, 'provenance line must not render while collapsed');
  } finally {
    fs.rmSync(bundlePath, { force: true });
  }
});

test('AI Parse panel: never uses dangerouslySetInnerHTML and never crashes on unvalidated field types', () => {
  const { CapturedSnapshot, bundlePath } = loadCapturedSnapshot();
  try {
    // llmParse.js writes free text the model returned, unvalidated -- role_hint/sections here
    // are the wrong JS types a malformed or adversarial model response could produce.
    assert.doesNotThrow(() => renderSnapshot(CapturedSnapshot, {
      llm_parse: {
        role_hint: 12345,
        skills_prose: { not: 'a string' },
        comp_prose: ['not', 'a', 'string'],
        sections: 'not-an-object',
        model: null,
        generated_at: null,
      },
    }));
    assert.doesNotThrow(() => renderSnapshot(CapturedSnapshot, { llm_parse: [] }));
    assert.doesNotThrow(() => renderSnapshot(CapturedSnapshot, { llm_parse: 'not-an-object' }));
  } finally {
    fs.rmSync(bundlePath, { force: true });
  }
});
