// Pure statistical helpers for §4.3 apply-time analytics. No db handle, no I/O — every function
// here takes plain numbers/labels and returns plain data, so it's unit-testable in isolation from
// the SQL that feeds it (see server/huntReport.js for the queries that supply these functions).

export const COMPETITION_RATE_BUCKETS = [10, 50];

export function competitionRateBucket(applicantsPerDay) {
  if (applicantsPerDay == null) return null;
  if (applicantsPerDay < COMPETITION_RATE_BUCKETS[0]) return 'Low';
  if (applicantsPerDay <= COMPETITION_RATE_BUCKETS[1]) return 'Medium';
  return 'High';
}

export const APPLY_FRESHNESS_BUCKETS = [2, 7];

export function applyFreshnessBucket(daysPostedAtApply) {
  if (daysPostedAtApply == null) return null;
  if (daysPostedAtApply <= APPLY_FRESHNESS_BUCKETS[0]) return 'Fresh';
  if (daysPostedAtApply <= APPLY_FRESHNESS_BUCKETS[1]) return 'Recent';
  return 'Stale';
}

export const COMP_PERCENTILE_MIN_N = 5;

// Product-limit (Kaplan-Meier) estimator. observations = [{duration, event}], event 1 = the exit
// was observed at `duration`, event 0 = right-censored (still "alive" at `duration`, no exit seen
// yet). Survival multiplies by (1 - events/atRisk) at each time an event occurs; censored
// observations shrink the at-risk set for later times but don't themselves move survival.
export function kaplanMeier(observations) {
  const n = observations.length;
  if (n === 0) return { steps: [], median: null, n: 0 };

  const times = [...new Set(observations.map((o) => o.duration))].sort((a, b) => a - b);

  let atRisk = n;
  let survival = 1;
  const steps = [];
  for (const t of times) {
    const events = observations.filter((o) => o.duration === t && o.event === 1).length;
    const censored = observations.filter((o) => o.duration === t && o.event === 0).length;
    const stepAtRisk = atRisk;
    if (events > 0) survival *= 1 - events / stepAtRisk;
    steps.push({ t, atRisk: stepAtRisk, events, censored, survival });
    atRisk -= events + censored;
  }

  const medianStep = steps.find((s) => s.survival <= 0.5);
  return { steps, median: medianStep ? medianStep.t : null, n };
}

// Linear-interpolation-between-closest-ranks percentile (the common "R type 7" method).
// `sortedValues` must already be sorted ascending; `p` is 0-100.
export function percentile(sortedValues, p) {
  const n = sortedValues.length;
  if (n === 0) return null;
  if (n === 1) return sortedValues[0];
  const idx = (p / 100) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  const frac = idx - lo;
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * frac;
}

// Mean-rank percentile of `x` within `values` (0-100): the share of values below x, with values
// equal to x counted as half-below/half-above.
export function percentileRank(values, x) {
  const n = values.length;
  if (n === 0) return null;
  let below = 0;
  let equal = 0;
  for (const v of values) {
    if (v < x) below += 1;
    else if (v === x) equal += 1;
  }
  return ((below + equal / 2) / n) * 100;
}
