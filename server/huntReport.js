import { renderPwaHeadTags } from './pwaHead.js';
import { computeLiveness, LIVENESS_VERDICTS } from './liveness.js';
import { computeHonestyLedger } from './nextActionCommitments.js';
import { computeCalibration } from './calibration.js';
import { renderSidebarNav, renderTopBar, renderTabBar, SHELL_STYLE } from './shell.js';
import { ALL_STAGES, FUNNEL_STAGES, TAILINGS_STAGE } from '../app/src/stages.js';
import {
  competitionRateBucket,
  applyFreshnessBucket,
  kaplanMeier,
  percentile,
  percentileRank,
  COMP_PERCENTILE_MIN_N,
} from './analytics.js';
import { computeTally } from './tally.js';
import { computeJobFamilyReport } from './jobFamilyReport.js';
import { computeSkillTrends } from './skillTrends.js';

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeFunnel(db) {
  const rows = db.prepare(`
    SELECT to_stage, COUNT(DISTINCT claim_id) AS n
    FROM stage_transitions
    GROUP BY to_stage
  `).all();
  const byStage = new Map(rows.map((r) => [r.to_stage, r.n]));
  return ALL_STAGES.map(({ key, gloss }) => ({ stage: key, gloss, count: byStage.get(key) || 0 }));
}

function computeDwell(db) {
  const rows = db.prepare(`
    SELECT
      from_stage,
      julianday(transitioned_at) -
        julianday(LAG(transitioned_at) OVER (PARTITION BY claim_id ORDER BY transitioned_at, id)) AS dwell_days
    FROM stage_transitions
    ORDER BY claim_id, transitioned_at, id
  `).all();

  const byStage = new Map(FUNNEL_STAGES.map(({ key }) => [key, []]));
  for (const row of rows) {
    if (!row.from_stage || row.dwell_days == null) continue;
    if (!byStage.has(row.from_stage)) continue;
    byStage.get(row.from_stage).push(row.dwell_days);
  }

  return FUNNEL_STAGES.map(({ key, gloss }) => {
    const days = byStage.get(key);
    return { stage: key, gloss, median_days: median(days), sample_count: days.length };
  });
}

function computeResponseLatency(db) {
  const rows = db.prepare(`
    WITH staked AS (
      SELECT claim_id, MIN(transitioned_at) AS staked_at
      FROM stage_transitions WHERE to_stage = 'Staked' GROUP BY claim_id
    ),
    response AS (
      SELECT st.claim_id, MIN(st.transitioned_at) AS response_at
      FROM stage_transitions st
      JOIN staked s ON s.claim_id = st.claim_id
      WHERE st.from_stage = 'Staked' AND st.transitioned_at > s.staked_at
      GROUP BY st.claim_id
    )
    SELECT julianday(r.response_at) - julianday(s.staked_at) AS latency_days
    FROM staked s JOIN response r ON r.claim_id = s.claim_id
  `).all();

  const days = rows.map((r) => r.latency_days);
  return { median_days: median(days), sample_count: days.length };
}

function computeAging(db) {
  return db.prepare(`
    SELECT c.id AS claim_id, l.company, l.role, c.stage,
           julianday('now') - julianday(c.stage_entered_at) AS days_in_stage
    FROM claims c JOIN listings l ON l.id = c.listing_id
    WHERE c.stage NOT IN ('Strike', 'Tailings')
    ORDER BY days_in_stage DESC
  `).all();
}

function computeActionQueue(db) {
  return db.prepare(`
    SELECT c.id AS claim_id, l.company, l.role, c.next_action, c.next_action_date,
           CASE WHEN c.next_action_date < date('now') THEN 1 ELSE 0 END AS overdue
    FROM claims c JOIN listings l ON l.id = c.listing_id
    WHERE c.next_action_date IS NOT NULL
    ORDER BY overdue DESC, c.next_action_date ASC
  `).all();
}

const COMPETITION_OUTCOMES = ['Advanced', 'Rejected', 'Pending'];
const RATE_BUCKETS = ['Low', 'Medium', 'High', 'Unknown'];
const FRESHNESS_BUCKETS = ['Fresh', 'Recent', 'Stale', 'Unknown'];

function computeApplyCompetition(db) {
  const advancedStages = ['Working the Vein', 'Strike'];
  const placeholders = advancedStages.map(() => '?').join(',');

  const rows = db.prepare(`
    SELECT
      c.id AS claim_id, l.company, l.role,
      l.applicants_per_day, c.days_posted_at_apply,
      EXISTS(
        SELECT 1 FROM stage_transitions st
        WHERE st.claim_id = c.id AND st.to_stage IN (${placeholders})
      ) AS advanced,
      EXISTS(
        SELECT 1 FROM stage_transitions st
        WHERE st.claim_id = c.id AND st.to_stage = ?
      ) AS rejected
    FROM claims c JOIN listings l ON l.id = c.listing_id
    WHERE c.applied_at IS NOT NULL
  `).all(...advancedStages, TAILINGS_STAGE.key);

  const raw = rows.map((r) => ({
    claim_id: r.claim_id, company: r.company, role: r.role,
    applicants_per_day: r.applicants_per_day, days_posted_at_apply: r.days_posted_at_apply,
    rateBucket: competitionRateBucket(r.applicants_per_day),
    freshnessBucket: applyFreshnessBucket(r.days_posted_at_apply),
    outcome: r.advanced ? 'Advanced' : r.rejected ? 'Rejected' : 'Pending',
  }));

  const contingency = (keyName, buckets) => buckets.flatMap((bucket) =>
    COMPETITION_OUTCOMES.map((outcome) => ({
      bucket,
      outcome,
      count: raw.filter((r) => (r[keyName] ?? 'Unknown') === bucket && r.outcome === outcome).length,
    }))
  );

  return {
    raw,
    by_rate: contingency('rateBucket', RATE_BUCKETS),
    by_freshness: contingency('freshnessBucket', FRESHNESS_BUCKETS),
  };
}

