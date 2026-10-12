// §5.4 — calibrated fit score: the prediction ledger and the scorer that refuses to speak early.
//
// Almost every assertion here is about refusal. The section is explicitly a slow burn, so the
// dangerous failure is not "no score" — it is a confident score computed from four outcomes that
// David then makes real decisions against.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { loadVecExtension } from '../server/vecExtension.js';
import {
  recordPrediction, resolveOutcome, computeCalibration, cosineSimilarity,
  resumeCosinePrediction, MIN_CALIBRATION_N, PREDICTORS,
} from '../server/calibration.js';
import { deleteClaimById } from '../server/deleteClaim.js';

const schemaSql = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function addClaim(db, { stage = 'Staked', company = 'Acme' } = {}) {
  const listingId = db.prepare("INSERT INTO listings (source, company, role) VALUES ('test', ?, 'Support')")
    .run(company).lastInsertRowid;
  return db.prepare('INSERT INTO claims (listing_id, stage) VALUES (?, ?)').run(listingId, stage).lastInsertRowid;
}

function setStage(db, claimId, stage) {
  db.prepare('UPDATE claims SET stage = ? WHERE id = ?').run(stage, claimId);
}

test('an unresolved claim has no outcome, which is not the same as a failure', () => {
  assert.equal(resolveOutcome('Strike'), 1);
  assert.equal(resolveOutcome('Tailings'), 0);
  assert.equal(resolveOutcome('Staked'), null);
  assert.equal(resolveOutcome('Working the Vein'), null);
  assert.equal(resolveOutcome(null), null);
});

test('a forecast is logged with the stage it was made at', () => {
  const db = freshDb();
  try {
    const claimId = addClaim(db, { stage: 'Staked' });
    const row = recordPrediction(db, claimId, { predictor: 'gut', value: 0.4 });
    assert.equal(row.predictor, 'gut');
    assert.equal(row.value, 0.4);
    assert.equal(row.stage_at_prediction, 'Staked');
  } finally { db.close(); }
});

test('an unchanged re-save does not become a second forecast', () => {
  const db = freshDb();
  try {
    const claimId = addClaim(db);
    assert.ok(recordPrediction(db, claimId, { predictor: 'gut', value: 0.4 }));
    assert.equal(recordPrediction(db, claimId, { predictor: 'gut', value: 0.4 }), null);
    assert.ok(recordPrediction(db, claimId, { predictor: 'gut', value: 0.5 }));
    assert.equal(db.prepare('SELECT COUNT(*) FROM claim_predictions').pluck().get(), 2);
  } finally { db.close(); }
});

test('values are clamped to 0-1 and non-numbers are refused', () => {
  const db = freshDb();
  try {
    const claimId = addClaim(db);
    assert.equal(recordPrediction(db, claimId, { predictor: 'gut', value: 1.7 }).value, 1);
    assert.equal(recordPrediction(db, claimId, { predictor: 'gut', value: -3 }).value, 0);
    assert.equal(recordPrediction(db, claimId, { predictor: 'gut', value: 'nonsense' }), null);
    assert.throws(() => recordPrediction(db, claimId, { predictor: 'astrology', value: 0.5 }));
  } finally { db.close(); }
});

test('no score is reported below the minimum, and the shortfall is visible', () => {
  const db = freshDb();
  try {
    for (let i = 0; i < 4; i += 1) {
      const claimId = addClaim(db, { company: `Co ${i}` });
      recordPrediction(db, claimId, { predictor: 'gut', value: 0.5 });
      setStage(db, claimId, i % 2 ? 'Strike' : 'Tailings');
    }
    const { predictors, min_n } = computeCalibration(db);
    const gut = predictors.find((p) => p.predictor === 'gut');
    assert.equal(min_n, MIN_CALIBRATION_N);
    assert.equal(gut.resolved, 4);
    assert.equal(gut.sufficient, false);
    assert.equal(gut.brier, null, 'a Brier score over four outcomes is a random number');
    assert.deepEqual(gut.bins, []);
  } finally { db.close(); }
});

test('a sufficient sample is scored, and a perfect forecaster scores zero', () => {
  const db = freshDb();
  try {
    for (let i = 0; i < MIN_CALIBRATION_N; i += 1) {
      const claimId = addClaim(db, { company: `Co ${i}` });
      const willStrike = i % 2 === 0;
      recordPrediction(db, claimId, { predictor: 'gut', value: willStrike ? 1 : 0 });
      setStage(db, claimId, willStrike ? 'Strike' : 'Tailings');
    }
    const gut = computeCalibration(db).predictors.find((p) => p.predictor === 'gut');
    assert.equal(gut.sufficient, true);
    assert.equal(gut.brier, 0, 'perfect forecasts score 0');
    assert.equal(gut.baseline_brier, 0.25);
    assert.ok(gut.bins.length >= 2);
  } finally { db.close(); }
});

test('a flat coin-flip forecaster scores the stated baseline', () => {
  const db = freshDb();
  try {
    for (let i = 0; i < MIN_CALIBRATION_N; i += 1) {
      const claimId = addClaim(db, { company: `Co ${i}` });
      recordPrediction(db, claimId, { predictor: 'gut', value: 0.5 });
      setStage(db, claimId, i % 2 ? 'Strike' : 'Tailings');
    }
    const gut = computeCalibration(db).predictors.find((p) => p.predictor === 'gut');
    assert.equal(gut.brier, 0.25);
  } finally { db.close(); }
});

