// server/liveness.js — §6.3 deterministic dead-listing liveness check. All-SELECT, and network-free
// BY CONSTRUCTION: this module never fetches a posting to see whether it still resolves. Prospect's
// capture is user-initiated and "no crawler is allowed" (prospect-vault/AGENTS.md), and a liveness
// checker that quietly polls every tracked posting is a crawler no matter what the section is
// called. Everything below is inferred from evidence Prospect already holds.
//
// The §6.7 scoping lock draws the line this file sits on: "§6.3's deterministic dead-listing check
// calls what it can; §6.7 judges only the residue it cannot." So every claim gets one of four
// verdicts, and each verdict is explicitly marked decided or residue. The residue set is this
// module's real output contract -- §6.7.3 consumes it and must never re-derive it, or the two layers
// can disagree about which claims are even in question.
//
//   closed_by_record  DECIDED, dead  -- the claim's own record says so (Tailings, or an outcome
//                                       reason recorded). Not an inference at all.
//   closed_by_vendor  DECIDED, dead  -- the EMPLOYER's own tracker reports a terminal state
//                                     (§3.5b). Distinct from closed_by_record on purpose: that is
//                                     David's record of the outcome, this is the employer's, and
//                                     §3.5b's invariant is that the two are never merged. It is
//                                     decided because a portal saying "no longer under
//                                     consideration" is not ambiguous about the application.
//   live_sighted      DECIDED, live  -- a linked Scout discovery was seen in an alert within
//                                       SIGHTING_FRESH_DAYS. The employer is still advertising it.
//   sighting_lapsed   RESIDUE        -- a linked discovery exists but has not been seen in
//                                       SIGHTING_LAPSE_DAYS. Suggestive, NOT conclusive: LinkedIn
//                                       alert mail is a filtered digest, not a liveness feed, and a
//                                       live posting can simply stop matching the alert profile.
//   unobservable      RESIDUE        -- no linked discovery at all (most captures are hand-staked
//                                       from a URL and never appeared in an alert). Prospect holds
//                                       no liveness signal whatsoever. Saying anything stronger
//                                       than "unobservable" here would be inventing evidence.
//
// Thresholds are deliberately conservative and overridable, because the honest default for an
// ambiguous signal is to widen the residue rather than to guess.

import { TERMINAL_VENDOR_STATUSES } from './vendorStatus.js';

export const SIGHTING_FRESH_DAYS = Number(process.env.PROSPECT_LIVENESS_FRESH_DAYS || 7);
export const SIGHTING_LAPSE_DAYS = Number(process.env.PROSPECT_LIVENESS_LAPSE_DAYS || 21);

export const LIVENESS_VERDICTS = Object.freeze({
  closed_by_record: { decided: true, live: false, gloss: 'Closed by record' },
  closed_by_vendor: { decided: true, live: false, gloss: "Closed by employer's tracker" },
  live_sighted: { decided: true, live: true, gloss: 'Seen in a recent alert' },
  sighting_lapsed: { decided: false, live: null, gloss: 'Alert sightings lapsed' },
  unobservable: { decided: false, live: null, gloss: 'No liveness signal held' },
});

function daysSince(iso, nowMs) {
  if (!iso) return null;
  const then = Date.parse(String(iso).length <= 10 ? `${iso}T00:00:00Z` : String(iso).replace(' ', 'T') + 'Z');
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((nowMs - then) / 86_400_000));
}