function computeGhostCurves(db) {
  const stakedResponse = db.prepare(`
    WITH staked AS (
      SELECT id AS claim_id, applied_at FROM claims WHERE applied_at IS NOT NULL
    ),
    exits AS (
      SELECT claim_id, MIN(transitioned_at) AS exit_at
      FROM stage_transitions WHERE from_stage = 'Staked' GROUP BY claim_id
    )
    SELECT
      CASE WHEN e.exit_at IS NOT NULL THEN julianday(e.exit_at) - julianday(s.applied_at)
           ELSE julianday('now') - julianday(s.applied_at) END AS duration,
      CASE WHEN e.exit_at IS NOT NULL THEN 1 ELSE 0 END AS event
    FROM staked s LEFT JOIN exits e ON e.claim_id = s.claim_id AND e.exit_at > s.applied_at
  `).all();

  const interviewResolution = db.prepare(`
    WITH entry AS (
      SELECT claim_id, MIN(transitioned_at) AS entered_at
      FROM stage_transitions WHERE to_stage = 'Working the Vein' GROUP BY claim_id
    ),
    exit_rows AS (
      SELECT claim_id, MIN(transitioned_at) AS exited_at
      FROM stage_transitions WHERE from_stage = 'Working the Vein' GROUP BY claim_id
    )
    SELECT
      CASE WHEN x.exited_at IS NOT NULL THEN julianday(x.exited_at) - julianday(e.entered_at)
           ELSE julianday('now') - julianday(e.entered_at) END AS duration,
      CASE WHEN x.exited_at IS NOT NULL THEN 1 ELSE 0 END AS event
    FROM entry e LEFT JOIN exit_rows x ON x.claim_id = e.claim_id AND x.exited_at > e.entered_at
  `).all();

  return {
    staked_response: kaplanMeier(stakedResponse),
    interview_resolution: kaplanMeier(interviewResolution),
  };
}

function computeCompDistribution(db) {
  const rows = db.prepare(`
    SELECT c.id AS claim_id, l.company, l.role, l.annual_comp_mid
    FROM claims c JOIN listings l ON l.id = c.listing_id
    WHERE l.comp_disclosed = 1 AND l.annual_comp_mid IS NOT NULL
  `).all();

  const n = rows.length;
  if (n < COMP_PERCENTILE_MIN_N) return { sufficient: false, n, minN: COMP_PERCENTILE_MIN_N };

  const sortedValues = rows.map((r) => r.annual_comp_mid).sort((a, b) => a - b);
  const claims = rows.map((r) => ({
    claim_id: r.claim_id, company: r.company, role: r.role, annual_comp_mid: r.annual_comp_mid,
    percentile: percentileRank(sortedValues, r.annual_comp_mid),
  }));

  return {
    sufficient: true,
    n,
    min: sortedValues[0],
    p25: percentile(sortedValues, 25),
    median: percentile(sortedValues, 50),
    p75: percentile(sortedValues, 75),
    max: sortedValues[n - 1],
    claims,
  };
}

export function getHuntReport(db) {
  return {
    tally: computeTally(db),
    funnel: computeFunnel(db),
    job_family: computeJobFamilyReport(db),
    skill_trends: computeSkillTrends(db),
    dwell: computeDwell(db),
    response_latency: computeResponseLatency(db),
    aging: computeAging(db),
    action_queue: computeActionQueue(db),
    apply_competition: computeApplyCompetition(db),
    ghost_curves: computeGhostCurves(db),
    comp_distribution: computeCompDistribution(db),
    liveness: computeLiveness(db),
    honesty: computeHonestyLedger(db),
    calibration: computeCalibration(db),
  };
}

