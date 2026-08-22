import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import { loadVecExtension } from '../server/vecExtension.js';
import {
  annotateClaimEvents,
  getResolvedDeadlineIds,
  resolveDeadlineEvent,
} from '../server/claimEvents.js';

const schemaSql = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function seedClaim(db) {
  const listingId = db.prepare(`
    INSERT INTO listings (source, company, role) VALUES ('test', 'Resolve Co', 'Technician')
  `).run().lastInsertRowid;
  return db.prepare(`
    INSERT INTO claims (listing_id, stage) VALUES (?, 'Staked')
  `).run(listingId).lastInsertRowid;
}

test('deadline resolution appends a separate event and is idempotent', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db);
    const eventId = db.prepare(`
      INSERT INTO claim_events (claim_id, kind, due_at, payload)
      VALUES (?, 'recruiter_contact', '2026-08-01', '{"note":"Call back"}')
    `).run(claimId).lastInsertRowid;

    const first = resolveDeadlineEvent(db, {
      claimId, eventId, reason: 'completed', note: 'Spoke with recruiter',
    });
    const second = resolveDeadlineEvent(db, {
      claimId, eventId, reason: 'superseded',
    });

    assert.equal(first.ok, true);
    assert.equal(first.created, true);
    assert.equal(second.ok, true);
    assert.equal(second.created, false);
    assert.equal(second.event.id, first.event.id);
    assert.equal(db.prepare('SELECT count(*) FROM claim_events').pluck().get(), 2);

    const original = db.prepare('SELECT * FROM claim_events WHERE id = ?').get(eventId);
    assert.equal(original.kind, 'recruiter_contact');
    assert.equal(original.due_at, '2026-08-01');
    assert.equal(original.payload, '{"note":"Call back"}');

    const events = db.prepare('SELECT * FROM claim_events ORDER BY id').all();
    assert.deepEqual([...getResolvedDeadlineIds(events)], [eventId]);
    const annotated = annotateClaimEvents(events);
    assert.equal(annotated[0].resolution.reason, 'completed');
    assert.equal(annotated[0].resolution.note, 'Spoke with recruiter');
    assert.equal(annotated[1].kind, 'deadline_resolved');
  } finally {
    db.close();
  }
});

test('resolution rejects invalid targets, reasons, and cross-claim references', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db);
    const otherClaimId = seedClaim(db);
    const eventId = db.prepare(`
      INSERT INTO claim_events (claim_id, kind, due_at)
      VALUES (?, 'status_check', '2026-08-02')
    `).run(claimId).lastInsertRowid;
    const noDueId = db.prepare(`
      INSERT INTO claim_events (claim_id, kind) VALUES (?, 'employer_email')
    `).run(claimId).lastInsertRowid;

    assert.equal(resolveDeadlineEvent(db, {
      claimId, eventId, reason: 'unknown',
    }).status, 400);
    assert.equal(resolveDeadlineEvent(db, {
      claimId: otherClaimId, eventId, reason: 'completed',
    }).status, 404);
    assert.equal(resolveDeadlineEvent(db, {
      claimId, eventId: noDueId, reason: 'completed',
    }).status, 409);
    assert.equal(db.prepare("SELECT count(*) FROM claim_events WHERE kind='deadline_resolved'").pluck().get(), 0);
  } finally {
    db.close();
  }
});
