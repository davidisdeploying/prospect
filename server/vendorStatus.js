// server/vendorStatus.js — §3.5b external vendor-status observations and the tracker adapters that
// normalize them.
//
// THE RULE THIS WHOLE FILE IS BUILT AROUND: employer-claimed status is not David's stage. An
// employer portal reporting "no longer under consideration" is a fact about what that portal is
// displaying. David's stage is his own record. They disagree, and the disagreement is the valuable
// part — a portal stuck on "submitted" for six weeks says something no stage log can. So nothing
// here writes claims.stage, ever, and divergence is reported rather than resolved.
//
// The adapters are deterministic phrase matching, not a model. They are also deliberately timid:
// an unrecognized phrase normalizes to null rather than to the nearest bucket, because a wrong
// normalization here means silently declaring a live application dead. The verbatim status_text is
// always kept, so a phrase this file fails to recognize today is still recoverable later.

export const VENDORS = Object.freeze([
  'workday', 'greenhouse', 'lever', 'icims', 'taleo', 'smartrecruiters', 'ashby', 'amazon', 'other',
]);

// The normalized vocabulary. Terminal states are the ones that mean this application is over.
export const VENDOR_STATUSES = Object.freeze([
  'submitted', 'in_review', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn', 'closed', 'expired',
]);

export const TERMINAL_VENDOR_STATUSES = Object.freeze(['rejected', 'withdrawn', 'closed', 'expired']);

export function isTerminalVendorStatus(status) {
  return TERMINAL_VENDOR_STATUSES.includes(status);
}

// detectVendor(url) -> vendor slug | null. Host-based, so a URL Prospect has never seen returns null
// instead of a guess.
const VENDOR_HOST_PATTERNS = [
  [/myworkdayjobs\.com|workday\.com/i, 'workday'],
  [/greenhouse\.io/i, 'greenhouse'],
  [/lever\.co/i, 'lever'],
  [/icims\.com/i, 'icims'],
  [/taleo\.net/i, 'taleo'],
  [/smartrecruiters\.com/i, 'smartrecruiters'],
  [/ashbyhq\.com/i, 'ashby'],
  [/amazon\.jobs|hiring\.amazon\.com/i, 'amazon'],
];

export function detectVendor(url) {
  if (!url) return null;
  let host;
  try { host = new URL(String(url)).host; } catch { return null; }
  for (const [pattern, vendor] of VENDOR_HOST_PATTERNS) {
    if (pattern.test(host)) return vendor;
  }
  return null;
}

// Phrase table. Ordered most-specific first within each status, and matched against a normalized
// (lowercased, whitespace-collapsed) copy of the employer's wording.
//
// These phrases come from what employer portals actually display. "Assessment expired" is here
// because it is the exact string that killed an Amazon application silently on 2026-07-18 — the
// motivating case for this whole section.
const STATUS_PHRASES = [
  ['expired', [
    'assessment expired', 'application expired', 'expired', 'deadline passed', 'no longer available',
  ]],
  ['rejected', [
    'no longer under consideration', 'not selected', 'not moving forward', 'not proceeding',
    'unfortunately', 'we have decided to move forward with other candidates', 'rejected',
    'position filled by another candidate',
  ]],
  ['withdrawn', ['withdrawn', 'you withdrew', 'application withdrawn']],
  ['closed', [
    // The exact banner LinkedIn renders on a posting that has stopped taking applications.
    // Listed before the bare 'closed' so the specific phrasing is what gets matched and reported.
    // 'this job is no longer available' is deliberately NOT listed: it already matches the
    // 'expired' bucket via 'no longer available', which is equally terminal, and duplicating it
    // here would only shadow an existing rule with a near-identical one.
    'no longer accepting applications', 'applications are closed',
    'position closed', 'req closed', 'requisition closed', 'posting closed', 'closed',
  ]],
  ['offer', ['offer extended', 'offer', 'congratulations']],
  ['interview', ['interview scheduled', 'interviewing', 'interview']],
  ['assessment', ['assessment requested', 'assessment pending', 'take home', 'assessment']],
  ['in_review', [
    'under review', 'in review', 'application under consideration', 'reviewed by recruiter',
    'in progress', 'active',
  ]],
  ['submitted', ['application submitted', 'submitted', 'received', 'application received']],
];

