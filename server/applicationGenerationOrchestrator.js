import { enqueueApplicationGeneration } from './applicationGenerationQueue.js';

export function queueStakedTransition(database, claimId, fromStage, toStage) {
  if (toStage !== 'Staked' || fromStage === 'Staked') return { created: false, job: null };
  return enqueueApplicationGeneration(database, claimId, { triggerKind: 'staked_transition' });
}

export function queueNewScoutStakedClaim(database, claimId, created) {
  if (!created) return { created: false, job: null };
  const claim = database.prepare('SELECT stage FROM claims WHERE id=?').get(claimId);
  if (claim?.stage !== 'Staked') return { created: false, job: null };
  return enqueueApplicationGeneration(database, claimId, { triggerKind: 'scout_staked_claim' });
}