function esc(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDays(n) {
  return n == null ? '—' : `${Math.round(n * 10) / 10}d`;
}

function odo(n) {
  return `<span class="odo-real">${n}</span><span class="odo-anim" aria-hidden="true" style="--odo-final:${n}"></span>`;
}

function fadeSpan(text) {
  return `<span class="fade-in">${text}</span>`;
}

function section(title, gloss, body) {
  return `
    <section class="report-section">
      <h2>${esc(title)}</h2>
      <p class="gloss">${esc(gloss)}</p>
      ${body}
    </section>
  `;
}

function empty(message) {
  return `<p class="empty">${esc(message)}</p>`;
}

function pct(rate) {
  return `${Math.round(rate * 1000) / 10}%`;
}

function heroTile(valueHtml, label, gloss) {
  return `
    <div class="tally-stat">
      <div class="tally-stat-value">${valueHtml}</div>
      <div class="tally-stat-label">${esc(label)}</div>
      <div class="tally-stat-gloss">${esc(gloss)}</div>
    </div>
  `;
}

function metricTile(label, gloss, valueHtml, subText) {
  return `
    <div class="tally-metric">
      <div class="tally-metric-label">${esc(label)} <span class="tally-metric-gloss">${esc(gloss)}</span></div>
      <div class="tally-metric-value">${valueHtml}</div>
      ${subText ? `<div class="metric-sub">${esc(subText)}</div>` : ''}
    </div>
  `;
}

function heatmapMarkup(heatmap) {
  const cols = heatmap.weeks.map((week) => `
    <div class="tally-heat-col">
      ${week.map((day) => `<div class="tally-heat-cell" data-level="${day.level}" title="${esc(day.date)}: ${day.count}"></div>`).join('')}
    </div>
  `).join('');
  return `
    <div class="tally-heatmap">${cols}</div>
    <div class="tally-legend">
      <span>Less</span>
      <span class="tally-heat-cell" data-level="0"></span>
      <span class="tally-heat-cell" data-level="1"></span>
      <span class="tally-heat-cell" data-level="2"></span>
      <span class="tally-heat-cell" data-level="3"></span>
      <span class="tally-heat-cell" data-level="4"></span>
      <span>More</span>
    </div>
  `;
}

function tallySection(tally) {
  const { cadence, response_rate, ghost_rate, effort, easy_apply_share } = tally;
  const cadenceDelta = cadence.delta >= 0 ? `+${cadence.delta}` : `${cadence.delta}`;

  const hero = `
    <div class="tally-hero">
      ${heroTile(odo(tally.staked_total), 'Claims staked', 'applications filed')}
      ${heroTile(odo(tally.current_streak), 'Stake streak', 'consecutive days applied')}
      ${heroTile(odo(tally.longest_streak), 'Longest streak', 'best run ever')}
      ${heroTile(odo(tally.active_days), 'Digging days', 'days with ≥1 application')}
      ${heroTile(odo(tally.staked_this_week), 'This week', 'claims staked, current week')}
      ${heroTile(odo(tally.staked_this_month), 'This month', 'claims staked, current month')}
    </div>
  `;

  const metrics = `
    <div class="tally-metrics">
      ${metricTile('Cadence', 'applications per week',
        fadeSpan(`${Math.round(cadence.avg_per_week * 10) / 10}/wk`),
        `this week ${cadence.this_week} · last week ${cadence.last_week} (Δ${cadenceDelta})`)}
      ${metricTile('Response rate', 'replies per application',
        fadeSpan(pct(response_rate.rate)), `n=${response_rate.n_staked}`)}
      ${metricTile('Ghost rate', 'silent dead-ends',
        fadeSpan(pct(ghost_rate.rate)), `n=${ghost_rate.n_tailings}`)}
      ${effort.sufficient
        ? metricTile('Effort', 'time per application', fadeSpan(`${Math.round(effort.avg_minutes)} min`), `n=${effort.n}`)
        : metricTile('Effort', 'time per application', empty('No time logged yet.'), '')}
      ${easy_apply_share.sufficient
        ? metricTile('Easy Apply share', 'one-click vs. external', fadeSpan(pct(easy_apply_share.rate)), `n=${easy_apply_share.n_known}`)
        : metricTile('Easy Apply share', 'one-click vs. external', empty('Not enough data yet.'), '')}
    </div>
  `;

  return section('The Tally', 'your prospecting activity at a glance', `
    ${hero}
    ${metrics}
    <h3>Diggings calendar</h3>
    <p class="gloss">applications per day</p>
    ${heatmapMarkup(tally.heatmap)}
  `);
}

function funnelSection(funnel) {
  if (funnel.every((f) => f.count === 0)) return section('Funnel', 'how many claims ever reached each stage', empty('No claims yet.'));
  const max = Math.max(1, ...funnel.map((f) => f.count));
  const rows = funnel.map((f, i) => {
    const pct = Math.round((f.count / max) * 100);
    const isStrike = f.stage === 'Strike';
    const isTailings = f.stage === 'Tailings';
    const barClass = isStrike ? 'bar-gold' : isTailings ? 'bar-danger' : 'bar-neutral';
    return `
      <div class="bar-row" style="--i:${i}">
        <div class="bar-label">${esc(f.stage)} <span class="bar-sub">${esc(f.gloss)}</span></div>
        <div class="bar-track"><div class="bar-fill ${barClass}" style="width:${pct}%"></div></div>
        <div class="bar-value ${isStrike ? 'value-gold' : ''}">${odo(f.count)}</div>
      </div>
    `;
  }).join('');
  return section('Funnel', 'how many claims ever reached each stage', `<div class="bars">${rows}</div>`);
}

const JOB_FAMILY_LABELS = {
  it_support: 'IT support',
  desktop_support: 'Desktop support',
  datacenter: 'Datacenter',
  uncategorized: 'Uncategorized',
};

function jobFamilyLabel(slug) {
  return JOB_FAMILY_LABELS[slug] || slug;
}

function jobFamilySection(jobFamily) {
  const { distribution, funnel } = jobFamily;
  if (distribution.length === 0) {
    return section('Ore Types', 'claims grouped by job family — the kind of role each claim tracks', empty('No claims yet.'));
  }

  const max = Math.max(1, ...distribution.map((d) => d.count));
  const bars = distribution.map((d, i) => {
    const barPct = Math.round((d.count / max) * 100);
    return `
      <div class="bar-row" style="--i:${i}">
        <div class="bar-label">${esc(jobFamilyLabel(d.job_family))}</div>
        <div class="bar-track"><div class="bar-fill bar-neutral" style="width:${barPct}%"></div></div>
        <div class="bar-value">${odo(d.count)}</div>
      </div>
    `;
  }).join('');

  const headerCells = funnel.stages.map((s) => `<th class="num">${esc(s.gloss)}</th>`).join('');
  const bodyRows = funnel.rows.map((r) => `
    <tr>
      <td>${esc(jobFamilyLabel(r.job_family))}</td>
      ${funnel.stages.map((s) => `<td class="num">${odo(r.counts[s.key] || 0)}</td>`).join('')}
    </tr>
  `).join('');

  return section('Ore Types', 'claims grouped by job family — the kind of role each claim tracks', `
    <div class="bars">${bars}</div>
    <table class="report-table">
      <caption>Per-family funnel (ever reached)</caption>
      <thead><tr><th></th>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `);
}

function roleFamilyReconciliationSection(reconciliation) {
  const { items, summary } = reconciliation;
  if (items.length === 0) {
    return section('Role Signal Check', 'job_family, role_family, and the AI-parsed role_hint, cross-checked', empty('No listings yet.'));
  }

  const rows = items.map((i) => `
    <tr>
      <td>${esc(i.role)}</td>
      <td>${esc(jobFamilyLabel(i.job_family))}</td>
      <td>${esc(i.role_family ? jobFamilyLabel(i.role_family) : '—')}</td>
      <td>${esc(i.role_hint || '—')}</td>
      <td>${i.agrees === null ? '—' : i.agrees ? 'agree' : 'disagree'}</td>
    </tr>
  `).join('');

  return section('Role Signal Check', 'job_family, role_family, and the AI-parsed role_hint, cross-checked', `
    <p class="gloss">${odo(summary.agree)} of ${odo(summary.comparable)} comparable listings agree · ${odo(summary.disagree)} disagree · ${odo(summary.role_family_supplied)} carry a source-supplied role_family.</p>
    <table class="report-table">
      <caption>Per-listing signals</caption>
      <thead><tr><th>Role</th><th>job_family</th><th>role_family</th><th>role_hint</th><th>signal</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `);
}

function skillTrendsSection(skillTrends) {
  if (skillTrends.trends.length === 0) {
    return section(
      'Skill signals',
      'skills appearing across tracked listings, compared with the configured Scout profile',
      empty('No extracted listing skills yet.'),
    );
  }

  const top = skillTrends.trends.slice(0, 12);
  const bars = top.map((item, i) => `
    <div class="bar-row" style="--i:${i}">
      <div class="bar-label">${esc(item.skill)}
        <span class="bar-sub">${item.required_count} required · ${item.preferred_count} preferred</span>
      </div>
      <div class="bar-track"><div class="bar-fill bar-neutral" style="width:${Math.round(item.prevalence * 100)}%"></div></div>
      <div class="bar-value">${odo(item.listing_count)} <span class="bar-sub">of ${skillTrends.analyzed_listings}</span></div>
    </div>
  `).join('');

  const gaps = skillTrends.profile_gaps.slice(0, 10);
  const gapMarkup = gaps.length === 0
    ? empty('Every required skill in this corpus is represented in the configured profile.')
    : `
      <table class="report-table">
        <caption>Required skills not represented in the configured profile</caption>
        <thead><tr><th>Skill</th><th class="num">Required listings</th><th class="num">All mentions</th></tr></thead>
        <tbody>${gaps.map((item) => `
          <tr>
            <td>${esc(item.skill)}</td>
            <td class="num">${odo(item.required_count)}</td>
            <td class="num">${odo(item.listing_count)}</td>
          </tr>
        `).join('')}</tbody>
      </table>
    `;

  const profileContext = skillTrends.profile_label
    ? `${skillTrends.profile_label} · ${skillTrends.profile_skill_count} configured skills`
    : 'No Scout profile is configured';

  return section(
    'Skill signals',
    'skills appearing across tracked listings, compared with the configured Scout profile',
    `
      <p class="metric-sub">${skillTrends.skill_rows} extracted rows across ${skillTrends.analyzed_listings} tracked listing${skillTrends.analyzed_listings === 1 ? '' : 's'} · ${esc(profileContext)}</p>
      <div class="bars">${bars}</div>
      <h3>Profile gap candidates</h3>
      <p class="gloss">Exact name comparison only. “Not represented” is a profile-editing prompt, not a claim that you lack the skill.</p>
      ${gapMarkup}
    `,
  );
}

function dwellSection(dwell) {
  if (dwell.every((d) => d.sample_count === 0)) return section('Dwell', 'median days spent in each stage', empty('No claims yet.'));
  const max = Math.max(1, ...dwell.map((d) => d.median_days || 0));
  const rows = dwell.map((d, i) => {
    const pct = d.median_days == null ? 0 : Math.round((d.median_days / max) * 100);
    return `
      <div class="bar-row" style="--i:${i}">
        <div class="bar-label">${esc(d.stage)} <span class="bar-sub">${esc(d.gloss)}</span></div>
        <div class="bar-track"><div class="bar-fill bar-neutral" style="width:${pct}%"></div></div>
        <div class="bar-value">${fadeSpan(fmtDays(d.median_days))} <span class="bar-sub">(n=${d.sample_count})</span></div>
      </div>
    `;
  }).join('');
  return section('Dwell', 'median days spent in each stage', `<div class="bars">${rows}</div>`);
}

function responseLatencySection(responseLatency) {
  return section(
    'Response latency',
    'days from applying to first response or rejection',
    `
      <div class="metric">
        <div class="metric-value">${fadeSpan(fmtDays(responseLatency.median_days))}</div>
        <div class="metric-sub">median days · n = ${responseLatency.sample_count} responded claim${responseLatency.sample_count === 1 ? '' : 's'}</div>
      </div>
    `,
  );
}

function livenessSection(liveness) {
  if (!liveness || !liveness.available) {
    return section('Listing liveness', 'vendor status evidence', empty('Liveness pipeline not available on this database.'));
  }
  const totals = liveness.totals;
  const rows = Object.entries(LIVENESS_VERDICTS).map(([verdict, info]) => `
    <tr>
      <td>${esc(info.label)}</td>
      <td>${esc(info.gloss)}</td>
      <td class="num">${odo(totals[verdict] || 0)}</td>
    </tr>
  `).join('');
  const residueCount = totals.residue || 0;
  return section(
    'Listing liveness',
    'deterministic only — no posting is ever re-fetched',
    `
    <table class="report-table">
      <thead><tr><th>Verdict</th><th>Basis</th><th class="num">Claims</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="report-note">${esc(residueCount)} of ${esc(liveness.claims.length)} claims are residue —
      Prospect holds no evidence either way. Sightings are counted fresh within
      ${esc(liveness.thresholds.fresh_days)} days and lapsed after ${esc(liveness.thresholds.lapse_days)}.
      Alert mail is a filtered digest, not a liveness feed, so a lapse is a question, not an answer.</p>
  `,
  );
}

function honestyLedgerSection(honesty) {
  if (!honesty || !honesty.available) {
    return section('Honesty ledger', 'promised vs revised next actions', empty('Commitment ledger not available on this database.'));
  }
  const { totals, slip, cleared_timing: cleared, open } = honesty;
  if (totals.promised === 0 && open.count === 0) {
    return section('Honesty ledger', 'promised vs revised next actions', empty('No next action has been promised yet.'));
  }
  const recording = honesty.recording_since
    ? `Recording since ${esc(String(honesty.recording_since).slice(0, 10))}.`
    : 'Nothing recorded yet — the ledger begins when the next action is first set.';
  return section('Honesty ledger', 'promised vs revised next actions', `
    <table class="report-table">
      <thead><tr><th>Measure</th><th class="num">Count</th></tr></thead>
      <tbody>
        <tr><td>Actions promised</td><td class="num">${esc(totals.promised)}</td></tr>
        <tr><td>Revised while still open</td><td class="num">${esc(totals.revised)}</td></tr>
        <tr><td>Due date pushed later</td><td class="num">${esc(slip.moved_count)}</td></tr>
        <tr><td>Total days of slip</td><td class="num">${esc(slip.total_days)}</td></tr>
        <tr><td>Cleared on or before the due date</td><td class="num">${esc(cleared.before_or_on_due)}</td></tr>
        <tr><td>Cleared after the due date</td><td class="num">${esc(cleared.after_due)}</td></tr>
        <tr><td>Still open</td><td class="num">${esc(open.count)}</td></tr>
        <tr class="${open.overdue ? 'row-overdue' : ''}"><td>Still open and overdue</td><td class="num">${esc(open.overdue)}</td></tr>
      </tbody>
    </table>
    <p class="report-note">${recording} Prospect records that a commitment was cleared; it cannot see
      whether it was cleared because the work was done or because it was abandoned, so it does not
      report a completion rate it has no evidence for.</p>
  `);
}

function calibrationSection(calibration) {
  if (!calibration || !calibration.available) {
    return section('Forecast calibration', 'predicted versus what happened', empty('Not available on this database.'));
  }
  const logged = calibration.predictors.reduce((sum, p) => sum + p.predictions_logged, 0);
  if (logged === 0) {
    return section('Forecast calibration', 'predicted versus what happened',
      empty('No forecast logged yet. Recording begins the first time a gut prediction is saved or a Scout lead is staked.'));
  }
  const rows = calibration.predictors
    .filter((p) => p.predictions_logged > 0 || p.claims_with_prediction > 0)
    .map((p) => `
    <tr>
      <td>${esc(p.predictor)}</td>
      <td class="num">${esc(p.claims_with_prediction)}</td>
      <td class="num">${esc(p.resolved)}</td>
      <td class="num">${esc(p.censored)}</td>
      <td class="num">${p.sufficient
        ? `${p.brier.toFixed(3)} <span class="report-thin">vs ${p.baseline_brier.toFixed(2)} for a coin flip</span>`
        : `<span class="report-thin">${esc(calibration.min_n - p.resolved)} more outcomes needed</span>`}</td>
    </tr>`).join('');

  return section('Forecast calibration', 'predicted versus what happened', `
    <table class="report-table">
      <thead><tr>
        <th>Predictor</th><th class="num">Claims</th><th class="num">Resolved</th>
        <th class="num">Still running</th><th class="num">Brier score</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="report-note">${esc(calibration.evidence_plan.outcome)}
      ${esc(calibration.evidence_plan.prediction_validity)}
      ${esc(calibration.evidence_plan.minimum)}</p>
  `);
}

function agingSection(aging) {
  if (aging.length === 0) return section('Aging claims', "still-active claims by how long they've sat", empty('No claims yet.'));
  const rows = aging.map((a) => `
    <tr>
      <td>${esc(a.company)}</td>
      <td>${esc(a.role)}</td>
      <td>${esc(a.stage)}</td>
      <td class="num">${fadeSpan(fmtDays(a.days_in_stage))}</td>
    </tr>
  `).join('');
  return section('Aging claims', "still-active claims by how long they've sat", `
    <table class="report-table">
      <thead><tr><th>Company</th><th>Role</th><th>Stage</th><th class="num">Days in stage</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `);
}

function actionQueueSection(actionQueue) {
  if (actionQueue.length === 0) return section('Action queue', 'next actions, overdue first', empty('No claims yet.'));
  const rows = actionQueue.map((a) => `
    <tr class="${a.overdue ? 'row-overdue' : ''}">
      <td>${esc(a.company)}</td>
      <td>${esc(a.role)}</td>
      <td>${esc(a.next_action)}</td>
      <td class="num">${esc(a.next_action_date)}</td>
      <td>${a.overdue ? '<span class="chip-overdue">overdue</span>' : ''}</td>
    </tr>
  `).join('');
  return section('Action queue', 'next actions, overdue first', `
    <table class="report-table">
      <thead><tr><th>Company</th><th>Role</th><th>Next action</th><th class="num">Due</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `);
}

function contingencyTable(label, rows, buckets) {
  const countFor = (bucket, outcome) => rows.find((r) => r.bucket === bucket && r.outcome === outcome)?.count || 0;
  const bodyRows = buckets.map((bucket) => `
    <tr>
      <td>${esc(bucket)}</td>
      ${COMPETITION_OUTCOMES.map((o) => `<td class="num">${odo(countFor(bucket, o))}</td>`).join('')}
    </tr>
  `).join('');
  return `
    <table class="report-table">
      <caption>${esc(label)}</caption>
      <thead><tr><th></th>${COMPETITION_OUTCOMES.map((o) => `<th class="num">${esc(o)}</th>`).join('')}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

function applyCompetitionSection(applyCompetition) {
  const { raw, by_rate, by_freshness } = applyCompetition;
  if (raw.length === 0) {
    return section('Apply-time competition', 'competition level and posting freshness at the moment of applying, by outcome', empty('No staked claims yet.'));
  }
  return section('Apply-time competition', 'competition level and posting freshness at the moment of applying, by outcome', `
    ${contingencyTable('By competition (applicants/day)', by_rate, RATE_BUCKETS)}
    ${contingencyTable('By posting freshness at apply', by_freshness, FRESHNESS_BUCKETS)}
    <p class="metric-sub">n = ${raw.length} staked claim${raw.length === 1 ? '' : 's'}</p>
  `);
}

function kmCurveTable(curve) {
  if (curve.n === 0) return empty('No claims yet.');
  const rows = curve.steps.map((s) => `
    <tr>
      <td class="num">${fadeSpan(fmtDays(s.t))}</td>
      <td class="num">${s.atRisk}</td>
      <td class="num">${s.events}</td>
      <td class="num">${s.censored}</td>
      <td class="num">${fadeSpan(`${Math.round(s.survival * 1000) / 10}%`)}</td>
    </tr>
  `).join('');
  return `
    <table class="report-table">
      <thead><tr><th class="num">Day</th><th class="num">At risk</th><th class="num">Events</th><th class="num">Censored</th><th class="num">Survival</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="metric-sub">median: ${curve.median == null ? 'not reached' : fmtDays(curve.median)} · n=${curve.n}</p>
  `;
}

function ghostCurvesSection(ghostCurves) {
  const { staked_response, interview_resolution } = ghostCurves;
  if (staked_response.n === 0 && interview_resolution.n === 0) {
    return section('Ghost & Resolution Curves', 'survival analysis of time spent waiting on a claim, censoring the still-pending', empty('No claims yet.'));
  }
  return section('Ghost & Resolution Curves', 'survival analysis of time spent waiting on a claim, censoring the still-pending', `
    <h3>Staked &rarr; response</h3>
    <p class="gloss">days from applying to the first move out of Staked</p>
    ${kmCurveTable(staked_response)}
    <h3>Interview resolution</h3>
    <p class="gloss">days held in Working the Vein before moving out — tracks time to resolution for active interviews</p>
    ${kmCurveTable(interview_resolution)}
  `);
}

function fmtComp(v) {
  return v == null ? '—' : `$${Math.round(v).toLocaleString('en-US')}`;
}

function compDistributionSection(compDistribution) {
  if (!compDistribution.sufficient) {
    return section('Comp distribution', 'percentile spread of disclosed comp across staked claims', empty(
      `Not enough disclosed-comp claims yet (n=${compDistribution.n}, need ${compDistribution.minN}).`
    ));
  }
  const { n, min, p25, median, p75, max, claims } = compDistribution;
  const span = max - min || 1;
  const statPct = (v) => Math.round(((v - min) / span) * 100);
  const stats = [['Min', min], ['P25', p25], ['Median', median], ['P75', p75], ['Max', max]];
  const statRows = stats.map(([label, value], i) => `
    <div class="bar-row" style="--i:${i}">
      <div class="bar-label">${esc(label)}</div>
      <div class="bar-track"><div class="bar-fill bar-neutral" style="width:${statPct(value)}%"></div></div>
      <div class="bar-value">${fadeSpan(fmtComp(value))}</div>
    </div>
  `).join('');
  const claimRows = claims.map((c) => `
    <tr>
      <td>${esc(c.company)}</td>
      <td>${esc(c.role)}</td>
      <td class="num">${fadeSpan(fmtComp(c.annual_comp_mid))}</td>
      <td class="num">${fadeSpan(`${Math.round(c.percentile)}th`)}</td>
    </tr>
  `).join('');
  return section('Comp distribution', 'percentile spread of disclosed comp across staked claims', `
    <div class="bars">${statRows}</div>
    <table class="report-table">
      <thead><tr><th>Company</th><th>Role</th><th class="num">Comp</th><th class="num">Percentile</th></tr></thead>
      <tbody>${claimRows}</tbody>
    </table>
    <p class="metric-sub">n = ${n}</p>
  `);
}

const STYLE = `
  :root {
    --wet-slate: #1B2327; --placer-gold: #CDA349; --verdigris: #4C8C78; --iron-oxide: #A14B33;
    --quartz: #E7E1D3; --galena: #6E767B;
    --slate-900: #10171A; --slate-850: #161E22; --slate-800: #1B2327; --slate-750: #212B2F; --slate-700: #283338;
    --line: #2E383C; --galena-dim: #3A4448;
    --quartz-100: #F3EFE6; --quartz-200: #E7E1D3; --quartz-300: #CFD4D0; --quartz-400: #9AA1A4;
    --bg-base: var(--slate-800); --bg-sunken: var(--slate-900); --surface-card: var(--slate-750); --surface-raised: var(--slate-700);
    --text-strong: var(--quartz-100); --text-body: var(--quartz-200); --text-muted: var(--galena);
    --text-faint: var(--quartz-400); --text-on-gold: #1C1A12;
    --danger: var(--iron-oxide); --danger-wash: rgba(161,75,51,.14);
    --font-slab: 'Zilla Slab', Georgia, serif;
    --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
    --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
    --dur-state: 180ms; --dur-move: 280ms; --dur-scene: 480ms; --rise: 8px; --stagger: 32ms;
    --ease-pan: cubic-bezier(0.45, 0, 0.15, 1);
    --ease-settle: linear(0, 0.3 12%, 0.55 24%, 0.73 37%, 0.85 50%, 0.93 64%, 0.975 80%, 1);
  }
  @property --odo {
    syntax: '<integer>';
    inherits: false;
    initial-value: 0;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    background: var(--bg-base); color: var(--text-body); font-family: var(--font-sans);
    font-size: 16px; line-height: 1.55;
  }

  @view-transition {
    navigation: auto;
  }
  @keyframes vt-root-out-up {
    to { opacity: 0; transform: translateY(calc(-1 * var(--rise))); }
  }
  @keyframes vt-root-in-from-below {
    from { opacity: 0; transform: translateY(var(--rise)); }
  }
  @media (prefers-reduced-motion: no-preference) {
    ::view-transition-old(root) {
      animation: vt-root-out-up var(--dur-move) var(--ease-pan) both;
    }
    ::view-transition-new(root) {
      animation: vt-root-in-from-below var(--dur-move) var(--ease-pan) both;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    ::view-transition-group(*),
    ::view-transition-old(*),
    ::view-transition-new(*) {
      animation-duration: 0.01ms !important;
    }
  }

  .report-main { min-width: 0; padding-bottom: 60px; }
  ${SHELL_STYLE}

  body::before {
    content: '';
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background-image:
      repeating-linear-gradient(0deg, color-mix(in oklab, var(--galena) 20%, transparent) 0 1px, transparent 1px 96px),
      repeating-linear-gradient(90deg, color-mix(in oklab, var(--galena) 20%, transparent) 0 1px, transparent 1px 96px);
    opacity: .35;
  }

  .odo-real { display: inline; }
  .odo-anim { display: none; }
  @media (prefers-reduced-motion: no-preference) {
    .fade-in {
      animation: fade-rise var(--dur-state) var(--ease-settle) both;
    }
  }
  @keyframes fade-rise {
    from { opacity: 0; transform: translateY(4px); }
  }

  @supports (animation-timeline: view()) {
    @media (prefers-reduced-motion: no-preference) {
      .report-section {
        animation: section-rise linear both;
        animation-timeline: view();
        animation-range: entry 0% entry 35%;
      }
    }
  }
  @keyframes section-rise {
    from { opacity: 0; transform: translateY(var(--rise)); }
  }

  main { max-width: 880px; margin: 0 auto; padding: 40px 28px; }
  h1 {
    font-family: var(--font-slab); font-weight: 700; font-size: 30px; color: var(--text-strong);
    margin: 0 0 6px; letter-spacing: -.01em;
  }
  .eyebrow {
    font-family: var(--font-mono); font-size: 11px; letter-spacing: .22em; text-transform: uppercase;
    color: var(--text-muted); display: block; margin-bottom: 10px;
  }
  .page-sub { color: var(--text-muted); font-size: 13.5px; margin: 0 0 36px; }
  .report-section {
    background: var(--surface-card); border: 1px solid var(--line); border-radius: 14px;
    padding: 22px 24px; margin-bottom: 22px;
    contain: content;
  }
  .report-section h2 {
    font-family: var(--font-slab); font-weight: 700; font-size: 20px; color: var(--text-strong);
    margin: 0 0 4px;
  }
  .report-section .gloss { color: var(--text-muted); font-size: 13px; margin: 0 0 18px; }
  .report-section h3 {
    font-family: var(--font-sans); font-weight: 600; font-size: 14px; color: var(--text-strong);
    margin: 18px 0 2px;
  }
  .report-section h3:first-of-type { margin-top: 0; }
  .report-table caption {
    text-align: left; font-family: var(--font-mono); font-size: 10.5px; letter-spacing: .08em;
    text-transform: uppercase; color: var(--text-faint); margin: 14px 0 6px; caption-side: top;
  }
  .report-table caption:first-child { margin-top: 0; }
  .empty { color: var(--text-faint); font-size: 13.5px; margin: 0; }
  .report-note { color: var(--text-faint); font-size: 12.5px; line-height: 1.55; max-width: 66ch; margin: 10px 0 0; }
  .report-thin { color: var(--text-faint); font-family: var(--font-mono); font-size: 11px; }
  .insight-links { display: flex; flex-wrap: wrap; gap: 10px; margin: -14px 0 24px; }
  .insight-links a {
    border: 1px solid var(--line); border-radius: 999px; padding: 6px 11px;
    background: var(--surface-card); color: var(--text-body); text-decoration: none;
    font-family: var(--font-mono); font-size: 11px;
  }
  .report-diagnostics { border-top: 1px solid var(--line); margin-top: 30px; padding-top: 18px; }
  .report-diagnostics > summary {
    cursor: pointer; color: var(--text-strong); font-family: var(--font-slab);
    font-size: 20px; font-weight: 700; margin-bottom: 20px;
  }
  .report-diagnostics > summary span {
    display: block; color: var(--text-muted); font-family: var(--font-sans);
    font-size: 12.5px; font-weight: 400; margin-top: 4px;
  }
  .bars { display: flex; flex-direction: column; gap: 12px; }
  .bar-row { display: grid; grid-template-columns: 190px 1fr 110px; align-items: center; gap: 14px; contain: content; }
  .bar-label { font-size: 13px; color: var(--text-body); }
  .bar-sub { display: block; font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint); margin-top: 2px; }
  .bar-track { background: var(--bg-sunken); border-radius: 6px; height: 14px; overflow: hidden; border: 1px solid var(--line); }
  .bar-fill { height: 100%; min-width: 2px; border-radius: 6px 0 0 6px; }
  .bar-neutral { background: var(--galena); }
  .bar-gold { background: var(--placer-gold); }
  .bar-danger { background: var(--iron-oxide); }
  .bar-value { font-family: var(--font-mono); font-size: 13px; color: var(--text-body); text-align: right; }
  .value-gold { color: var(--placer-gold); font-weight: 700; }
  .metric { text-align: left; }
  .metric-value { font-family: var(--font-mono); font-size: 30px; color: var(--text-strong); font-weight: 700; }
  .metric-sub { color: var(--text-muted); font-size: 12.5px; margin-top: 4px; }
  .report-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .report-table tr { contain: content; }
  .report-table th {
    text-align: left; font-family: var(--font-mono); font-size: 10.5px; letter-spacing: .12em;
    text-transform: uppercase; color: var(--text-faint); font-weight: 500; padding: 0 10px 8px 0;
    border-bottom: 1px solid var(--line);
  }
  .report-table td { padding: 8px 10px 8px 0; border-bottom: 1px solid var(--line); color: var(--text-body); }
  .report-table td.num, .report-table th.num { text-align: right; font-family: var(--font-mono); }
  .row-overdue td { color: var(--iron-oxide); }
  .chip-overdue {
    font-family: var(--font-mono); font-size: 10px; letter-spacing: .08em; text-transform: uppercase;
    color: var(--iron-oxide); background: var(--danger-wash); border-radius: 999px; padding: 2px 8px;
  }

  .tally-hero { display: flex; flex-wrap: wrap; gap: 20px 26px; margin-bottom: 22px; }
  .tally-stat { min-width: 104px; }
  .tally-stat-value { font-family: var(--font-mono); font-size: 26px; font-weight: 700; color: var(--text-strong); }
  .tally-stat-label { font-size: 12.5px; color: var(--text-body); margin-top: 2px; }
  .tally-stat-gloss { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); }
  .tally-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 20px; }
  .tally-metric-label { font-size: 12.5px; color: var(--text-body); }
  .tally-metric-gloss { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); }
  .tally-metric-value { font-family: var(--font-mono); font-size: 20px; font-weight: 700; color: var(--text-strong); margin-top: 2px; }
  .tally-heatmap {
    display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 11px);
    grid-auto-columns: 11px; gap: 3px; margin: 10px 0 8px; overflow-x: auto;
  }
  .tally-heat-col { display: contents; }
  .tally-heat-cell {
    width: 11px; height: 11px; border-radius: 2px; border: 1px solid var(--line);
    background: var(--bg-sunken); contain: content;
  }
  .tally-heat-cell[data-level="1"] { background: var(--galena); opacity: .28; }
  .tally-heat-cell[data-level="2"] { background: var(--galena); opacity: .52; }
  .tally-heat-cell[data-level="3"] { background: var(--galena); opacity: .76; }
  .tally-heat-cell[data-level="4"] { background: var(--galena); opacity: 1; }
  .tally-legend { display: flex; align-items: center; gap: 4px; font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); }
  .tally-legend .tally-heat-cell { width: 11px; height: 11px; }
