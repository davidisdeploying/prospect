// server/strikeSheet.js — §6.1 Strike Sheet: the offer comparator, with corpus percentiles.
// All-SELECT. Reads claim_offers (migration 019) and compares each offer against the comp corpus
// Prospect has actually captured.
//
// THE COMPARISON THIS FILE REFUSES TO FUDGE. The corpus is what employers ADVERTISED in postings
// (listings.annual_comp_mid, only where comp_disclosed = 1). An offer is what one employer actually
// put on the table. Those are different populations, and a percentile computed across them is a
// useful bearing, not a market rate. Every consumer of this module gets `basis` saying so, and the
// rendered page prints it — because "your offer is at the 78th percentile" is exactly the kind of
// number that gets repeated later with the caveat quietly dropped.
//
// Below COMP_PERCENTILE_MIN_N disclosed listings there is no percentile at all, rather than a
// percentile computed from three numbers and rounded confidently.

import { percentile, percentileRank, COMP_PERCENTILE_MIN_N } from './analytics.js';
import { renderPwaHeadTags } from './pwaHead.js';
import { renderSidebarNav, renderTopBar, renderTabBar, SHELL_STYLE } from './shell.js';

export const OFFER_SOURCES = Object.freeze(['employer', 'estimate']);

// An offer's total is the sum of the components that are present. A component that is null is
// UNKNOWN, not zero: an offer with no equity figure recorded is not an offer with no equity, and
// `components_known` carries which ones were actually stated so a partial total is never presented
// as a complete one.
export function offerTotal(offer) {
  const parts = [offer.base_annual, offer.bonus_annual, offer.equity_annual, offer.other_annual];
  const known = parts.filter((value) => value != null && Number.isFinite(Number(value)));
  if (known.length === 0) return { total: null, components_known: 0, complete: false };
  return {
    total: known.reduce((sum, value) => sum + Number(value), 0),
    components_known: known.length,
    complete: parts.every((value) => value != null),
  };
}

function corpusFor(rows) {
  const values = rows.map((row) => row.annual_comp_mid).filter((v) => v != null).sort((a, b) => a - b);
  if (values.length < COMP_PERCENTILE_MIN_N) {
    return { sufficient: false, n: values.length, min_n: COMP_PERCENTILE_MIN_N };
  }
  return {
    sufficient: true,
    n: values.length,
    min: values[0],
    p25: percentile(values, 25),
    median: percentile(values, 50),
    p75: percentile(values, 75),
    max: values[values.length - 1],
    values,
  };
}

