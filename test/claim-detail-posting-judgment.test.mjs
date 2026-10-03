// Regression guard for the posting-judgment panel (§6.7.1): the latest listing_advisories row
// (server/advise.js) is empty on every live row today (PROSPECT_ADVISOR is off), so the panel
// must render nothing when it's absent, must render its content when present (no collapse-toggle
// state, unlike AiParsePanel — this is a top-level section, same posture as Contacts/Touchpoints),
// and must never crash on the unvalidated free-text fields the worker writes.
//
// Same SSR-via-react-dom/server esbuild approach as claim-detail-ai-parse.test.mjs -- no jsdom in
// this repo; the panel has no internal state, so static SSR markup already reflects the real render.
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

function loadPostingJudgmentPanel() {
  const bundlePath = path.join(__dirname, '.claim-detail-posting-judgment-bundle.cjs');
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
  const { PostingJudgmentPanel } = require(bundlePath);
  return { PostingJudgmentPanel, bundlePath };
}

function renderPanel(PostingJudgmentPanel, advisoryJsonOrRaw) {
  const advisory = {
    id: 1, listing_id: 1,
    desc_hash: 'abc123', model: 'gpt-oss:20b', generated_at: '2026-07-27T00:00:00.000Z',
    advisory: typeof advisoryJsonOrRaw === 'string' ? advisoryJsonOrRaw : JSON.stringify(advisoryJsonOrRaw),
  };
  return renderToStaticMarkup(React.createElement(PostingJudgmentPanel, { advisory }));
}

test('Posting judgment panel: absent when advisory.advisory is malformed JSON', () => {
  const { PostingJudgmentPanel, bundlePath } = loadPostingJudgmentPanel();
  try {
    const html = renderPanel(PostingJudgmentPanel, 'not-json{');
    assert.equal(html, '');
  } finally {
    fs.rmSync(bundlePath, { force: true });
  }
});

test('Posting judgment panel: absent when every field is null/empty (a real but content-free generation)', () => {
  const { PostingJudgmentPanel, bundlePath } = loadPostingJudgmentPanel();
  try {
    const html = renderPanel(PostingJudgmentPanel, {
      comp_assessment: null, seniority_assessment: null, repost_assessment: null, questions: [],
    });
    assert.equal(html, '');
  } finally {
    fs.rmSync(bundlePath, { force: true });
  }
});

test('Posting judgment panel: renders content directly, no collapse-toggle (unlike AI Parse)', () => {
  const { PostingJudgmentPanel, bundlePath } = loadPostingJudgmentPanel();
  try {
    const html = renderPanel(PostingJudgmentPanel, {
      comp_assessment: 'Range spans $60k-$140k with no level tied to either end.',
      seniority_assessment: 'Titled "Senior" but duties describe entry-level ticket triage only.',
      repost_assessment: 'No named end client; generic "growing company" phrasing throughout.',
      questions: ['Who is the actual end client?', 'What level does the low end of the range map to?'],
    });
    assert.match(html, /Posting judgment/);
    assert.match(html, /Range spans \$60k-\$140k/, 'comp_assessment renders unconditionally, no collapsed state to expand');
    assert.match(html, /Titled &quot;Senior&quot;/, 'seniority_assessment renders (React-escaped quotes)');
    assert.match(html, /No named end client/);
    assert.match(html, /Who is the actual end client\?/);
    assert.match(html, /AI-generated/);
    assert.match(html, /gpt-oss:20b/);
  } finally {
    fs.rmSync(bundlePath, { force: true });
  }
});

test('Posting judgment panel: partial content (only questions) still renders, other fields omitted', () => {
  const { PostingJudgmentPanel, bundlePath } = loadPostingJudgmentPanel();
  try {
    const html = renderPanel(PostingJudgmentPanel, {
      comp_assessment: null, seniority_assessment: null, repost_assessment: null,
      questions: ['Is this role fully remote or hybrid?'],
    });
    assert.match(html, /Posting judgment/);
    assert.match(html, /Questions worth asking/);
    assert.match(html, /Is this role fully remote or hybrid\?/);
    assert.doesNotMatch(html, /Comp language/);
    assert.doesNotMatch(html, /Seniority vs\. duties/);
    assert.doesNotMatch(html, /Repost \/ agency tells/);
  } finally {
    fs.rmSync(bundlePath, { force: true });
  }
});

test('Posting judgment panel: never uses dangerouslySetInnerHTML and never crashes on unvalidated field types', () => {
  const { PostingJudgmentPanel, bundlePath } = loadPostingJudgmentPanel();
  try {
    // advise.js's own normalizer already guards these, but the panel must still degrade
    // safely against a hand-edited or pre-normalizer-era db row.
    assert.doesNotThrow(() => renderPanel(PostingJudgmentPanel, {
      comp_assessment: 12345,
      seniority_assessment: { not: 'a string' },
      repost_assessment: ['not', 'a', 'string'],
      questions: 'not-an-array',
    }));
    assert.doesNotThrow(() => renderPanel(PostingJudgmentPanel, []));
    assert.doesNotThrow(() => renderPanel(PostingJudgmentPanel, 'a bare string, not an object'));
    assert.doesNotThrow(() => renderPanel(PostingJudgmentPanel, null));
  } finally {
    fs.rmSync(bundlePath, { force: true });
  }
});
