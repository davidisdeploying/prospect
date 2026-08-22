export const DEADLINE_RESOLUTION_REASONS = Object.freeze([
  'completed',
  'no_longer_required',
  'superseded',
]);

const RESOLUTION_REASON_SET = new Set(DEADLINE_RESOLUTION_REASONS);

export function parseClaimEventPayload(payload) {
  if (!payload) return null;
  if (typeof payload === 'object' && !Array.isArray(payload)) return payload;
  try {
    const parsed = JSON.parse(String(payload));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function getResolvedDeadlineIds(events) {
  const rows = Array.isArray(events) ? events : [];
  const eventById = new Map(rows.map((event) => [Number(event.id), event]));
  const resolved = new Set();

  for (const event of rows) {
    if (event.kind !== 'deadline_resolved') continue;
    const payload = parseClaimEventPayload(event.payload);
    const targetId = Number(payload?.resolved_event_id);
    const target = eventById.get(targetId);
    if (
      Number.isInteger(targetId)
      && targetId > 0
      && target
      && Number(target.claim_id) === Number(event.claim_id)
      && target.kind !== 'deadline_resolved'
      && String(target.due_at || '').trim()
    ) {
      resolved.add(targetId);
    }
  }
  return resolved;
}

export function annotateClaimEvents(events) {
  const rows = Array.isArray(events) ? events : [];
  const eventById = new Map(rows.map((event) => [Number(event.id), event]));
  const resolutionByTarget = new Map();

  for (const event of rows) {
    if (event.kind !== 'deadline_resolved') continue;
    const payload = parseClaimEventPayload(event.payload);
    const targetId = Number(payload?.resolved_event_id);
    const target = eventById.get(targetId);
    if (
      !Number.isInteger(targetId)
      || targetId <= 0
      || !target
      || Number(target.claim_id) !== Number(event.claim_id)
      || target.kind === 'deadline_resolved'
      || !String(target.due_at || '').trim()
    ) continue;

    if (!resolutionByTarget.has(targetId)) {
      resolutionByTarget.set(targetId, {
        event_id: event.id,
        occurred_at: event.occurred_at,
        reason: payload.resolution_reason,
        note: typeof payload.note === 'string' ? payload.note : null,
      });
    }
  }

  return rows.map((event) => ({
    ...event,
    resolution: resolutionByTarget.get(Number(event.id)) || null,
  }));
}

export function resolveDeadlineEvent(db, {
  claimId,
  eventId,
  reason,
  note = null,
}) {
  const numericClaimId = Number(claimId);
  const numericEventId = Number(eventId);
  const normalizedReason = String(reason || '').trim();
  const normalizedNote = note == null ? '' : String(note).trim();

  if (!Number.isInteger(numericClaimId) || numericClaimId <= 0) {
    return { ok: false, status: 400, error: 'invalid claim id' };
  }
  if (!Number.isInteger(numericEventId) || numericEventId <= 0) {
    return { ok: false, status: 400, error: 'invalid event id' };
  }
  if (!RESOLUTION_REASON_SET.has(normalizedReason)) {
    return { ok: false, status: 400, error: `invalid resolution reason: ${normalizedReason}` };
  }
  if (normalizedNote.length > 1000) {
    return { ok: false, status: 400, error: 'resolution note must be 1000 characters or fewer' };
  }

  return db.transaction(() => {
    const target = db.prepare(`
      SELECT * FROM claim_events WHERE id = ? AND claim_id = ?
    `).get(numericEventId, numericClaimId);
    if (!target) return { ok: false, status: 404, error: 'deadline event not found' };
    if (target.kind === 'deadline_resolved' || !String(target.due_at || '').trim()) {
      return { ok: false, status: 409, error: 'event is not an unresolved deadline' };
    }

    const existing = db.prepare(`
      SELECT * FROM claim_events
      WHERE claim_id = ? AND kind = 'deadline_resolved'
      ORDER BY occurred_at, id
    `).all(numericClaimId).find((event) => {
      const payload = parseClaimEventPayload(event.payload);
      return Number(payload?.resolved_event_id) === numericEventId;
    });
    if (existing) {
      return { ok: true, created: false, event: existing, target };
    }

    const payload = JSON.stringify({
      resolved_event_id: numericEventId,
      resolution_reason: normalizedReason,
      ...(normalizedNote ? { note: normalizedNote } : {}),
    });
    const info = db.prepare(`
      INSERT INTO claim_events (claim_id, kind, payload)
      VALUES (?, 'deadline_resolved', ?)
    `).run(numericClaimId, payload);
    const event = db.prepare('SELECT * FROM claim_events WHERE id = ?').get(info.lastInsertRowid);
    return { ok: true, created: true, event, target };
  })();
}
