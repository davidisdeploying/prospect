// server/resumeVersionSends.js
// H16: claims.resume_version_id is a single nullable FK; PATCHing it overwrites the prior value
// with nothing recording it or when it was set. This module is the append-only per-send ledger
// (migrations/011_resume_version_sends.sql) that PATCH /api/claims/:id writes to alongside the
// column, so tailoring<->outcome correlation (the §6.7 gate) can trust history retroactively.
// claims.resume_version_id remains the "current" pointer -- unchanged shape for every existing
// reader/writer that only cares about the latest value.

// Records a send iff resume_version_id is actually changing to a real (non-null) value. Clearing it
// to null, or PATCHing the same value it already holds, is not a "send" and is not logged. Runs
// inside the caller's own transaction -- this function opens none of its own.
export function recordResumeVersionSend(db, claimId, previousResumeVersionId, nextResumeVersionId) {
  if (nextResumeVersionId == null) return null;
  if (nextResumeVersionId === previousResumeVersionId) return null;

  const info = db.prepare(
    'INSERT INTO resume_version_sends (claim_id, resume_version_id) VALUES (?, ?)'
  ).run(claimId, nextResumeVersionId);
  return db.prepare('SELECT * FROM resume_version_sends WHERE id = ?').get(info.lastInsertRowid);
}