// normalizeVendorStatus(statusText, {vendor}) -> {status, matched_phrase, normalized_by} | null
// Returns null for anything unrecognized. Callers must treat null as "unknown", never as "fine".
export function normalizeVendorStatus(statusText, { vendor = null } = {}) {
  const text = String(statusText || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return null;
  for (const [status, phrases] of STATUS_PHRASES) {
    for (const phrase of phrases) {
      if (text.includes(phrase)) {
        return { status, matched_phrase: phrase, normalized_by: `phrase:${vendor || 'generic'}` };
      }
    }
  }
  return null;
}

// recordObservation(db, claimId, {...}) -> the inserted row.
// Normalization happens here so every write path gets the same adapter, and provenance is always
// recorded alongside the derived value.
export function recordObservation(db, claimId, { statusText, vendor = null, sourceUrl = null, note = null, observedAt = null }) {
  const text = String(statusText || '').trim();
  if (!text) throw new Error('status_text is required');

  const claim = db.prepare('SELECT id, vendor_tracker_url FROM claims WHERE id = ?').get(claimId);
  if (!claim) return null;

  // Vendor is taken as given, else inferred from the URL supplied, else from the claim's recorded
  // tracker URL. Each step can fail to null -- an unknown vendor is fine and does not block the
  // observation, which is the actual evidence.
  const resolvedVendor = vendor
    || detectVendor(sourceUrl)
    || detectVendor(claim.vendor_tracker_url);

  const normalized = normalizeVendorStatus(text, { vendor: resolvedVendor });

  const info = db.prepare(`
    INSERT INTO vendor_status_observations
      (claim_id, vendor, status_text, normalized_status, normalized_by, source_url, note, observed_at)
    VALUES (@claim_id, @vendor, @status_text, @normalized_status, @normalized_by, @source_url, @note,
            COALESCE(@observed_at, datetime('now')))
  `).run({
    claim_id: claimId,
    vendor: resolvedVendor,
    status_text: text,
    normalized_status: normalized?.status ?? null,
    normalized_by: normalized?.normalized_by ?? null,
    source_url: sourceUrl ?? claim.vendor_tracker_url ?? null,
    note,
    observed_at: observedAt,
  });
  return db.prepare('SELECT * FROM vendor_status_observations WHERE id = ?').get(info.lastInsertRowid);
}

const ACTIVE_STAGES = new Set(['Showings', 'Staked', 'Working the Vein', 'Strike']);

// computeVendorStatus(db) -> {available, claims, divergences, totals}
// Degrades to an explicitly unavailable shape on a pre-022 database rather than throwing.
export function computeVendorStatus(db) {
  const missing = db.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='vendor_status_observations'"
  ).get().n === 0;
  if (missing) {
    return { available: false, claims: [], divergences: [], totals: { observations: 0, claims_observed: 0, unrecognized: 0 } };
  }

  const rows = db.prepare(`
    SELECT o.*, c.stage, l.company, l.role
    FROM vendor_status_observations o
    JOIN claims c ON c.id = o.claim_id
    LEFT JOIN listings l ON l.id = c.listing_id
    ORDER BY o.claim_id ASC, o.observed_at ASC, o.id ASC
  `).all();

  const byClaim = new Map();
  for (const row of rows) {
    if (!byClaim.has(row.claim_id)) byClaim.set(row.claim_id, []);
    byClaim.get(row.claim_id).push(row);
  }

  const claims = [...byClaim.entries()].map(([claimId, observations]) => {
    const latest = observations[observations.length - 1];
    return {
      claim_id: claimId,
      company: latest.company,
      role: latest.role,
      stage: latest.stage,
      vendor: latest.vendor,
      latest_status_text: latest.status_text,
      latest_normalized: latest.normalized_status,
      latest_observed_at: latest.observed_at,
      observations,
      // The disagreement is reported, never resolved: the employer says this is over while David's
      // own record still has it live. Prospect surfaces that and lets him decide.
      diverges: isTerminalVendorStatus(latest.normalized_status) && ACTIVE_STAGES.has(latest.stage),
    };
  });

  return {
    available: true,
    claims,
    divergences: claims.filter((c) => c.diverges),
    totals: {
      observations: rows.length,
      claims_observed: byClaim.size,
      // Unrecognized wording is counted rather than swallowed -- a rising count is how the phrase
      // table learns it has fallen behind a vendor's copy changes.
      unrecognized: rows.filter((row) => row.normalized_status == null).length,
    },
  };
}