// computeStrikeSheet(db) -> {available, basis, corpus, by_job_family, offers, comparison}
// Degrades to an explicitly unavailable sheet on a pre-019 database rather than throwing, matching
// jobFamilyReport.js's feature-detect posture so the surrounding page always renders.
export function computeStrikeSheet(db) {
  const basis = 'Percentiles are measured against advertised pay in captured postings, not against '
    + 'salaries actually paid. It is a bearing, not a market rate.';

  let offerRows;
  try {
    offerRows = db.prepare(`
      SELECT o.*, c.stage, l.company, l.role, l.job_family, l.annual_comp_mid AS advertised_mid
      FROM claim_offers o
      JOIN claims c ON c.id = o.claim_id
      LEFT JOIN listings l ON l.id = c.listing_id
      ORDER BY o.claim_id ASC, o.recorded_at ASC, o.id ASC
    `).all();
  } catch {
    return { available: false, basis, corpus: { sufficient: false, n: 0, min_n: COMP_PERCENTILE_MIN_N }, by_job_family: [], offers: [], comparison: [] };
  }

  const corpusRows = db.prepare(`
    SELECT annual_comp_mid, job_family FROM listings
    WHERE comp_disclosed = 1 AND annual_comp_mid IS NOT NULL
  `).all();
  const corpus = corpusFor(corpusRows);

  const familyBuckets = new Map();
  for (const row of corpusRows) {
    const key = row.job_family || 'uncategorized';
    if (!familyBuckets.has(key)) familyBuckets.set(key, []);
    familyBuckets.get(key).push(row);
  }
  const byJobFamily = [...familyBuckets.entries()]
    .map(([job_family, rows]) => ({ job_family, ...corpusFor(rows) }))
    .sort((a, b) => b.n - a.n);

  // Every generation is kept and returned, so a negotiation is visible as a sequence rather than
  // collapsed to its last value.
  const byClaim = new Map();
  for (const row of offerRows) {
    if (!byClaim.has(row.claim_id)) byClaim.set(row.claim_id, []);
    byClaim.get(row.claim_id).push(row);
  }

  const offers = [];
  for (const [claimId, generations] of byClaim) {
    const enriched = generations.map((row) => {
      const totals = offerTotal(row);
      return {
        offer_id: row.id,
        claim_id: claimId,
        source: row.source,
        recorded_at: row.recorded_at,
        currency: row.currency,
        note: row.note,
        base_annual: row.base_annual,
        bonus_annual: row.bonus_annual,
        equity_annual: row.equity_annual,
        other_annual: row.other_annual,
        ...totals,
      };
    });
    const latest = enriched[enriched.length - 1];
    const first = enriched[0];
    const familyCorpus = byJobFamily.find((f) => f.job_family === (generations[0].job_family || 'uncategorized'));

    offers.push({
      claim_id: claimId,
      company: generations[0].company,
      role: generations[0].role,
      stage: generations[0].stage,
      job_family: generations[0].job_family || 'uncategorized',
      advertised_mid: generations[0].advertised_mid,
      generations: enriched,
      latest,
      // Movement across the negotiation. Null when there is only one generation -- an unchanged
      // offer and an un-negotiated one are different things and are not reported the same way.
      negotiated_delta: enriched.length > 1 && latest.total != null && first.total != null
        ? latest.total - first.total
        : null,
      corpus_percentile: corpus.sufficient && latest.total != null
        ? percentileRank(corpus.values, latest.total)
        : null,
      job_family_percentile: familyCorpus?.sufficient && latest.total != null
        ? percentileRank(familyCorpus.values, latest.total)
        : null,
      // How the offer compares to what THIS posting advertised -- always available when both exist,
      // and unlike the percentiles it needs no corpus at all.
      vs_advertised: latest.total != null && generations[0].advertised_mid != null
        ? latest.total - generations[0].advertised_mid
        : null,
    });
  }

  offers.sort((a, b) => (b.latest.total ?? -Infinity) - (a.latest.total ?? -Infinity));

  return {
    available: true,
    basis,
    corpus: { ...corpus, values: undefined },
    by_job_family: byJobFamily.map((f) => ({ ...f, values: undefined })),
    offers,
    // The comparator proper: the side-by-side row set, only meaningful with more than one offer in
    // hand. Reported separately so the page can say "one offer, nothing to compare" honestly.
    comparison: offers.length > 1 ? offers.map((o) => ({
      claim_id: o.claim_id,
      company: o.company,
      role: o.role,
      total: o.latest.total,
      complete: o.latest.complete,
      source: o.latest.source,
      corpus_percentile: o.corpus_percentile,
      vs_advertised: o.vs_advertised,
    })) : [],
  };
}

// ---------------------------------------------------------------------------------------------
// Server-rendered, JS-free-legible HTML for GET /strike-sheet. Same house rule as /report,
// /claim-office and /pledge: every number is in the raw markup, no canvas, no client chart lib.
// ---------------------------------------------------------------------------------------------