// computeLiveness(db, {now}) -> {generated_at, thresholds, counts, decided, residue, claims}
// Degrades to an empty assessment rather than throwing if the Scout tables are absent (a database
// below migration 014), mirroring jobFamilyReport.js's feature-detect posture.
export function computeLiveness(db, { now = new Date() } = {}) {
  const nowMs = now.getTime();

  const claims = db.prepare(`
    SELECT
      c.id AS claim_id, c.stage, c.outcome_reason, c.created_at, c.updated_at, c.stage_entered_at,
      l.id AS listing_id, l.company, l.role, l.captured_at, l.posted_at, l.source_url,
      l.external_job_id, l.job_id, l.snapshot_generation
    FROM claims c LEFT JOIN listings l ON l.id = c.listing_id
    ORDER BY c.id ASC
  `).all();

  // One pass over Scout, keyed three ways, so the join below is pure lookup. A discovery is linked
  // to a claim explicitly (linked_claim_id, set when a discovery is staked) or, for claims captured
  // by hand that later showed up in an alert, by matching external job id.
  const byClaimId = new Map();
  const byExternalJobId = new Map();
  try {
    const discoveries = db.prepare(`
      SELECT id, linked_claim_id, external_job_id, status, first_seen_at, last_seen_at,
             (SELECT COUNT(*) FROM scout_sightings s WHERE s.discovery_id = d.id) AS sighting_count
      FROM scout_discoveries d
    `).all();
    for (const row of discoveries) {
      if (row.linked_claim_id != null) byClaimId.set(Number(row.linked_claim_id), row);
      const key = String(row.external_job_id || '').trim();
      if (key) byExternalJobId.set(key, row);
    }
  } catch {
    // pre-014 database: no Scout tables. Every claim falls through to `unobservable`, which is the
    // truthful verdict -- there is genuinely no liveness signal held.
  }

  // §3.5b: latest normalized vendor status per claim. Absent table (pre-022) simply yields none.
  const terminalVendorClaims = new Map();
  try {
    const latest = db.prepare(`
      SELECT o.claim_id, o.normalized_status, o.status_text, o.vendor, o.observed_at
      FROM vendor_status_observations o
      WHERE o.id = (
        SELECT o2.id FROM vendor_status_observations o2
        WHERE o2.claim_id = o.claim_id ORDER BY o2.observed_at DESC, o2.id DESC LIMIT 1
      )
    `).all();
    for (const row of latest) {
      if (TERMINAL_VENDOR_STATUSES.includes(row.normalized_status)) {
        terminalVendorClaims.set(Number(row.claim_id), row);
      }
    }
  } catch {
    // pre-022 database: no vendor observations held.
  }

  const activity = new Map();
  const recordActivity = (claimId, iso) => {
    if (!iso) return;
    const current = activity.get(claimId);
    if (!current || String(iso) > String(current)) activity.set(claimId, iso);
  };
  for (const row of db.prepare('SELECT claim_id, transitioned_at FROM stage_transitions').all()) {
    recordActivity(Number(row.claim_id), row.transitioned_at);
  }
  for (const row of db.prepare('SELECT claim_id, occurred_at FROM claim_events').all()) {
    recordActivity(Number(row.claim_id), row.occurred_at);
  }
  for (const row of db.prepare('SELECT claim_id, created_at FROM claim_notes').all()) {
    recordActivity(Number(row.claim_id), row.created_at);
  }

  const assessed = claims.map((claim) => {
    const discovery = byClaimId.get(Number(claim.claim_id))
      || (claim.external_job_id ? byExternalJobId.get(String(claim.external_job_id).trim()) : null)
      || (claim.job_id ? byExternalJobId.get(String(claim.job_id).trim()) : null);

    const daysSinceSighting = daysSince(discovery?.last_seen_at, nowMs);
    const lastActivity = activity.get(Number(claim.claim_id)) || claim.updated_at || claim.created_at;

    const vendorTerminal = terminalVendorClaims.get(Number(claim.claim_id)) || null;

    let verdict;
    // David's own record wins the label when both exist -- he closed it himself, and the
    // employer's echo of that is not new information.
    if (claim.stage === 'Tailings' || claim.outcome_reason) verdict = 'closed_by_record';
    else if (vendorTerminal) verdict = 'closed_by_vendor';
    else if (!discovery) verdict = 'unobservable';
    else if (daysSinceSighting == null) verdict = 'unobservable';
    else if (daysSinceSighting <= SIGHTING_FRESH_DAYS) verdict = 'live_sighted';
    else if (daysSinceSighting >= SIGHTING_LAPSE_DAYS) verdict = 'sighting_lapsed';
    else verdict = 'live_sighted';

    const meta = LIVENESS_VERDICTS[verdict];
    return {
      claim_id: claim.claim_id,
      listing_id: claim.listing_id,
      company: claim.company,
      role: claim.role,
      stage: claim.stage,
      verdict,
      decided: meta.decided,
      live: meta.live,
      residue: !meta.decided,
      // Evidence is carried on every row, decided or not, so §6.7.3 can judge the residue from this
      // payload alone instead of re-querying (and possibly re-deriving a different residue set).
      evidence: {
        outcome_reason: claim.outcome_reason || null,
        days_since_capture: daysSince(claim.captured_at, nowMs),
        days_since_activity: daysSince(lastActivity, nowMs),
        snapshot_generation: claim.snapshot_generation ?? null,
        discovery_id: discovery?.id ?? null,
        discovery_status: discovery?.status ?? null,
        discovery_sighting_count: discovery?.sighting_count ?? null,
        days_since_last_sighting: daysSinceSighting,
        vendor_status: vendorTerminal ? vendorTerminal.normalized_status : null,
        vendor_status_text: vendorTerminal ? vendorTerminal.status_text : null,
        vendor: vendorTerminal ? vendorTerminal.vendor : null,
      },
    };
  });

  const counts = { closed_by_record: 0, closed_by_vendor: 0, live_sighted: 0, sighting_lapsed: 0, unobservable: 0 };
  for (const row of assessed) counts[row.verdict] += 1;

  return {
    generated_at: now.toISOString(),
    thresholds: { fresh_days: SIGHTING_FRESH_DAYS, lapse_days: SIGHTING_LAPSE_DAYS },
    counts,
    decided: assessed.filter((row) => row.decided),
    residue: assessed.filter((row) => row.residue),
    claims: assessed,
  };
}
