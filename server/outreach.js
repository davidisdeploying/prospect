// server/outreach.js — §6.6 inbound outreach with no claim attached. All-SELECT read model plus the
// conversion helper that turns a thread into a claim while preserving the origin edge.
//
// The exemplar is on record: a recruiter pitched David a different Amazon role and location the
// same week as claim #1, with no application involved. The existing contacts table is claim-scoped,
// so the only two ways to record that lead were to invent a claim for an application that was never
// made, or to lose it. Both are wrong for a faithful tracker, so a thread stands on its own here.
//
// SOURCE ATTRIBUTION is what makes this more than an address book. Once threads convert, Prospect
// can answer "how many live applications came to me, versus how many I went and found?" — and that
// answer only stays true if the origin edge survives. It lives on the thread, so deleting a claim
// releases it rather than destroying the history of how the claim began.

export const OUTREACH_STATUSES = Object.freeze(['open', 'converted', 'declined', 'dead']);
export const OUTREACH_DIRECTIONS = Object.freeze(['inbound', 'outbound']);

function tableMissing(db, name) {
  return db.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name).n === 0;
}

// computeOutreach(db) -> {available, threads, totals, attribution}
// Degrades to an explicitly unavailable shape on a pre-021 database rather than throwing.
export function computeOutreach(db) {
  if (tableMissing(db, 'outreach_threads')) {
    return {
      available: false,
      threads: [],
      totals: { threads: 0, open: 0, converted: 0, declined: 0, dead: 0, messages: 0 },
      attribution: { total_claims: 0, from_outreach: 0, from_search: 0, share_from_outreach: null },
    };
  }

  const threads = db.prepare(`
    SELECT t.*, co.name AS company_row_name,
           (SELECT COUNT(*) FROM outreach_messages m WHERE m.thread_id = t.id) AS message_count,
           (SELECT MAX(m.occurred_at) FROM outreach_messages m WHERE m.thread_id = t.id) AS last_message_at,
           l.company AS converted_company, l.role AS converted_role, c.stage AS converted_stage
    FROM outreach_threads t
    LEFT JOIN companies co ON co.id = t.company_id
    LEFT JOIN claims c ON c.id = t.converted_claim_id
    LEFT JOIN listings l ON l.id = c.listing_id
    ORDER BY t.first_contact_at DESC, t.id DESC
  `).all().map((row) => ({
    ...row,
    // A thread may name its company before that company has a row of its own. Prefer the real
    // company record when it exists, and never blank the free-text name it was created with.
    company: row.company_row_name || row.company_name || null,
    // A thread whose claim has since been deleted keeps status 'converted' and loses only the edge.
    // Reporting that plainly beats silently reclassifying history.
    converted_claim_missing: row.status === 'converted' && row.converted_claim_id == null,
  }));

  const totals = { threads: threads.length, open: 0, converted: 0, declined: 0, dead: 0, messages: 0 };
  for (const thread of threads) {
    if (totals[thread.status] != null) totals[thread.status] += 1;
    totals.messages += thread.message_count;
  }

  // Attribution counts CLAIMS, not threads: several threads can precede one application, and the
  // question being answered is about applications.
  const totalClaims = db.prepare('SELECT COUNT(*) FROM claims').pluck().get();
  const fromOutreach = db.prepare(`
    SELECT COUNT(DISTINCT converted_claim_id) FROM outreach_threads WHERE converted_claim_id IS NOT NULL
  `).pluck().get();

  return {
    available: true,
    threads,
    totals,
    attribution: {
      total_claims: totalClaims,
      from_outreach: fromOutreach,
      from_search: Math.max(0, totalClaims - fromOutreach),
      // Null rather than 0% when there are no claims at all -- an empty tracker has no share.
      share_from_outreach: totalClaims > 0 ? (fromOutreach / totalClaims) * 100 : null,
    },
  };
}

export class OutreachConvertError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// convertThreadToClaim(db, threadId, {listingId}) -> {thread, claim}
// Links an existing claim to the thread it originated from. Runs in one transaction.
//
// Deliberately does NOT create a listing: a claim needs a captured posting, and manufacturing a
// listing from a recruiter's pitch would put un-captured text into the immutable snapshot table.
// The caller captures the posting first, the normal way, and then links it here.
export function convertThreadToClaim(db, threadId, { claimId }) {
  const thread = db.prepare('SELECT * FROM outreach_threads WHERE id = ?').get(threadId);
  if (!thread) throw new OutreachConvertError(404, 'outreach thread not found');
  const claim = db.prepare('SELECT * FROM claims WHERE id = ?').get(claimId);
  if (!claim) throw new OutreachConvertError(400, 'claim not found');
  if (thread.converted_claim_id != null && thread.converted_claim_id !== claimId) {
    throw new OutreachConvertError(409, 'thread is already converted to a different claim');
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE outreach_threads SET status = 'converted', converted_claim_id = ? WHERE id = ?
    `).run(claimId, threadId);
  })();

  return {
    thread: db.prepare('SELECT * FROM outreach_threads WHERE id = ?').get(threadId),
    claim,
  };
}
