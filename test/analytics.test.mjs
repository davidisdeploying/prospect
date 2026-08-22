import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  competitionRateBucket,
  applyFreshnessBucket,
  kaplanMeier,
  percentile,
  percentileRank,
} from '../server/analytics.js';

test('competitionRateBucket: exact boundary edges (10, 50)', () => {
  assert.equal(competitionRateBucket(null), null);
  assert.equal(competitionRateBucket(undefined), null);
  assert.equal(competitionRateBucket(9.99), 'Low');
  assert.equal(competitionRateBucket(10), 'Medium');
  assert.equal(competitionRateBucket(50), 'Medium');
  assert.equal(competitionRateBucket(50.01), 'High');
});

test('applyFreshnessBucket: exact boundary edges (2, 7)', () => {
  assert.equal(applyFreshnessBucket(null), null);
  assert.equal(applyFreshnessBucket(0), 'Fresh');
  assert.equal(applyFreshnessBucket(2), 'Fresh');
  assert.equal(applyFreshnessBucket(3), 'Recent');
  assert.equal(applyFreshnessBucket(7), 'Recent');
  assert.equal(applyFreshnessBucket(8), 'Stale');
});

test('percentileRank: hand-computed against a small sorted array', () => {
  const values = [10, 20, 30, 40, 50];
  assert.equal(percentileRank(values, 10), 10); // 0 below, 1 equal -> (0 + 0.5)/5*100
  assert.equal(percentileRank(values, 30), 50); // 2 below, 1 equal -> (2 + 0.5)/5*100
  assert.equal(percentileRank(values, 50), 90); // 4 below, 1 equal -> (4 + 0.5)/5*100
  assert.equal(percentileRank([], 5), null);
});

test('percentile: median/quartiles on a hand-computed sorted array', () => {
  const sorted = [10, 20, 30, 40, 50];
  assert.equal(percentile(sorted, 50), 30);
  assert.equal(percentile(sorted, 0), 10);
  assert.equal(percentile(sorted, 100), 50);
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([42], 50), 42);
});

// Hand-computed KM fixture, 5 subjects:
//   durations/events: (1,1) (2,1) (3,0 censored) (4,1) (5,0 censored)
// Step-by-step (n=5 at risk initially):
//   t=1: atRisk=5, events=1 -> survival = 1 * (1 - 1/5) = 0.8
//   t=2: atRisk=4, events=1 -> survival = 0.8 * (1 - 1/4) = 0.6
//   t=3: atRisk=3, events=0, censored=1 -> survival stays 0.6
//   t=4: atRisk=2, events=1 -> survival = 0.6 * (1 - 1/2) = 0.3
//   t=5: atRisk=1, events=0, censored=1 -> survival stays 0.3
// Median = first t where survival <= 0.5 -> t=4.
test('kaplanMeier: hand-computed survival steps including a censored observation', () => {
  const observations = [
    { duration: 1, event: 1 },
    { duration: 2, event: 1 },
    { duration: 3, event: 0 },
    { duration: 4, event: 1 },
    { duration: 5, event: 0 },
  ];
  const { steps, median, n } = kaplanMeier(observations);
  assert.equal(n, 5);
  assert.equal(steps.length, 5);

  const rounded = steps.map((s) => ({ ...s, survival: Math.round(s.survival * 1e6) / 1e6 }));
  assert.deepEqual(rounded[0], { t: 1, atRisk: 5, events: 1, censored: 0, survival: 0.8 });
  assert.deepEqual(rounded[1], { t: 2, atRisk: 4, events: 1, censored: 0, survival: 0.6 });
  assert.deepEqual(rounded[2], { t: 3, atRisk: 3, events: 0, censored: 1, survival: 0.6 });
  assert.deepEqual(rounded[3], { t: 4, atRisk: 2, events: 1, censored: 0, survival: 0.3 });
  assert.deepEqual(rounded[4], { t: 5, atRisk: 1, events: 0, censored: 1, survival: 0.3 });

  assert.equal(median, 4);
});

test('kaplanMeier: empty input', () => {
  assert.deepEqual(kaplanMeier([]), { steps: [], median: null, n: 0 });
});

test('kaplanMeier: all-censored input never crosses 0.5, median null', () => {
  const { median, steps, n } = kaplanMeier([{ duration: 1, event: 0 }, { duration: 2, event: 0 }]);
  assert.equal(median, null);
  assert.equal(n, 2);
  assert.equal(steps[steps.length - 1].survival, 1);
});