test('unresolved claims are censored, never counted as failures', () => {
  const db = freshDb();
  try {
    const resolved = addClaim(db, { company: 'Done' });
    recordPrediction(db, resolved, { predictor: 'gut', value: 0.9 });
    setStage(db, resolved, 'Strike');

    const running = addClaim(db, { company: 'Running', stage: 'Working the Vein' });
    recordPrediction(db, running, { predictor: 'gut', value: 0.9 });

    const gut = computeCalibration(db).predictors.find((p) => p.predictor === 'gut');
    assert.equal(gut.claims_with_prediction, 2);
    assert.equal(gut.resolved, 1);
    assert.equal(gut.censored, 1, 'still running is not a miss');
  } finally { db.close(); }
});

test('a forecast entered after the outcome was known is discarded', () => {
  const db = freshDb();
  try {
    const claimId = addClaim(db, { stage: 'Staked' });
    recordPrediction(db, claimId, { predictor: 'gut', value: 0.2 }); // genuine forecast
    setStage(db, claimId, 'Strike');
    recordPrediction(db, claimId, { predictor: 'gut', value: 0.95 }); // hindsight

    const gut = computeCalibration(db).predictors.find((p) => p.predictor === 'gut');
    assert.equal(gut.discarded_post_hoc, 1);
    assert.equal(gut.claims_with_prediction, 1);
    assert.equal(gut.predictions_logged, 2, 'the hindsight entry is kept on the record, just not scored');
  } finally { db.close(); }
});

test('cosine similarity refuses mismatched or empty vectors', () => {
  const a = new Float32Array([1, 0, 0]);
  const b = new Float32Array([1, 0, 0]);
  const c = new Float32Array([0, 1, 0]);
  assert.ok(Math.abs(cosineSimilarity(a, b) - 1) < 1e-6);
  assert.ok(Math.abs(cosineSimilarity(a, c)) < 1e-6);
  assert.equal(cosineSimilarity(a, new Float32Array([1, 0])), null);
  assert.equal(cosineSimilarity(new Float32Array([]), new Float32Array([])), null);
  assert.equal(cosineSimilarity(a, new Float32Array([0, 0, 0])), null, 'a zero vector has no direction');
});

test('resume cosine produces nothing rather than a guess when inputs are missing', async () => {
  const db = freshDb();
  try {
    const claimId = addClaim(db);
    // No résumé version at all.
    assert.equal(await resumeCosinePrediction(db, claimId, { embedDocument: async () => new Float32Array(768) }), null);

    // Résumé text present, but the listing was never embedded.
    const rv = db.prepare("INSERT INTO resume_versions (label, body) VALUES ('v1', 'years of support experience')").run().lastInsertRowid;
    db.prepare('UPDATE claims SET resume_version_id = ? WHERE id = ?').run(rv, claimId);
    assert.equal(await resumeCosinePrediction(db, claimId, { embedDocument: async () => new Float32Array(768) }), null);

    // Embedding service unreachable.
    const listingId = db.prepare('SELECT listing_id FROM claims WHERE id = ?').pluck().get(claimId);
    const vector = new Float32Array(768).fill(0.1);
    db.prepare('INSERT INTO listings_vec (listing_id, embedding) VALUES (?, ?)')
      .run(BigInt(listingId), Buffer.from(vector.buffer));
    assert.equal(await resumeCosinePrediction(db, claimId, { embedDocument: async () => { throw new Error('down'); } }), null);

    // Everything present: a prediction is recorded, with the raw measurement kept.
    const row = await resumeCosinePrediction(db, claimId, { embedDocument: async () => Buffer.from(vector.buffer) });
    assert.ok(row);
    assert.equal(row.predictor, 'resume_cosine');
    assert.ok(Math.abs(row.value_raw - 1) < 1e-5, 'identical vectors are cosine 1');
  } finally { db.close(); }
});

test('the evidence plan is stated rather than implied', () => {
  const db = freshDb();
  try {
    const { evidence_plan: plan } = computeCalibration(db);
    for (const key of ['outcome', 'prediction_validity', 'minimum', 'scoring']) {
      assert.ok(plan[key] && plan[key].length > 20, `evidence plan must state ${key}`);
    }
    assert.ok(plan.minimum.includes(String(MIN_CALIBRATION_N)));
    assert.deepEqual(PREDICTORS, ['gut', 'scout_fit', 'resume_cosine']);
  } finally { db.close(); }
});

test('hard delete cascades the prediction ledger', () => {
  const db = freshDb();
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-calib-'));
  try {
    const claimId = addClaim(db);
    recordPrediction(db, claimId, { predictor: 'gut', value: 0.5 });
    const result = deleteClaimById(db, claimId, backupDir);
    assert.equal(db.prepare('SELECT COUNT(*) FROM claim_predictions').pluck().get(), 0);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(JSON.parse(fs.readFileSync(result.backup_path, 'utf8')).claim_predictions.length, 1);
  } finally {
    db.close();
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});
