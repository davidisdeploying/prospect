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

function loadPanel() {
  const bundlePath = path.join(__dirname, '.claim-detail-salary-guidance-bundle.cjs');
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
  return { SalaryGuidancePanel: require(bundlePath).SalaryGuidancePanel, bundlePath };
}

test('Claim Detail renders a copy-ready DFW salary recommendation with evidence', () => {
  const { SalaryGuidancePanel, bundlePath } = loadPanel();
  try {
    const html = renderToStaticMarkup(React.createElement(SalaryGuidancePanel, { guidance: {
      status: 'ready', data_period: 'May 2025', suggested_min: 103000, suggested_max: 120000,
      answer_min: 110000, answer_max: 120000,
      market_suggested_min: 103000, market_suggested_max: 130000,
      employer_range_min: 80000, employer_range_max: 120000,
      annual_p25: 80990, annual_median: 103260, annual_p75: 130470,
      response_text: "My target base salary is $110,000–$120,000, depending on the role's scope and total compensation.",
      occupation_title: 'Network and Computer Systems Administrators', occupation_code: '15-1244',
      employment: 11740, range_basis: 'median to 75th percentile',
      source_url: 'https://data.bls.gov/oes/#/area/0019100/2025',
    } }));
    assert.match(html, /Suggested salary answer/);
    assert.match(html, /\$110,000–\$120,000/);
    assert.match(html, /My target base salary is/);
    assert.doesNotMatch(html, /within the employer/i);
    assert.match(html, /Network and Computer Systems Administrators/);
    assert.match(html, /11,740 DFW jobs/);
    assert.match(html, /Employer posted range:.*80,000–.*120,000/);
    assert.match(html, /DFW market anchor:.*103,000–.*130,000/);
    assert.match(html, /View BLS source/);
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noreferrer noopener"/);
  } finally {
    fs.rmSync(bundlePath, { force: true });
  }
});

test('Claim Detail shows an honest unavailable state for unmatched titles', () => {
  const { SalaryGuidancePanel, bundlePath } = loadPanel();
  try {
    const html = renderToStaticMarkup(React.createElement(SalaryGuidancePanel, { guidance: {
      status: 'unavailable', data_period: 'May 2025',
      unavailable_reason: 'No reliable BLS occupation match for this title.',
    } }));
    assert.match(html, /No reliable occupation match yet/);
    assert.match(html, /No reliable BLS occupation match for this title/);
    assert.doesNotMatch(html, /Suggested salary answer/);
  } finally {
    fs.rmSync(bundlePath, { force: true });
  }
});
