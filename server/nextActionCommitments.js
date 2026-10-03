// server/nextActionCommitments.js
// §6.3 honesty ledger. claims.next_action / claims.next_action_date are a mutable pair; PATCHing
// them overwrites the prior promise with nothing recording it. This module is the append-only
// ledger (migrations/018_next_action_commitments.sql) that PATCH /api/claims/:id writes to
// alongside the columns, plus the read model the ledger surfaces are computed from.
//
// THE HONESTY RULE FOR THIS FILE. Prospect can observe that an open commitment was cleared. It
// cannot observe whether it was cleared because David did the thing or because he gave up on it —
// nothing in the write path distinguishes those. So this ledger never reports a "completed" or a
// "completion rate". It reports exactly what the record supports: promises made, how often they
// were revised while still open, how far the due date slipped when it moved, and whether a
// commitment was cleared before or after the date it was due. A ledger that inferred completion
// from a cleared field would be the flattering fiction §6.3 exists to remove.

export const COMMITMENT_EVENTS = Object.freeze(['promised', 'revised', 'cleared']);

function normalizeText(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

// A commitment is "open" when there is action text. A bare next_action_date with no action is not a
// promise — there is nothing promised — so it is deliberately not treated as one.
function isOpen(action) {
  return normalizeText(action) != null;
}

// classifyCommitmentChange({previous, next}) -> 'promised' | 'revised' | 'cleared' | null
// null means nothing worth recording: the pair is unchanged, or it moved between two closed states.
export function classifyCommitmentChange(previous, next) {
  const prevAction = normalizeText(previous.action);
  const prevDue = normalizeText(previous.due_date);
  const nextAction = normalizeText(next.action);
  const nextDue = normalizeText(next.due_date);

  const wasOpen = isOpen(prevAction);
  const nowOpen = isOpen(nextAction);

  if (!wasOpen && !nowOpen) return null;
  if (!wasOpen && nowOpen) return 'promised';
  if (wasOpen && !nowOpen) return 'cleared';
  if (prevAction === nextAction && prevDue === nextDue) return null;
  return 'revised';
}

// Records the change iff it is one of the three meaningful transitions above. Runs inside the
// caller's own transaction -- this function opens none of its own (same contract as
// server/resumeVersionSends.js#recordResumeVersionSend).
export function recordNextActionChange(db, claimId, previous, next) {
  const event = classifyCommitmentChange(previous, next);
  if (!event) return null;

  const info = db.prepare(`
    INSERT INTO next_action_commitments (claim_id, event, action, due_date, prev_action, prev_due_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    claimId,
    event,
    normalizeText(next.action),
    normalizeText(next.due_date),
    normalizeText(previous.action),
    normalizeText(previous.due_date),
  );
  return db.prepare('SELECT * FROM next_action_commitments WHERE id = ?').get(info.lastInsertRowid);
}

function dayDistance(fromDate, toDate) {
  if (!fromDate || !toDate) return null;
  const from = Date.parse(`${String(fromDate).slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${String(toDate).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// computeHonestyLedger(db, {today}) -> ledger object. All-SELECT. Degrades to an empty, explicitly
// unavailable ledger on a pre-018 database rather than throwing, mirroring jobFamilyReport.js's
// feature-detect so the whole Hunt Report survives an unmigrated db.
export function computeHonestyLedger(db, { today = new Date().toISOString().slice(0, 10) } = {}) {
  let rows;
  try {
    rows = db.prepare(`
      SELECT id, claim_id, event, action, due_date, prev_action, prev_due_date, recorded_at
      FROM next_action_commitments ORDER BY recorded_at ASC, id ASC
    `).all();
  } catch {
    return {
      available: false,
      recording_since: null,
      totals: { promised: 0, revised: 0, cleared: 0 },
      slip: { moved_count: 0, total_days: 0, median_days: null },
      cleared_timing: { before_or_on_due: 0, after_due: 0, no_due_date: 0 },
      open: { count: 0, overdue: 0, claims: [] },
      claims: [],
    };
  }

  const totals = { promised: 0, revised: 0, cleared: 0 };
  const slipDays = [];
  const clearedTiming = { before_or_on_due: 0, after_due: 0, no_due_date: 0 };
  const byClaim = new Map();

  for (const row of rows) {
    if (totals[row.event] != null) totals[row.event] += 1;

    if (!byClaim.has(row.claim_id)) {
      byClaim.set(row.claim_id, { claim_id: row.claim_id, promised: 0, revised: 0, cleared: 0, slip_days: 0 });
    }
    const claim = byClaim.get(row.claim_id);
    if (claim[row.event] != null) claim[row.event] += 1;

    // A revision only "slips" when the due date moved LATER. Pulling a date earlier is a
    // commitment tightened, not a goalpost moved, and is not counted as slip.
    if (row.event === 'revised') {
      const moved = dayDistance(row.prev_due_date, row.due_date);
      if (moved != null && moved > 0) {
        slipDays.push(moved);
        claim.slip_days += moved;
      }
    }

    if (row.event === 'cleared') {
      const due = row.prev_due_date;
      if (!due) clearedTiming.no_due_date += 1;
      else {
        const distance = dayDistance(due, String(row.recorded_at).slice(0, 10));
        if (distance == null) clearedTiming.no_due_date += 1;
        else if (distance > 0) clearedTiming.after_due += 1;
        else clearedTiming.before_or_on_due += 1;
      }
    }
  }

  // Open commitments are read from the live columns, not replayed from the ledger: the columns are
  // authoritative for "right now", and a database migrated mid-hunt has open promises that predate
  // the ledger entirely. Counting those honestly requires the columns.
  const openRows = db.prepare(`
    SELECT c.id AS claim_id, c.next_action, c.next_action_date, l.company, l.role
    FROM claims c LEFT JOIN listings l ON l.id = c.listing_id
    WHERE c.next_action IS NOT NULL AND trim(c.next_action) <> ''
    ORDER BY (c.next_action_date IS NULL), c.next_action_date ASC, c.id ASC
  `).all();

  const open = openRows.map((row) => {
    const distance = dayDistance(today, row.next_action_date);
    return {
      claim_id: row.claim_id,
      company: row.company,
      role: row.role,
      action: row.next_action,
      due_date: row.next_action_date,
      days_until_due: distance,
      overdue: distance != null && distance < 0,
      revisions: byClaim.get(row.claim_id)?.revised || 0,
      slip_days: byClaim.get(row.claim_id)?.slip_days || 0,
    };
  });

  return {
    available: true,
    recording_since: rows.length ? rows[0].recorded_at : null,
    totals,
    slip: {
      moved_count: slipDays.length,
      total_days: slipDays.reduce((sum, value) => sum + value, 0),
      median_days: median(slipDays),
    },
    cleared_timing: clearedTiming,
    open: {
      count: open.length,
      overdue: open.filter((row) => row.overdue).length,
      claims: open,
    },
    claims: [...byClaim.values()].sort((a, b) => b.revised - a.revised || a.claim_id - b.claim_id),
  };
}
