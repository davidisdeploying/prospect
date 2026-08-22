import crypto from 'node:crypto';

export const ENUMS = {
  employment_type: ['full_time','part_time','contract','temporary','internship','volunteer','other'],
  workplace_type:  ['on_site','hybrid','remote'],
  seniority:       ['internship','entry','associate','mid_senior','director','executive'],
  role_family:     ['engineering','data','design','product','marketing','sales','operations','finance','hr','legal','support','research','other'],
  job_family:      ['it_support','desktop_support','datacenter','uncategorized'],
  salary_period:   ['hourly','daily','weekly','biweekly','monthly','yearly'],
  posting_quality: ['rich','standard','sparse'],
  tier:            ['required','preferred'],
  outcome_reason:  ['rejected','ghosted','withdrawn','closed','declined','timeout','other'],
  transition_cause:['stake','manual','timeout','system','other'],
  // §6.1: 'employer' is a figure an employer actually stated; 'estimate' is David's own
  // reconstruction. The Strike Sheet keeps them distinct so an estimate is never read as a quote.
  offer_source:   ['employer','estimate'],
  // §6.4 selection-process intel (migration 020).
  interview_kind: ['phone_screen','recruiter_screen','technical','panel','onsite','assessment','final','other'],
  artifact_kind:  ['assessment_guide','process_note','interview_format','take_home','other'],
  // §6.6 inbound outreach (migration 021).
  outreach_status:    ['open','converted','declined','dead'],
  outreach_direction: ['inbound','outbound'],
  // §6.5 hunts (migration 023). ended_at is separate from status so a hunt can be paused or
  // abandoned without inventing an end date for it.
  hunt_status: ['active','closed','paused','abandoned'],
  // §5.4 calibration predictors (migration 024).
  predictor: ['gut','scout_fit','resume_cosine'],
  claim_event_kind:['assessment_requested','assessment_completed','recruiter_contact','employer_email','status_check'],
  enrichment_status:['raw','queued','enriching','enriched','failed','skipped','embedded'],
  // llm-parse's own lifecycle (migrations/010). Separate from enrichment_status by
  // design — see server/llmParse.js. 'parsed' is terminal-success, 'skipped' is
  // terminal-nothing-to-do, 'failed' is terminal-error; NULL means never attempted.
  llm_parse_status:['parsing','parsed','skipped','failed'],
  // skill-extraction's own lifecycle (migrations/012). Separate from llm_parse_status/
  // enrichment_status by design — see server/skillExtract.js. Same vocabulary shape as
  // llm_parse_status: 'extracting' transient, 'extracted'/'skipped'/'failed' terminal,
  // NULL = never attempted.
  skill_extract_status:['extracting','extracted','skipped','failed'],
  // posting-judgment advisor's own lifecycle (migrations/013, §6.7.1). Separate from
  // llm_parse_status/skill_extract_status/enrichment_status by design — see
  // server/advise.js. Same vocabulary shape as skill_extract_status: 'generating'
  // transient, 'generated'/'skipped'/'failed' terminal, NULL = never attempted.
  advisor_status:['generating','generated','skipped','failed'],
};
export function isValidEnum(field, value) {
  if (value == null) return true;
  const set = ENUMS[field];
  return set ? set.includes(value) : false;
}
export function isValidCurrency(v) { return v == null || /^[A-Z]{3}$/.test(v); }
export function toBool(v) {
  if (v == null) return null;
  if (v === true || v === 1 || v === '1' || v === 'true') return 1;
  if (v === false || v === 0 || v === '0' || v === 'false') return 0;
  return null;
}
export function toIntOrNull(v) { if (v == null || v === '') return null; const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
export function toRealOrNull(v) { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

const PERIOD_MULT = { hourly:2080, daily:260, weekly:52, biweekly:26, monthly:12, yearly:1 };
export function annualize(amount, period) {
  const a = toRealOrNull(amount); if (a == null || period == null) return null;
  const m = PERIOD_MULT[period]; return m == null ? null : a * m;
}
export function computeAnnualComp(salary_min, salary_max, period) {
  const amin = annualize(salary_min, period), amax = annualize(salary_max, period);
  let amid = null;
  if (amin != null && amax != null) amid = (amin + amax) / 2;
  else amid = amin != null ? amin : (amax != null ? amax : null);
  return { annual_comp_min: amin, annual_comp_max: amax, annual_comp_mid: amid };
}
export function daysBetween(fromIso, toIso) {
  if (!fromIso) return null;
  const from = Date.parse(fromIso), to = toIso ? Date.parse(toIso) : Date.now();
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, Math.floor((to - from) / 86400000));
}
export function computeApplicantsPerDay(applicant_count, posted_at, captured_at) {
  const ac = toIntOrNull(applicant_count); if (ac == null) return null;
  const d = daysBetween(posted_at, captured_at); if (d == null) return null;
  return ac / Math.max(d, 1);
}
export function descHash(description) {
  if (description == null) return null;
  let norm = String(description).trim().replace(/\s+/g, ' ').toLowerCase();
  // LinkedIn's safety/go wrapper stamps a fresh per-render `mt=` token on every
  // capture of the same posting; blank its value (keep url=/urlhash=) so reposts hash equal.
  norm = norm.replace(/([?&]amp;amp;mt=)[^&"]+/g, '$1');
  return norm ? crypto.createHash('sha256').update(norm).digest('hex') : null;
}
export function computePostingQuality({ comp_disclosed, salary_min, salary_max, description, skillCount, company, verified }) {
  let s = 0;
  if (comp_disclosed === 1 || toRealOrNull(salary_min) != null || toRealOrNull(salary_max) != null) s++;
  if (description && String(description).length >= 800) s++;
  if ((skillCount || 0) >= 3) s++;
  if (company && String(company).trim()) s++;
  if (verified === 1) s++;
  return s >= 4 ? 'rich' : (s >= 2 ? 'standard' : 'sparse');
}
export function canonicalCompanyName(name) {
  if (!name) return null;
  let c = String(name).toLowerCase().trim().replace(/\s+/g,' ').replace(/[.,]/g,'');
  c = c.replace(/\b(inc|llc|ltd|corp|co|company|gmbh|plc)\b/g,'').replace(/\s+/g,' ').trim();
  return c || null;
}

// Repost sentinel (§3.3): the "likely" tier fires on same company + overlapping role title.
export const REPOST_TITLE_JACCARD_THRESHOLD = 0.6;
export function roleTokens(role) {
  return new Set(
    String(role || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  );
}
export function titleJaccard(a, b) {
  const setA = roleTokens(a), setB = roleTokens(b);
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection++;
  return intersection / union.size;
}
// normalizeSkills(skills) -> {ok:true, skills:[{skill,tier}]} | {ok:false, error}
export function normalizeSkills(skills) {
  if (skills == null) return { ok:true, skills:[] };
  if (!Array.isArray(skills)) return { ok:false, error:'skills must be an array' };
  const out = [];
  for (const s of skills) {
    if (typeof s === 'string') { if (s.trim()) out.push({ skill: s.trim(), tier: null }); continue; }
    if (s && typeof s === 'object' && s.skill && String(s.skill).trim()) {
      const tier = s.tier ?? null;
      if (!isValidEnum('tier', tier)) return { ok:false, error:`invalid skill tier: ${tier}` };
      out.push({ skill: String(s.skill).trim(), tier });
      continue;
    }
    return { ok:false, error:'each skill must be a non-empty string or {skill,tier}' };
  }
  return { ok:true, skills: out };
}

const CONTACT_STRING_FIELDS = ['name', 'role', 'email', 'notes', 'profile_url'];
const CONTACT_KEYS = new Set([...CONTACT_STRING_FIELDS, 'is_job_poster']);
// normalizeContacts(contacts) -> {ok:true, contacts:[{name,role,email,notes,profile_url,is_job_poster}]} | {ok:false, error}
export function normalizeContacts(contacts) {
  if (contacts == null) return { ok:true, contacts:[] };
  if (!Array.isArray(contacts)) return { ok:false, error:'contacts must be an array' };
  const out = [];
  for (const c of contacts) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      return { ok:false, error:'each contact must be an object' };
    }
    for (const key of Object.keys(c)) {
      if (!CONTACT_KEYS.has(key)) return { ok:false, error:`unknown contact field: ${key}` };
    }
    const entry = {};
    for (const field of CONTACT_STRING_FIELDS) {
      const v = c[field];
      if (v == null) { entry[field] = null; continue; }
      if (typeof v !== 'string') return { ok:false, error:`contact ${field} must be a string` };
      const trimmed = v.trim();
      entry[field] = trimmed ? trimmed : null;
    }
    entry.is_job_poster = toBool(c.is_job_poster);
    if (!entry.name && !entry.role && !entry.email && !entry.profile_url) {
      return { ok:false, error:'each contact must have at least one of name, role, email, profile_url' };
    }
    out.push(entry);
  }
  return { ok:true, contacts: out };
}