function esc(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function money(value) {
  if (value == null) return '—';
  return `$${Math.round(Number(value)).toLocaleString('en-US')}`;
}

function signedMoney(value) {
  if (value == null) return '—';
  const rounded = Math.round(Number(value));
  return `${rounded >= 0 ? '+' : '−'}$${Math.abs(rounded).toLocaleString('en-US')}`;
}

function pct(value) {
  return value == null ? '—' : `${Math.round(Number(value))}th`;
}

const STYLE = `
${SHELL_STYLE}
  .strike-lede { font-size: 15px; line-height: 1.65; color: var(--text-body); max-width: 64ch; margin-bottom: 8px; }
  .strike-basis { font-size: 12.5px; line-height: 1.55; color: var(--text-faint); max-width: 64ch; margin: 0 0 26px; }
  .strike-section { margin: 0 0 30px; }
  .strike-section h2 { font-size: 13px; letter-spacing: .09em; text-transform: uppercase; color: var(--text-faint); margin: 0 0 10px; }
  .strike-table { width: 100%; border-collapse: collapse; }
  .strike-table th { text-align: left; font-size: 11px; letter-spacing: .07em; text-transform: uppercase; color: var(--text-faint); font-weight: 600; padding: 6px 10px 6px 0; border-bottom: 1px solid var(--line); }
  .strike-table td { font-size: 13.5px; color: var(--text-body); padding: 9px 10px 9px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
  .strike-table td.num, .strike-table th.num { text-align: right; font-family: var(--font-mono); }
  .strike-total { color: var(--text-strong); font-weight: 700; }
  .strike-flag { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: .05em; text-transform: uppercase; padding: 2px 7px; border-radius: 3px; border: 1px solid var(--line); color: var(--text-faint); white-space: nowrap; }
  .strike-flag[data-source="estimate"] { color: var(--iron-oxide); border-color: var(--iron-oxide); }
  .strike-note { font-size: 12.5px; color: var(--text-faint); line-height: 1.55; max-width: 66ch; margin: 10px 0 0; }
  .strike-empty { color: var(--text-faint); font-size: 13.5px; margin: 0; }
`;

function corpusSection(corpus) {
  if (!corpus.sufficient) {
    return `
    <section class="strike-section">
      <h2>Corpus</h2>
      <p class="strike-empty">Only ${esc(corpus.n)} captured posting${corpus.n === 1 ? '' : 's'} disclose pay —
        fewer than the ${esc(corpus.min_n)} needed before a percentile means anything. No percentile is shown
        rather than one computed from too little.</p>
    </section>`;
  }
  return `
    <section class="strike-section">
      <h2>Corpus</h2>
      <table class="strike-table">
        <thead><tr><th>Postings</th><th class="num">Low</th><th class="num">25th</th><th class="num">Median</th><th class="num">75th</th><th class="num">High</th></tr></thead>
        <tbody><tr>
          <td class="num">${esc(corpus.n)}</td>
          <td class="num">${money(corpus.min)}</td>
          <td class="num">${money(corpus.p25)}</td>
          <td class="num">${money(corpus.median)}</td>
          <td class="num">${money(corpus.p75)}</td>
          <td class="num">${money(corpus.max)}</td>
        </tr></tbody>
      </table>
    </section>`;
}

function offersSection(sheet) {
  if (sheet.offers.length === 0) {
    return `
    <section class="strike-section">
      <h2>Offers</h2>
      <p class="strike-empty">No offer recorded yet. This page fills in the first time a real number
        arrives — nothing here is simulated in the meantime.</p>
    </section>`;
  }
  const rows = sheet.offers.map((offer) => `
      <tr>
        <td>${esc(offer.company)}<br><span class="strike-flag" data-source="${esc(offer.latest.source)}">${esc(offer.latest.source)}</span></td>
        <td>${esc(offer.role)}</td>
        <td class="num">${money(offer.latest.base_annual)}</td>
        <td class="num">${money(offer.latest.bonus_annual)}</td>
        <td class="num">${money(offer.latest.equity_annual)}</td>
        <td class="num strike-total">${money(offer.latest.total)}</td>
        <td class="num">${pct(offer.corpus_percentile)}</td>
        <td class="num">${signedMoney(offer.vs_advertised)}</td>
        <td class="num">${signedMoney(offer.negotiated_delta)}</td>
      </tr>`).join('');
  const incomplete = sheet.offers.filter((o) => !o.latest.complete).length;
  return `
    <section class="strike-section">
      <h2>Offers</h2>
      <table class="strike-table">
        <thead><tr>
          <th>Company</th><th>Role</th>
          <th class="num">Base</th><th class="num">Bonus</th><th class="num">Equity</th>
          <th class="num">Total</th><th class="num">Percentile</th>
          <th class="num">vs advertised</th><th class="num">Negotiated</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${incomplete ? `<p class="strike-note">${esc(incomplete)} offer${incomplete === 1 ? ' has' : 's have'}
        at least one component not recorded. A missing component is unknown, not zero, so those totals
        are partial and read low.</p>` : ''}
      ${sheet.comparison.length === 0 && sheet.offers.length === 1
        ? '<p class="strike-note">One offer in hand — there is nothing to compare it against yet except the corpus.</p>'
        : ''}
    </section>`;
}

export function renderStrikeSheetHtml(sheet) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
${renderPwaHeadTags({ title: 'Strike Sheet — Prospect' })}
<style>${STYLE}</style>
</head>
<body>
${renderTopBar('/strike-sheet')}
<div class="report-shell">
  ${renderSidebarNav('/strike-sheet')}
  <main class="report-main">
    <span class="eyebrow">Prospect</span>
    <h1>Strike Sheet</h1>
    <p class="strike-lede">What was actually offered, component by component, against everything
      Prospect has captured about what these roles advertise.</p>
    <p class="strike-basis">${esc(sheet.basis)}</p>
    ${offersSection(sheet)}
    ${corpusSection(sheet.corpus)}
  </main>
</div>
${renderTabBar('/strike-sheet')}
</body>
</html>
`;
}
