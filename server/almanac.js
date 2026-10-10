// server/almanac.js — §6.5 The Prospector's Almanac: the end-of-hunt retrospective, and the
// multi-hunt archive that makes a second search comparable to the first.
//
// All-SELECT. Everything here is arithmetic over records Prospect already keeps -- no model, and
// nothing that needs one. The retrospective is a question of what happened, and what happened is
// written down.
//
// WHAT THIS FILE WILL NOT DO. It will not compute a rate from a handful of outcomes and present it
// as a finding. A response rate over 4 applications is noise wearing a percentage sign, and an
// almanac whose headline number is noise is worse than one that says "too few to say" -- because
// the whole point of a retrospective is to be believed later. Every derived rate carries its own n,
// and anything below MIN_RATE_N reports null with the count still visible, so the reader can see
// both that it was measured and why it is not being claimed.

import { renderPwaHeadTags } from './pwaHead.js';
import { renderSidebarNav, renderTopBar, renderTabBar, SHELL_STYLE } from './shell.js';

export const MIN_RATE_N = 5;
export const MIN_EFFORT_OUTCOME_N = 5;

const FUNNEL_ORDER = ['Showings', 'Staked', 'Working the Vein', 'Strike'];
export const HUNT_STATUSES = Object.freeze(['active', 'closed', 'paused', 'abandoned']);

function tableMissing(db, name) {
  return db.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name).n === 0;
}

