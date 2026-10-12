export const SHA256_RE = /^[a-f0-9]{64}$/;
export const RESUME_KINDS = new Set(['baseline', 'tailored']);

function optionalText(value) {
  return value == null || !String(value).trim() ? null : String(value).trim();
}

function auditObject(value) {
  if (value == null || value === '') return null;
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { throw new Error('audit_json must be valid JSON'); }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('audit_json must be a JSON object');
  return parsed;
}

export function validateResumeVersion(database, input) {
  const label = optionalText(input?.label);
  if (!label) throw new Error('label is required');
  const kind = optionalText(input.kind);
  if (kind && !RESUME_KINDS.has(kind)) throw new Error('kind must be baseline or tailored');
  const parentId = input.parent_resume_version_id == null || input.parent_resume_version_id === ''
    ? null : Number(input.parent_resume_version_id);
  if (parentId != null && !Number.isInteger(parentId)) throw new Error('parent_resume_version_id must be an integer');
  const values = {
    label,
    notes: optionalText(input.notes),
    body: input.body == null ? null : String(input.body),
    kind,
    parent_resume_version_id: parentId,
    source_path: optionalText(input.source_path),
    source_sha256: optionalText(input.source_sha256),
    style_reference_path: optionalText(input.style_reference_path),
    style_reference_sha256: optionalText(input.style_reference_sha256),
    career_claims_sha256: optionalText(input.career_claims_sha256),
    audit_status: optionalText(input.audit_status),
    audit_json: auditObject(input.audit_json),
  };
  for (const field of ['source_sha256', 'style_reference_sha256', 'career_claims_sha256']) {
    if (values[field] && !SHA256_RE.test(values[field])) throw new Error(`${field} must be a 64-character lowercase SHA-256`);
  }
  let parent = null;
  if (parentId != null) {
    parent = database.prepare('SELECT id, kind FROM resume_versions WHERE id = ?').get(parentId);
    if (!parent) throw new Error('parent resume version does not exist');
  }
  if (kind === 'baseline') {
    for (const field of ['body', 'source_path', 'source_sha256', 'style_reference_path', 'style_reference_sha256', 'career_claims_sha256', 'audit_status']) {
      if (!values[field] || !String(values[field]).trim()) throw new Error(`baseline ${field} is required`);
    }
    if (!values.audit_json) throw new Error('baseline audit_json is required');
    if (parentId != null) throw new Error('a baseline cannot have a parent resume version');
  }
  if (kind === 'tailored') {
    if (!values.body || !values.body.trim()) throw new Error('tailored body is required');
    if (!parent || parent.kind !== 'baseline') throw new Error('a tailored resume must name a parent baseline');
  }
  return values;
}

export function createResumeVersion(database, input) {
  const value = validateResumeVersion(database, input);
  const info = database.prepare(`
    INSERT INTO resume_versions
      (label, notes, body, kind, parent_resume_version_id, source_path, source_sha256,
       style_reference_path, style_reference_sha256, career_claims_sha256, audit_status, audit_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(value.label, value.notes, value.body, value.kind, value.parent_resume_version_id,
    value.source_path, value.source_sha256, value.style_reference_path,
    value.style_reference_sha256, value.career_claims_sha256, value.audit_status,
    value.audit_json ? JSON.stringify(value.audit_json) : null);
  return database.prepare('SELECT * FROM resume_versions WHERE id = ?').get(info.lastInsertRowid);
}
