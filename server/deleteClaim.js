import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DELETED_CLAIMS_DIR = path.join(__dirname, '..', 'deleted-claims');

export class ClaimDeleteError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function gatherClaimBundle(db, claimId) {
  const claim = db.prepare('SELECT * FROM claims WHERE id = ?').get(claimId);
  if (!claim) throw new ClaimDeleteError(404, 'claim not found');

  const listing = claim.listing_id != null
    ? db.prepare('SELECT * FROM listings WHERE id = ?').get(claim.listing_id)
    : null;

  const hasScout = db.prepare(`
    SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='scout_discoveries'
  `).get().n > 0;
  const hasTable = (name) => db.prepare(`
    SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?
  `).get(name).n > 0;
  const hasCommitments = hasTable('next_action_commitments');
  const hasInterviews = hasTable('interviews');
  const hasQuestions = hasTable('interview_questions');
  const hasArtifacts = hasTable('company_process_artifacts');
  const hasOutreach = hasTable('outreach_threads');
  const hasVendorStatus = hasTable('vendor_status_observations');
  const hasPredictions = hasTable('claim_predictions');
  const hasAdvisorOutputs = hasTable('advisor_outputs');
  const hasOffers = hasTable('claim_offers');
  const hasJobAudits = hasTable('job_listing_audits');

  return {
    claim,
    listing,
    claim_notes: db.prepare('SELECT * FROM claim_notes WHERE claim_id = ?').all(claimId),
    stage_transitions: db.prepare('SELECT * FROM stage_transitions WHERE claim_id = ?').all(claimId),
    contacts: db.prepare('SELECT * FROM contacts WHERE claim_id = ?').all(claimId),
    claim_events: db.prepare('SELECT * FROM claim_events WHERE claim_id = ?').all(claimId),
    resume_version_sends: db.prepare('SELECT * FROM resume_version_sends WHERE claim_id = ?').all(claimId),
    next_action_commitments: hasCommitments
      ? db.prepare('SELECT * FROM next_action_commitments WHERE claim_id = ?').all(claimId)
      : [],
    claim_offers: hasOffers
      ? db.prepare('SELECT * FROM claim_offers WHERE claim_id = ?').all(claimId)
      : [],
    interviews: hasInterviews
      ? db.prepare('SELECT * FROM interviews WHERE claim_id = ?').all(claimId)
      : [],
    interview_questions: hasQuestions
      ? db.prepare('SELECT * FROM interview_questions WHERE claim_id = ?').all(claimId)
      : [],
    // Recorded for the backup only. These artifacts are NOT deleted with the claim -- see the
    // cascade below.
    company_process_artifacts: hasArtifacts
      ? db.prepare('SELECT * FROM company_process_artifacts WHERE source_claim_id = ?').all(claimId)
      : [],
    advisor_outputs: hasAdvisorOutputs
      ? db.prepare("SELECT * FROM advisor_outputs WHERE subject_type = 'claim' AND subject_id = ?").all(claimId)
      : [],
    claim_predictions: hasPredictions
      ? db.prepare('SELECT * FROM claim_predictions WHERE claim_id = ?').all(claimId)
      : [],
    vendor_status_observations: hasVendorStatus
      ? db.prepare('SELECT * FROM vendor_status_observations WHERE claim_id = ?').all(claimId)
      : [],
    // Recorded for the backup only; these threads are unlinked, not deleted.
    outreach_threads: hasOutreach
      ? db.prepare('SELECT * FROM outreach_threads WHERE converted_claim_id = ?').all(claimId)
      : [],
    listing_skills: listing
      ? db.prepare('SELECT * FROM listing_skills WHERE listing_id = ?').all(listing.id)
      : [],
    listing_advisories: listing
      ? db.prepare('SELECT * FROM listing_advisories WHERE listing_id = ?').all(listing.id)
      : [],
    job_listing_audits: hasJobAudits
      ? db.prepare('SELECT * FROM job_listing_audits WHERE claim_id = ? OR listing_id = ?').all(claimId, listing?.id ?? -1)
      : [],
    scout_discoveries: hasScout
      ? db.prepare('SELECT * FROM scout_discoveries WHERE linked_claim_id = ?').all(claimId)
      : [],
  };
}

