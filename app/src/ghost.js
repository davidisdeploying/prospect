// The ghost timer: how long a claim has sat quiet in its current stage, before
// the board *suggests* (never automates) a drop to the tailings pile.
export const GHOST_QUIET_DAYS = 14;

function parseUtc(stageEnteredAt) {
  if (!stageEnteredAt) return null;
  // stage_entered_at is a bare `datetime('now')` string ('YYYY-MM-DD HH:MM:SS', no T/Z) — SQLite writes it in UTC.
  const iso = stageEnteredAt.includes('T') ? stageEnteredAt : `${stageEnteredAt.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function quietDays(stageEnteredAt) {
  const entered = parseUtc(stageEnteredAt);
  if (!entered) return null;
  return Math.floor((Date.now() - entered.getTime()) / 86400000);
}

export function isGhostCandidate(claim) {
  if (!claim || claim.stage !== 'Staked') return false;
  const days = quietDays(claim.stage_entered_at);
  return days != null && days >= GHOST_QUIET_DAYS;
}
