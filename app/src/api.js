async function asJson(res, fallbackError) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || fallbackError);
  }
  return res.json();
}

export function getBoard() {
  return fetch('/api/board').then((res) => asJson(res, 'Failed to load the board'));
}

export function stakeClaim(payload) {
  return fetch('/api/claims', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((res) => asJson(res, 'Failed to stake claim'));
}

export function moveStage(claimId, toStage, opts) {
  const { note, outcome_reason, transition_cause } = opts || {};
  return fetch(`/api/claims/${claimId}/stage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to_stage: toStage, note, outcome_reason, transition_cause }),
  }).then((res) => asJson(res, 'Failed to move claim'));
}

export function listResumeVersions() {
  return fetch('/api/resume-versions').then((res) => asJson(res, 'Failed to load resume versions'));
}

export function createResumeVersion({ label, notes }) {
  return fetch('/api/resume-versions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, notes }),
  }).then((res) => asJson(res, 'Failed to create resume version'));
}

export function getClaim(claimId) {
  return fetch(`/api/claims/${claimId}`).then((res) => asJson(res, 'Failed to load claim'));
}

export function addNote(claimId, body) {
  return fetch(`/api/claims/${claimId}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  }).then((res) => asJson(res, 'Failed to add note'));
}

export function addClaimEvent(claimId, event) {
  return fetch(`/api/claims/${claimId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  }).then((res) => asJson(res, 'Failed to log touchpoint'));
}

export function resolveClaimEvent(claimId, eventId, resolution) {
  return fetch(`/api/claims/${claimId}/events/${eventId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(resolution),
  }).then((res) => asJson(res, 'Failed to resolve hard gate'));
}

export function patchClaim(claimId, patch) {
  return fetch(`/api/claims/${claimId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).then((res) => asJson(res, 'Failed to update claim'));
}

export function search(q) {
  return fetch(`/api/search?q=${encodeURIComponent(q)}`).then((res) => asJson(res, 'Search failed'));
}

export function deleteClaim(claimId) {
  return fetch(`/api/claims/${claimId}`, { method: 'DELETE' }).then((res) => asJson(res, 'Failed to delete claim'));
}

export function getTailoringTemplate() {
  return fetch('/api/tailoring-template').then((res) => asJson(res, 'Failed to load tailoring template'));
}

export function createJobAudit(claimId, force = false) {
  return fetch(`/api/claims/${claimId}/job-audits`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
  }).then((res) => asJson(res, 'Failed to start job listing audit'));
}

export function getJobAudit(auditId) {
  return fetch(`/api/job-audits/${auditId}`).then((res) => asJson(res, 'Failed to load job listing audit'));
}

export function getWaypointHandoff(auditId) {
  return fetch(`/api/job-audits/${auditId}/waypoint-handoff`).then((res) => asJson(res, 'Failed to prepare Waypoint handoff'));
}

export function linkRepost(claimId, repostOf) {
  return fetch(`/api/claims/${claimId}/link-repost`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repost_of: repostOf }),
  }).then((res) => asJson(res, 'Failed to link repost'));
}