// Writes the full pre-delete bundle to disk BEFORE any DELETE statement runs — the caller must
// never begin the transaction if this throws (a failed backup means nothing gets deleted).
function writeBackup(backupDir, claimId, bundle) {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/:/g, '');
  const filePath = path.join(backupDir, `${claimId}-${stamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2));
  return filePath;
}

// deleteClaimById(db, claimId, backupDir) -> {deleted, listing_deleted, backup_path}
// FK-ordered cascade (schema has no ON DELETE clause anywhere -- every FK is RESTRICT):
// claim_notes -> stage_transitions -> contacts -> claim_events -> resume_version_sends ->
// next_action_commitments -> claim_offers plus any Scout links -> claims,
// then the listing IFF no other claim or repost still references it. Whole cascade runs in one
// transaction, backup-first.
export function deleteClaimById(db, claimId, backupDir = DELETED_CLAIMS_DIR) {
  const bundle = gatherClaimBundle(db, claimId);
  const backupPath = writeBackup(backupDir, claimId, bundle);
  const listingId = bundle.claim.listing_id;

  let listingDeleted = false;

  db.transaction(() => {
    db.prepare('DELETE FROM claim_notes WHERE claim_id = ?').run(claimId);
    db.prepare('DELETE FROM stage_transitions WHERE claim_id = ?').run(claimId);
    db.prepare('DELETE FROM contacts WHERE claim_id = ?').run(claimId);
    db.prepare('DELETE FROM claim_events WHERE claim_id = ?').run(claimId);
    db.prepare('DELETE FROM resume_version_sends WHERE claim_id = ?').run(claimId);
    // Every FK in this schema is RESTRICT, so a child table added by a later migration MUST be
    // added here too or hard delete starts failing the moment its first row exists.
    if (bundle.next_action_commitments.length) {
      db.prepare('DELETE FROM next_action_commitments WHERE claim_id = ?').run(claimId);
    }
    if (bundle.claim_offers.length) {
      db.prepare('DELETE FROM claim_offers WHERE claim_id = ?').run(claimId);
    }
    // interview_questions references interviews, so questions go first.
    if (bundle.interview_questions.length) {
      db.prepare('DELETE FROM interview_questions WHERE claim_id = ?').run(claimId);
    }
    if (bundle.interviews.length) {
      db.prepare('DELETE FROM interviews WHERE claim_id = ?').run(claimId);
    }
    // advisor_outputs has no FK (subject_id is a loose pair, see migration 025), so this is
    // cleanup rather than an FK requirement -- but leaving orphaned judgments about a deleted
    // claim would let a later id reuse inherit another claim's verdicts.
    if (bundle.advisor_outputs.length) {
      db.prepare("DELETE FROM advisor_outputs WHERE subject_type = 'claim' AND subject_id = ?").run(claimId);
    }
    if (bundle.claim_predictions.length) {
      db.prepare('DELETE FROM claim_predictions WHERE claim_id = ?').run(claimId);
    }
    if (bundle.vendor_status_observations.length) {
      db.prepare('DELETE FROM vendor_status_observations WHERE claim_id = ?').run(claimId);
    }
    // §6.4 process artifacts are COMPANY-scoped and deliberately outlive the claim they were
    // learned from -- how a company runs its assessment is still true after this application
    // ends. source_claim_id is only provenance, so it is released rather than cascaded, the same
    // way a Scout discovery is unlinked rather than destroyed.
    if (bundle.company_process_artifacts.length) {
      db.prepare('UPDATE company_process_artifacts SET source_claim_id = NULL WHERE source_claim_id = ?').run(claimId);
    }
    // §6.6 origin edge: the thread is real history and outlives the claim it produced. Release
    // the edge and leave the status alone -- the outreach DID convert, and rewriting that to
    // 'open' would falsify the record to keep a column tidy.
    if (bundle.outreach_threads.length) {
      db.prepare('UPDATE outreach_threads SET converted_claim_id = NULL WHERE converted_claim_id = ?').run(claimId);
    }
    if (bundle.scout_discoveries.length) {
      db.prepare(`
        UPDATE scout_discoveries SET linked_claim_id=NULL, status='new' WHERE linked_claim_id=?
      `).run(claimId);
    }
    // Audit rows are append-only during normal operation. Explicit claim deletion is the
    // product's existing backup-first destructive boundary, so the complete rows above are
    // preserved in the recovery bundle before their restrictive FKs are released.
    if (bundle.job_listing_audits.length) {
      db.prepare('DELETE FROM job_listing_audits WHERE claim_id = ?').run(claimId);
    }
    db.prepare('DELETE FROM claims WHERE id = ?').run(claimId);

    if (listingId != null) {
      const { c: claimCount } = db.prepare('SELECT COUNT(*) AS c FROM claims WHERE listing_id = ?').get(listingId);
      const { c: repostCount } = db.prepare('SELECT COUNT(*) AS c FROM listings WHERE repost_of = ?').get(listingId);
      if (claimCount === 0 && repostCount === 0) {
        db.prepare('DELETE FROM listing_skills WHERE listing_id = ?').run(listingId);
        db.prepare('DELETE FROM listing_advisories WHERE listing_id = ?').run(listingId);
        db.prepare('DELETE FROM listings_vec WHERE listing_id = ?').run(BigInt(listingId));
        db.prepare('DELETE FROM listings WHERE id = ?').run(listingId);
        listingDeleted = true;
      }
    }
  })();

  return { deleted: true, listing_deleted: listingDeleted, backup_path: backupPath };
}
