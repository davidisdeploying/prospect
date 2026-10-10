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

function loadClaimApplyLinks() {
  const bundlePath = path.join(__dirname, '.claim-detail-apply-links-bundle.cjs');
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
  const { ClaimApplyLinks } = require(bundlePath);
  return { ClaimApplyLinks, bundlePath };
}

function renderLinks(ClaimApplyLinks, listing) {
  return renderToStaticMarkup(React.createElement(ClaimApplyLinks, { listing }));
}

test('application links: Easy Apply opens the captured source listing', () => {
  const { ClaimApplyLinks, bundlePath } = loadClaimApplyLinks();
  try {
    const html = renderLinks(ClaimApplyLinks, {
      easy_apply: 1,
      source_url: 'https://www.linkedin.com/jobs/view/123',
    });
    assert.match(html, />Easy Apply /);
    assert.match(html, /href="https:\/\/www\.linkedin\.com\/jobs\/view\/123"/);
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noreferrer noopener"/);
    assert.doesNotMatch(html, /Apply on employer website/);
  } finally {
    fs.rmSync(bundlePath, { force: true });
  }
});

test('application links: employer application URL renders independently', () => {
  const { ClaimApplyLinks, bundlePath } = loadClaimApplyLinks();
  try {
    const html = renderLinks(ClaimApplyLinks, {
      easy_apply: 0,
      apply_url: 'https://jobs.example.com/apply/456',
    });
    assert.match(html, />Apply on employer website /);
    assert.match(html, /href="https:\/\/jobs\.example\.com\/apply\/456"/);
    assert.doesNotMatch(html, />Easy Apply /);
  } finally {
    fs.rmSync(bundlePath, { force: true });
  }
});

test('application links: both destinations render when both were captured', () => {
  const { ClaimApplyLinks, bundlePath } = loadClaimApplyLinks();
  try {
    const html = renderLinks(ClaimApplyLinks, {
      easy_apply: true,
      source_url: 'https://www.linkedin.com/jobs/view/789',
      apply_url: 'https://careers.example.com/jobs/789',
    });
    assert.match(html, />Easy Apply /);
    assert.match(html, />Apply on employer website /);
  } finally {
    fs.rmSync(bundlePath, { force: true });
  }
});

test('application links: absent or unsafe URLs never become links', () => {
  const { ClaimApplyLinks, bundlePath } = loadClaimApplyLinks();
  try {
    assert.equal(renderLinks(ClaimApplyLinks, {}), '');
    assert.equal(renderLinks(ClaimApplyLinks, {
      easy_apply: true,
      source_url: 'javascript:alert(1)',
      apply_url: 'not a URL',
    }), '');
  } finally {
    fs.rmSync(bundlePath, { force: true });
  }
});