`;

export function renderHuntReportHtml(report) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
${renderPwaHeadTags({ title: 'Hunt Report — Prospect' })}
<style>${STYLE}</style>
</head>
<body>
${renderTopBar('/report')}
<div class="report-shell">
  ${renderSidebarNav('/report')}
  <main class="report-main">
    <span class="eyebrow">Prospect</span>
    <h1>Hunt Report</h1>
    <p class="page-sub">A decision-first summary of your active hunt. Every number remains visible in the raw page.</p>
    <nav class="insight-links" aria-label="More insights">
      <a href="/almanac">Almanac · effort and outcomes</a>
      <a href="/strike-sheet">Strike Sheet · offer evidence</a>
      <a href="/pledge">Data Pledge · what Prospect records</a>
    </nav>
    ${tallySection(report.tally)}
    ${funnelSection(report.funnel)}
    ${agingSection(report.aging)}
    ${actionQueueSection(report.action_queue)}
    ${compDistributionSection(report.comp_distribution)}
    <details class="report-diagnostics">
      <summary>Diagnostics and research <span>Role signals, timing models, liveness, and calibration</span></summary>
      ${jobFamilySection(report.job_family)}
      ${roleFamilyReconciliationSection(report.job_family.reconciliation)}
      ${skillTrendsSection(report.skill_trends)}
      ${dwellSection(report.dwell)}
      ${responseLatencySection(report.response_latency)}
      ${applyCompetitionSection(report.apply_competition)}
      ${ghostCurvesSection(report.ghost_curves)}
      ${livenessSection(report.liveness)}
      ${honestyLedgerSection(report.honesty)}
      ${calibrationSection(report.calibration)}
    </details>
  </main>
</div>
${renderTabBar('/report')}
</body>
</html>
`;
}