function daysBetween(fromIso, toIso) {
  if (!fromIso) return null;
  const from = Date.parse(String(fromIso).replace(' ', 'T') + (String(fromIso).endsWith('Z') ? '' : 'Z'));
  const to = toIso
    ? Date.parse(String(toIso).replace(' ', 'T') + (String(toIso).endsWith('Z') ? '' : 'Z'))
    : Date.now();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.floor((to - from) / 86_400_000));
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function recordedMinutes(claims) {
  return claims
    .filter((claim) => claim.application_minutes != null && claim.application_minutes !== '')
    .map((claim) => Number(claim.application_minutes))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

// Outcome-specific effort is deliberately stricter than the pooled effort total. A thin group
// exposes its claim and recording counts, but not a timing statistic that invites a comparison.
function effortForOutcome(claims, outcome) {
  const decided = claims.filter((claim) => claim.stage === outcome);
  const minutes = recordedMinutes(decided);
  const sufficient = minutes.length >= MIN_EFFORT_OUTCOME_N;
  return {
    outcome,
    claims: decided.length,
    claims_with_time: minutes.length,
    sufficient,
    min_n: MIN_EFFORT_OUTCOME_N,
    total_minutes: sufficient ? minutes.reduce((sum, value) => sum + value, 0) : null,
    median_minutes: sufficient ? median(minutes) : null,
  };
}

// A rate is only reported when there are enough observations to mean something. `n` is always
// returned so "not enough yet" is distinguishable from "measured and it was zero".
function rate(numerator, denominator) {
  if (denominator < MIN_RATE_N) return { value: null, n: denominator, sufficient: false, min_n: MIN_RATE_N };
  return { value: (numerator / denominator) * 100, n: denominator, sufficient: true, min_n: MIN_RATE_N };
}

function summarizeHunt(db, hunt) {
  const claims = db.prepare(`
    SELECT c.id, c.stage, c.created_at, c.applied_at, c.application_minutes, c.outcome_reason,
           c.gut_prediction, l.company, l.role, l.job_family, l.annual_comp_mid, l.comp_disclosed
    FROM claims c LEFT JOIN listings l ON l.id = c.listing_id
    WHERE c.hunt_id IS ?
  `).all(hunt?.id ?? null);

  const claimIds = claims.map((c) => c.id);
  const placeholders = claimIds.map(() => '?').join(',') || 'NULL';

  const transitions = claimIds.length
    ? db.prepare(`SELECT claim_id, from_stage, to_stage, transitioned_at FROM stage_transitions WHERE claim_id IN (${placeholders}) ORDER BY transitioned_at ASC`).all(...claimIds)
    : [];

  // Deepest stage ever reached, from the append-only log rather than the current stage -- a claim
  // that reached Working the Vein and then died in Tailings did reach Working the Vein, and a retrospective that forgets
  // that undercounts the hunt's real progress.
  const deepestByClaim = new Map();
  for (const claim of claims) deepestByClaim.set(claim.id, FUNNEL_ORDER.indexOf(claim.stage));
  for (const t of transitions) {
    const idx = FUNNEL_ORDER.indexOf(t.to_stage);
    if (idx < 0) continue;
    const current = deepestByClaim.get(t.claim_id);
    if (current == null || idx > current) deepestByClaim.set(t.claim_id, idx);
  }

  const funnel = FUNNEL_ORDER.map((stage, index) => ({
    stage,
    ever_reached: [...deepestByClaim.values()].filter((depth) => depth >= index).length,
  }));

  const tailings = claims.filter((c) => c.stage === 'Tailings');
  // "Responded" means the first observable exit from Staked, regardless of destination. A
  // Tailings exit is a response but not funnel advancement; only Working the Vein and Strike
  // appear as advancement in the funnel above.
  const responded = new Set(
    transitions.filter((t) => t.from_stage === 'Staked').map((t) => t.claim_id)
  );
  const staked = claims.filter((c) => deepestByClaim.get(c.id) >= FUNNEL_ORDER.indexOf('Staked'));

  // Number(null) is 0 and Number('') is 0, both finite -- so a null must be rejected BEFORE the
  // coercion, or every claim that never recorded its time silently counts as a claim that took
  // zero minutes. Unrecorded is unknown, not free.
  const effortMinutes = recordedMinutes(claims);
  const decidedOutcomes = ['Tailings', 'Strike'];
  const censoredClaims = claims.filter((claim) => !decidedOutcomes.includes(claim.stage));

  const disclosedComp = claims
    .filter((c) => c.comp_disclosed === 1 && c.annual_comp_mid != null)
    .map((c) => c.annual_comp_mid);

  const companies = new Map();
  for (const claim of claims) {
    const key = claim.company || 'Unknown';
    companies.set(key, (companies.get(key) || 0) + 1);
  }

  const timeToFirstResponse = [];
  for (const claim of staked) {
    const first = transitions.find(
      (t) => t.claim_id === claim.id && t.from_stage === 'Staked'
    );
    if (first) {
      const days = daysBetween(claim.applied_at || claim.created_at, first.transitioned_at);
      if (days != null) timeToFirstResponse.push(days);
    }
  }

  return {
    hunt: hunt ? {
      id: hunt.id, name: hunt.name, goal: hunt.goal, status: hunt.status,
      started_at: hunt.started_at, ended_at: hunt.ended_at, outcome_note: hunt.outcome_note,
      duration_days: daysBetween(hunt.started_at, hunt.ended_at),
    } : {
      // Claims that predate hunts, or were never assigned. Named honestly rather than folded into
      // whichever hunt happens to be first.
      id: null, name: 'Unassigned', goal: null, status: null,
      started_at: null, ended_at: null, outcome_note: null, duration_days: null,
    },
    totals: {
      claims: claims.length,
      staked: staked.length,
      tailings: tailings.length,
      still_active: claims.filter((c) => c.stage !== 'Tailings').length,
      companies: companies.size,
    },
    funnel,
    rates: {
      response: rate(responded.size, staked.length),
      strike: rate(deepestByClaim.size ? [...deepestByClaim.values()].filter((d) => d >= FUNNEL_ORDER.indexOf('Strike')).length : 0, staked.length),
    },
    effort: {
      claims_with_time: effortMinutes.length,
      total_minutes: effortMinutes.reduce((sum, v) => sum + v, 0),
      median_minutes: median(effortMinutes),
    },
    effort_by_outcome: {
      min_n: MIN_EFFORT_OUTCOME_N,
      // Active claims have not produced an outcome. They remain visible as censored observations
      // and are never silently assigned to either success or failure.
      censored_claims: censoredClaims.length,
      censored_with_time: recordedMinutes(censoredClaims).length,
      outcomes: decidedOutcomes.map((outcome) => effortForOutcome(claims, outcome)),
    },
    response_time: {
      n: timeToFirstResponse.length,
      median_days: median(timeToFirstResponse),
    },
    comp: {
      n: disclosedComp.length,
      median: median(disclosedComp),
    },
    top_companies: [...companies.entries()]
      .map(([company, count]) => ({ company, claims: count }))
      .sort((a, b) => b.claims - a.claims || a.company.localeCompare(b.company))
      .slice(0, 10),
    outcome_reasons: [...tailings.reduce((map, claim) => {
      const key = claim.outcome_reason || 'unrecorded';
      return map.set(key, (map.get(key) || 0) + 1);
    }, new Map()).entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  };
}

// computeAlmanac(db) -> {available, hunts, comparison}
// Degrades to an explicitly unavailable shape on a pre-023 database rather than throwing.
export function computeAlmanac(db) {
  if (tableMissing(db, 'hunts')) {
    return { available: false, hunts: [], comparison: [] };
  }

  const huntRows = db.prepare('SELECT * FROM hunts ORDER BY started_at ASC, id ASC').all();
  const summaries = huntRows.map((hunt) => summarizeHunt(db, hunt));

  // Claims with no hunt are only reported when some actually exist -- an empty "Unassigned" section
  // on every almanac would be noise.
  const unassignedCount = db.prepare('SELECT COUNT(*) FROM claims WHERE hunt_id IS NULL').pluck().get();
  if (unassignedCount > 0) summaries.push(summarizeHunt(db, null));

  return {
    available: true,
    hunts: summaries,
    // Cross-hunt comparison only means anything with more than one hunt to compare.
    comparison: summaries.length > 1 ? summaries.map((s) => ({
      hunt: s.hunt.name,
      claims: s.totals.claims,
      staked: s.totals.staked,
      response_rate: s.rates.response.value,
      response_rate_n: s.rates.response.n,
      median_response_days: s.response_time.median_days,
      total_minutes: s.effort.total_minutes,
      duration_days: s.hunt.duration_days,
    })) : [],
  };
}

// ---------------------------------------------------------------------------------------------
// Server-rendered, JS-free-legible HTML for GET /almanac. Same house rule as every other read-only
// page here: every number is in the raw markup.
// ---------------------------------------------------------------------------------------------

function esc(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function money(value) {
  return value == null ? '&mdash;' : `$${Math.round(Number(value)).toLocaleString('en-US')}`;
}

// A rate renders as "too few to say (n=3)" rather than as a number, so a thin sample is legible as
// a thin sample instead of as a confident finding.
function rateCell(r) {
  if (!r.sufficient) return `<span class="almanac-thin">too few to say (n=${esc(r.n)})</span>`;
  return `${Math.round(r.value)}% <span class="almanac-thin">(n=${esc(r.n)})</span>`;
}

function outcomeEffortCell(outcome) {
  if (!outcome.sufficient) {
    return `<span class="almanac-thin">too few to compare (n=${esc(outcome.claims_with_time)}; need ${esc(outcome.min_n)})</span>`;
  }
  return `${esc(outcome.median_minutes)} min <span class="almanac-thin">(n=${esc(outcome.claims_with_time)})</span>`;
}

const STYLE = `
${SHELL_STYLE}
  .almanac-lede { font-size: 15px; line-height: 1.65; color: var(--text-body); max-width: 64ch; margin-bottom: 26px; }
  .almanac-hunt { margin: 0 0 34px; padding-bottom: 26px; border-bottom: 1px solid var(--line); }
  .almanac-hunt:last-child { border-bottom: none; }
  .almanac-hunt h2 { font-size: 17px; color: var(--text-strong); margin: 0 0 2px; }
  .almanac-meta { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--text-faint); margin: 0 0 14px; }
  .almanac-goal { font-size: 13.5px; color: var(--text-body); margin: 0 0 14px; max-width: 62ch; }
  .almanac-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; margin-bottom: 18px; }
  .almanac-stat-value { font-family: var(--font-mono); font-size: 22px; font-weight: 700; color: var(--text-strong); }
  .almanac-stat-label { font-size: 12px; color: var(--text-faint); margin-top: 2px; }
  .almanac-table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  .almanac-table th { text-align: left; font-size: 11px; letter-spacing: .07em; text-transform: uppercase; color: var(--text-faint); font-weight: 600; padding: 6px 10px 6px 0; border-bottom: 1px solid var(--line); }
  .almanac-table td { font-size: 13.5px; color: var(--text-body); padding: 8px 10px 8px 0; border-bottom: 1px solid var(--line); }
  .almanac-table td.num, .almanac-table th.num { text-align: right; font-family: var(--font-mono); }
  .almanac-sub { font-size: 12px; letter-spacing: .07em; text-transform: uppercase; color: var(--text-faint); margin: 20px 0 4px; font-weight: 600; }
  .almanac-thin { color: var(--text-faint); font-family: var(--font-mono); font-size: 11px; }
  .almanac-empty { color: var(--text-faint); font-size: 13.5px; }
`;

function huntSection(summary) {
  const h = summary.hunt;
  const duration = h.duration_days == null
    ? (h.started_at ? 'running' : 'no dates recorded')
    : `${h.duration_days} days`;
  const funnelRows = summary.funnel.map((f) => `
      <tr><td>${esc(f.stage)}</td><td class="num">${esc(f.ever_reached)}</td></tr>`).join('');
  const companyRows = summary.top_companies.length
    ? summary.top_companies.map((c) => `
      <tr><td>${esc(c.company)}</td><td class="num">${esc(c.claims)}</td></tr>`).join('')
    : '<tr><td colspan="2" class="almanac-empty">No companies yet.</td></tr>';
  const reasonRows = summary.outcome_reasons.length
    ? summary.outcome_reasons.map((r) => `
      <tr><td>${esc(r.reason)}</td><td class="num">${esc(r.count)}</td></tr>`).join('')
    : '<tr><td colspan="2" class="almanac-empty">Nothing has reached Tailings yet.</td></tr>';
  const effortOutcomeRows = summary.effort_by_outcome.outcomes.map((outcome) => `
      <tr>
        <td>${esc(outcome.outcome)}</td>
        <td class="num">${esc(outcome.claims)}</td>
        <td class="num">${esc(outcome.claims_with_time)}</td>
        <td class="num">${outcomeEffortCell(outcome)}</td>
      </tr>`).join('');

  return `
  <section class="almanac-hunt">
    <h2>${esc(h.name)}</h2>
    <p class="almanac-meta">${esc(h.status || 'unassigned')} &middot; ${esc(duration)}${h.started_at ? ` &middot; from ${esc(String(h.started_at).slice(0, 10))}` : ''}</p>
    ${h.goal ? `<p class="almanac-goal">${esc(h.goal)}</p>` : ''}
    ${h.outcome_note ? `<p class="almanac-goal">${esc(h.outcome_note)}</p>` : ''}
    <div class="almanac-stats">
      <div><div class="almanac-stat-value">${esc(summary.totals.claims)}</div><div class="almanac-stat-label">Claims</div></div>
      <div><div class="almanac-stat-value">${esc(summary.totals.staked)}</div><div class="almanac-stat-label">Applications staked</div></div>
      <div><div class="almanac-stat-value">${esc(summary.totals.companies)}</div><div class="almanac-stat-label">Companies</div></div>
      <div><div class="almanac-stat-value">${Math.round(summary.effort.total_minutes / 60)}h</div><div class="almanac-stat-label">Recorded effort</div></div>
      <div><div class="almanac-stat-value">${money(summary.comp.median)}</div><div class="almanac-stat-label">Median advertised pay</div></div>
    </div>
    <table class="almanac-table">
      <thead><tr><th>Measure</th><th class="num">Value</th></tr></thead>
      <tbody>
        <tr><td>Employer response rate</td><td class="num">${rateCell(summary.rates.response)}</td></tr>
        <tr><td>Reached Strike</td><td class="num">${rateCell(summary.rates.strike)}</td></tr>
        <tr><td>Median days to first response</td><td class="num">${summary.response_time.median_days == null ? '<span class="almanac-thin">not observed</span>' : esc(summary.response_time.median_days)}</td></tr>
      </tbody>
    </table>
    <p class="almanac-sub">Effort by decided outcome</p>
    <table class="almanac-table">
      <thead><tr><th>Outcome</th><th class="num">Decided claims</th><th class="num">Time recorded</th><th class="num">Median effort</th></tr></thead>
      <tbody>${effortOutcomeRows}</tbody>
    </table>
    <p class="almanac-empty">${esc(summary.effort_by_outcome.censored_claims)} active ${summary.effort_by_outcome.censored_claims === 1 ? 'claim remains' : 'claims remain'} censored (${esc(summary.effort_by_outcome.censored_with_time)} with recorded time). ${summary.effort_by_outcome.censored_claims === 1 ? 'It is' : 'They are'} excluded until ${summary.effort_by_outcome.censored_claims === 1 ? 'it reaches' : 'they reach'} Tailings or Strike.</p>
    <p class="almanac-sub">Deepest stage ever reached</p>
    <table class="almanac-table"><tbody>${funnelRows}</tbody></table>
    <p class="almanac-sub">Where the applications went</p>
    <table class="almanac-table"><tbody>${companyRows}</tbody></table>
    <p class="almanac-sub">How they ended</p>
    <table class="almanac-table"><tbody>${reasonRows}</tbody></table>
  </section>`;
}

export function renderAlmanacHtml(almanac) {
  const body = almanac.hunts.length
    ? almanac.hunts.map(huntSection).join('')
    : '<p class="almanac-empty">No hunt recorded yet.</p>';

  const comparison = almanac.comparison.length ? `
  <section class="almanac-hunt">
    <h2>Hunt over hunt</h2>
    <table class="almanac-table">
      <thead><tr><th>Hunt</th><th class="num">Claims</th><th class="num">Staked</th><th class="num">Response</th><th class="num">Median days</th><th class="num">Effort</th></tr></thead>
      <tbody>${almanac.comparison.map((c) => `
        <tr>
          <td>${esc(c.hunt)}</td>
          <td class="num">${esc(c.claims)}</td>
          <td class="num">${esc(c.staked)}</td>
          <td class="num">${c.response_rate == null ? `<span class="almanac-thin">n=${esc(c.response_rate_n)}</span>` : `${Math.round(c.response_rate)}%`}</td>
          <td class="num">${c.median_response_days == null ? '&mdash;' : esc(c.median_response_days)}</td>
          <td class="num">${Math.round(c.total_minutes / 60)}h</td>
        </tr>`).join('')}</tbody>
    </table>
  </section>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
${renderPwaHeadTags({ title: "The Prospector's Almanac — Prospect" })}
<style>${STYLE}</style>
</head>
<body>
${renderTopBar('/almanac')}
<div class="report-shell">
  ${renderSidebarNav('/almanac')}
  <main class="report-main">
    <span class="eyebrow">Prospect</span>
    <h1>The Prospector's Almanac</h1>
    <p class="almanac-lede">What each hunt actually cost and where it went. Rates are only stated
      once there are enough outcomes behind them to mean anything &mdash; below that the count is
      shown instead, because a percentage over four applications is noise wearing a percent sign.</p>
    ${comparison}
    ${body}
  </main>
</div>
${renderTabBar('/almanac')}
</body>
</html>
`;
}
