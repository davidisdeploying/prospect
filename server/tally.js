import { TAILINGS_STAGE } from '../app/src/stages.js';

// Bare UTC 'YYYY-MM-DD HH:MM:SS' -> its Chicago-local calendar day, DST-correct via the IANA
// tz database (Intl, not a fixed UTC offset).
function chicagoDay(ts) {
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// From here down, all arithmetic is on plain YYYY-MM-DD day keys (already Chicago-bucketed above)
// via Date.UTC/getUTCDay as a civil-calendar calculator — no further timezone conversion, so DST
// can't re-enter the math.
function dayKeyToUTCDate(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(dayKey, delta) {
  const d = dayKeyToUTCDate(dayKey);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function weekStart(dayKey) {
  return addDays(dayKey, -dayKeyToUTCDate(dayKey).getUTCDay());
}

function levelFor(count) {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count === 3) return 3;
  return 4;
}

function computeStreaks(uniqueDaysSorted, today, stakeDaySet) {
  let current_streak = 0;
  if (stakeDaySet.has(today)) {
    let d = today;
    while (stakeDaySet.has(d)) {
      current_streak++;
      d = addDays(d, -1);
    }
  }

  let longest_streak = 0;
  let run = 0;
  let prevDay = null;
  for (const day of uniqueDaysSorted) {
    run = prevDay !== null && addDays(prevDay, 1) === day ? run + 1 : 1;
    longest_streak = Math.max(longest_streak, run);
    prevDay = day;
  }

  return { current_streak, longest_streak };
}

function computeHeatmap(currentWeekStart, countsByDay) {
  const firstWeekStart = addDays(currentWeekStart, -7 * 25); // 26 weeks total, inclusive of current
  const weeks = [];
  for (let w = 0; w < 26; w++) {
    const wStart = addDays(firstWeekStart, w * 7);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(wStart, i);
      const count = countsByDay.get(date) || 0;
      days.push({ date, count, level: levelFor(count) });
    }
    weeks.push(days);
  }
  return { weeks };
}

function computeCadence(stakeDays, uniqueDaysSorted, currentWeekStart, staked_this_week) {
  let avg_per_week = 0;
  if (uniqueDaysSorted.length > 0) {
    const firstWeekStart = weekStart(uniqueDaysSorted[0]);
    const weeksSpan = Math.round(
      (dayKeyToUTCDate(currentWeekStart) - dayKeyToUTCDate(firstWeekStart)) / (7 * 86400000)
    ) + 1;
    avg_per_week = stakeDays.length / weeksSpan;
  }
  const lastWeekStart = addDays(currentWeekStart, -7);
  const last_week = stakeDays.filter((d) => d >= lastWeekStart && d < currentWeekStart).length;
  return { avg_per_week, this_week: staked_this_week, last_week, delta: staked_this_week - last_week };
}

// A response is the first observable exit from Staked, regardless of destination, strictly after
// the first Staked entry. Tailings counts as a response but not as interview advancement. This is
// the count counterpart to §4.2's computeResponseLatency in huntReport.js.
function computeResponseRate(db) {
  const row = db.prepare(`
    WITH staked AS (
      SELECT claim_id, MIN(transitioned_at) AS staked_at
      FROM stage_transitions WHERE to_stage = 'Staked' GROUP BY claim_id
    ),
    responded AS (
      SELECT DISTINCT s.claim_id
      FROM staked s
      JOIN stage_transitions st ON st.claim_id = s.claim_id
      WHERE st.from_stage = 'Staked' AND st.transitioned_at > s.staked_at
    )
    SELECT (SELECT COUNT(*) FROM staked) AS n_staked,
           (SELECT COUNT(*) FROM responded) AS n_responded
  `).get();
  const { n_staked, n_responded } = row;
  return { n_staked, n_responded, rate: n_staked === 0 ? 0 : n_responded / n_staked };
}

// Of claims that ever reached Tailings, how many latest-Tailings-transition rows carry
// outcome_reason='ghosted'. "Latest per claim" (not just any) so a claim that reopened and
// re-reached Tailings is judged by its most recent outcome, not a stale earlier one.
function computeGhostRate(db) {
  const row = db.prepare(`
    WITH ranked AS (
      SELECT claim_id, outcome_reason,
        ROW_NUMBER() OVER (PARTITION BY claim_id ORDER BY transitioned_at DESC, id DESC) AS rn
      FROM stage_transitions WHERE to_stage = ?
    )
    SELECT COUNT(*) AS n_tailings,
           SUM(CASE WHEN outcome_reason = 'ghosted' THEN 1 ELSE 0 END) AS n_ghosted
    FROM ranked WHERE rn = 1
  `).get(TAILINGS_STAGE.key);
  const n_tailings = row.n_tailings || 0;
  const n_ghosted = row.n_ghosted || 0;
  return { n_tailings, n_ghosted, rate: n_tailings === 0 ? 0 : n_ghosted / n_tailings };
}

function computeEffort(db) {
  const row = db.prepare(`
    SELECT COUNT(*) AS n, SUM(application_minutes) AS sum_minutes, AVG(application_minutes) AS avg_minutes
    FROM claims WHERE application_minutes IS NOT NULL
  `).get();
  if (row.n === 0) return { sufficient: false, n: 0, sum_minutes: null, avg_minutes: null };
  return { sufficient: true, n: row.n, sum_minutes: row.sum_minutes, avg_minutes: row.avg_minutes };
}

function computeEasyApplyShare(db) {
  const row = db.prepare(`
    SELECT COUNT(*) AS n_known, SUM(CASE WHEN l.easy_apply = 1 THEN 1 ELSE 0 END) AS n_easy
    FROM claims c JOIN listings l ON l.id = c.listing_id
    WHERE c.applied_at IS NOT NULL AND l.easy_apply IS NOT NULL
  `).get();
  if (row.n_known === 0) return { sufficient: false, n_known: 0, n_easy: 0, rate: 0 };
  return { sufficient: true, n_known: row.n_known, n_easy: row.n_easy, rate: row.n_easy / row.n_known };
}

// Read-only: every query is a SELECT; nothing here mutates a row. `now` defaults to the DB clock
// (single clock source) and exists only so tests can pin "today" deterministically.
export function computeTally(db, { now } = {}) {
  const nowTs = now ?? db.prepare("SELECT datetime('now') AS now").get().now;
  const today = chicagoDay(nowTs);
  const currentWeekStart = weekStart(today);
  const thisMonth = today.slice(0, 7);

  const stakeDays = db.prepare('SELECT applied_at FROM claims WHERE applied_at IS NOT NULL')
    .all().map((r) => chicagoDay(r.applied_at));

  const countsByDay = new Map();
  for (const day of stakeDays) countsByDay.set(day, (countsByDay.get(day) || 0) + 1);

  const uniqueDaysSorted = [...countsByDay.keys()].sort();
  const stakeDaySet = new Set(uniqueDaysSorted);

  const staked_total = stakeDays.length;
  const staked_this_week = stakeDays.filter(
    (d) => d >= currentWeekStart && d < addDays(currentWeekStart, 7)
  ).length;
  const staked_this_month = stakeDays.filter((d) => d.slice(0, 7) === thisMonth).length;

  const { current_streak, longest_streak } = computeStreaks(uniqueDaysSorted, today, stakeDaySet);

  return {
    staked_total,
    staked_this_week,
    staked_this_month,
    current_streak,
    longest_streak,
    active_days: uniqueDaysSorted.length,
    heatmap: computeHeatmap(currentWeekStart, countsByDay),
    cadence: computeCadence(stakeDays, uniqueDaysSorted, currentWeekStart, staked_this_week),
    response_rate: computeResponseRate(db),
    ghost_rate: computeGhostRate(db),
    effort: computeEffort(db),
    easy_apply_share: computeEasyApplyShare(db),
  };
}
