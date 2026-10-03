import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadCareerClaims } from './careerClaims.js';
import { regularFileBeneath, sha256File } from './fileSafety.js';
import { listingSnapshotHash } from './listingSnapshot.js';
import { INTERVIEW_KINDS, interviewKindGloss } from './selection.js';

export const INTERVIEW_PREP_PROMPT_VERSION = 'interview-prep-v1';
export const INTERVIEW_ARTIFACT_ROOT = process.env.PROSPECT_INTERVIEW_ARTIFACT_ROOT
  || '/home/david/Vaults/prospect-vault/files';

export class InterviewPreparationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const normalize = (value) => String(value || '').toLowerCase()
  .replace(/[^a-z0-9+#]+/g, ' ').replace(/\s+/g, ' ').trim();
const plainText = (value) => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function phrasePresent(haystack, needle) {
  const normalizedNeedle = normalize(needle);
  return normalizedNeedle && ` ${haystack} `.includes(` ${normalizedNeedle} `);
}

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch { return fallback; }
}

function cleanOptionalText(value, label, max = 200) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new InterviewPreparationError(400, `${label} must be text`);
  const cleaned = value.trim();
  if (!cleaned) return null;
  if (cleaned.length > max) throw new InterviewPreparationError(400, `${label} is too long`);
  return cleaned;
}

function cleanDuration(value) {
  if (value == null || value === '') return null;
  const duration = Number(value);
  if (!Number.isInteger(duration) || duration < 1 || duration > 480) {
    throw new InterviewPreparationError(400, 'duration_minutes must be an integer from 1 to 480');
  }
  return duration;
}

function selectEvidence(career, listing) {
  const listingText = normalize(`${listing.role || ''}\n${listing.description || ''}`);
  const rank = { P1: 0, X1: 1, P2: 2, C2: 3 };
  return career.claims
    .filter((claim) => claim.public_safe_status !== false
      && claim.match_terms.some((term) => phrasePresent(listingText, term)))
    .sort((a, b) => (rank[a.evidence_class] ?? 9) - (rank[b.evidence_class] ?? 9)
      || a.claim_id.localeCompare(b.claim_id))
    .slice(0, 10)
    .map((claim) => ({
      claim_id: claim.claim_id,
      safe_language: claim.safe_language,
      evidence_class: claim.evidence_class,
      evidence_scope: claim.evidence_class === 'P1' ? 'professional'
        : claim.evidence_class === 'P2' ? 'coursework or project'
          : claim.evidence_class === 'X1' ? 'verified credential or record' : 'conditional',
      prohibited_inference: claim.prohibited_inference,
    }));
}

const PRIORITY_RULES = Object.freeze([
  {
    key: 'troubleshooting',
    label: 'Network restoration and troubleshooting',
    pattern: /troubleshoot|service interruption|restore network|isolate|defective (?:module|equipment)/i,
    coaching: 'Use one methodical example: define scope, protect service, isolate the layer, repair or escalate, then verify and document.',
  },
  {
    key: 'installation',
    label: 'Install, test, change, and decommission work',
    pattern: /install|provision|decommission|commission|testing of|tests? (?:network|equipment)/i,
    coaching: 'Connect this to repeatable build specifications, hardware lifecycle discipline, QA, and change records.',
  },
  {
    key: 'assets',
    label: 'Asset, spares, shipping, and receiving control',
    pattern: /asset management|shipping and receiving|inventory|replenish|spares|materials|test sets|tools/i,
    coaching: 'Lead with ERP transactions, serial records, physical-to-system reconciliation, kitting, and audit accuracy.',
  },
  {
    key: 'telecom',
    label: 'Carrier transport, fiber, and outside plant',
    pattern: /fiber|sonet|ds0|ds1|ds3|oc192|otdr|fusion splic|outside plant|lightwave|wavelength/i,
    coaching: 'Separate transferable TCP/IP and hardware knowledge from telecom-specific tools and standards that require training.',
  },
  {
    key: 'critical_infrastructure',
    label: 'Power and critical-infrastructure inspections',
    pattern: /dc power|ac power|power plant|high-voltage|hvac|preventive.*maintenance|scheduled maintenance/i,
    coaching: 'Emphasize inspection discipline and safe escalation. Do not claim electrical or HVAC qualifications that are not established.',
  },
  {
    key: 'records',
    label: 'Tickets, records, databases, and status updates',
    pattern: /trouble ticket|installation records|log information|database|status update|time tracking|transactional update/i,
    coaching: 'Show that accurate records are part of the repair, not paperwork performed after the real work.',
  },
  {
    key: 'field',
    label: 'Field readiness, on-call response, and physical work',
    pattern: /on-call|stand-by|call out|dispatch|overtime|driver.?s license|all weather|climb|kneel|crawl|lift/i,
    coaching: 'Answer each availability and physical gate directly from current personal facts; Prospect does not infer them.',
  },
]);

const BOUNDARY_RULES = Object.freeze([
  {
    key: 'carrier_transport',
    label: 'Carrier transport and SONET',
    pattern: /sonet|ds0|ds1|ds3|oc192|lightwave|wavelength|transmission equipment/i,
    guidance: 'Do not convert TCP/IP coursework or homelab operation into professional carrier-transport experience.',
  },
  {
    key: 'fiber_outside_plant',
    label: 'Fiber locating, OTDR, splicing, and outside plant',
    pattern: /otdr|fusion splic|outside plant|right-of-way|as-builts|locat(?:e|ing)[^.!?]{0,40}fiber/i,
    guidance: 'State the exact exposure you have. If none is established, ask about supervised training and qualification.',
  },
  {
    key: 'power_critical',
    label: 'AC/DC power, high voltage, and HVAC',
    pattern: /dc power|ac power|power plant|high-voltage|hvac/i,
    guidance: 'Do not imply licensed electrical, DC-plant, or HVAC maintenance experience from general hardware work.',
  },
]);

const SELF_ATTEST_RULES = Object.freeze([
  { key: 'license', label: 'Valid driver license', pattern: /driver.?s license/i, prompt: 'Confirm your current license status and driving-record readiness.' },
  { key: 'schedule', label: 'Rotating on-call, standby, dispatch, and overtime', pattern: /on-call|stand-by|call out|dispatch|overtime/i, prompt: 'Confirm your real availability and ask how frequently call-outs occur.' },
  { key: 'physical', label: 'Physical requirements', pattern: /sit|climb|balance|stoop|kneel|crouch|crawl|lift/i, prompt: 'Confirm each requirement personally. Do not rely on a resume inference.' },
  { key: 'weather', label: 'Outdoor work in all weather', pattern: /all weather|outdoor/i, prompt: 'Confirm your comfort with the actual territory, conditions, and safety expectations.' },
]);

function extractSalary(listing) {
  let minimum = listing.annual_comp_min == null || listing.annual_comp_min === ''
    ? NaN : Number(listing.annual_comp_min);
  let maximum = listing.annual_comp_max == null || listing.annual_comp_max === ''
    ? NaN : Number(listing.annual_comp_max);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    const text = plainText(listing.description);
    const match = text.match(/\$\s*([0-9][0-9,]*)\s*(?:-|–|to)\s*\$\s*([0-9][0-9,]*)/i);
    minimum = match ? Number(match[1].replace(/,/g, '')) : NaN;
    maximum = match ? Number(match[2].replace(/,/g, '')) : NaN;
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return null;
  const money = (amount) => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(amount);
  return {
    minimum, maximum,
    range_text: `${money(minimum)} to ${money(maximum)}`,
    answer: `The posting lists a base range of ${money(minimum)} to ${money(maximum)}. I am open within that range and would like to understand the schedule, on-call and overtime structure, and total benefits before narrowing it further.`,
  };
}

function companyIntel(database, listing, claimId) {
  const interviews = database.prepare(`
    SELECT i.id, i.claim_id, i.kind, i.format, i.scheduled_at, i.occurred_at, i.duration_minutes, i.outcome_note,
           ct.name AS interviewer_name, ct.role AS interviewer_role
    FROM interviews i
    JOIN claims c ON c.id=i.claim_id
    JOIN listings l ON l.id=c.listing_id
    LEFT JOIN contacts ct ON ct.id=i.contact_id
    WHERE l.company_id IS NOT NULL AND l.company_id=?
    ORDER BY COALESCE(i.occurred_at,i.scheduled_at) DESC, i.id DESC
  `).all(listing.company_id ?? -1);
  const questions = database.prepare(`
    SELECT id, claim_id, interview_id, question, category, asked_by, answer_note, created_at
    FROM interview_questions WHERE company_id=? ORDER BY id DESC
  `).all(listing.company_id ?? -1);
  const artifacts = database.prepare(`
    SELECT id, kind, title, body, reference_path, source_claim_id, created_at
    FROM company_process_artifacts WHERE company_id=? ORDER BY id DESC
  `).all(listing.company_id ?? -1);
  return {
    current_claim_interviews: interviews.filter((item) => Number(item.claim_id) === Number(claimId)),
    interviews,
    questions,
    artifacts,
    sample_warning: interviews.length < 2
      ? 'No recurring company process is inferred from fewer than two observations.' : null,
  };
}

function currentInputs(database, claimId, rawInput) {
  const claim = database.prepare('SELECT * FROM claims WHERE id=?').get(claimId);
  if (!claim) throw new InterviewPreparationError(404, 'claim not found');
  const listing = database.prepare('SELECT * FROM listings WHERE id=?').get(claim.listing_id);
  if (!listing) throw new InterviewPreparationError(409, 'claim has no listing snapshot');
  if (!INTERVIEW_KINDS.includes(rawInput.interview_kind)) {
    throw new InterviewPreparationError(400, `interview_kind must be one of: ${INTERVIEW_KINDS.join(', ')}`);
  }
  const resumeVersionId = Number(rawInput.resume_version_id);
  if (!Number.isInteger(resumeVersionId) || resumeVersionId <= 0) {
    throw new InterviewPreparationError(400, 'Choose the resume used for preparation');
  }
  const resume = database.prepare('SELECT * FROM resume_versions WHERE id=?').get(resumeVersionId);
  if (!resume || !String(resume.body || '').trim()) {
    throw new InterviewPreparationError(400, 'The selected resume does not contain readable source text');
  }
  let interview = null;
  if (rawInput.interview_id != null && rawInput.interview_id !== '') {
    const interviewId = Number(rawInput.interview_id);
    interview = database.prepare('SELECT * FROM interviews WHERE id=? AND claim_id=?').get(interviewId, claimId);
    if (!interview) throw new InterviewPreparationError(400, 'interview_id must belong to this claim');
  }
  const career = loadCareerClaims();
  const snapshotHash = listingSnapshotHash(listing);
  const context = {
    interview_id: interview?.id || null,
    interview_kind: rawInput.interview_kind,
    interview_format: cleanOptionalText(rawInput.interview_format, 'interview_format', 80),
    scheduled_at: cleanOptionalText(rawInput.scheduled_at, 'scheduled_at', 80),
    duration_minutes: cleanDuration(rawInput.duration_minutes),
    interviewer_name: cleanOptionalText(rawInput.interviewer_name, 'interviewer_name', 120),
    resume_confirmed_sent: rawInput.resume_confirmed_sent === true,
  };
  return { claim, listing, resume, career, context, snapshotHash, company: companyIntel(database, listing, claimId) };
}

function buildDeterministicGuide(inputs) {
  const { claim, listing, resume, career, context, snapshotHash, company } = inputs;
  const listingText = plainText(listing.description);
  const evidence = selectEvidence(career, listing);
  if (!evidence.length) {
    throw new InterviewPreparationError(409, 'No public-safe Career evidence matched this listing');
  }
  const rolePriorities = PRIORITY_RULES.filter((item) => item.pattern.test(listingText))
    .map(({ key, label, coaching }) => ({ key, label, coaching }));
  const boundaries = BOUNDARY_RULES.filter((item) => item.pattern.test(listingText))
    .map(({ key, label, guidance }) => ({ key, label, guidance }));
  const selfAttest = SELF_ATTEST_RULES.filter((item) => item.pattern.test(listingText))
    .map(({ key, label, prompt }) => ({ key, label, prompt }));
  const baselineAudit = parseJsonObject(resume.audit_json);
  const evidenceById = Object.fromEntries(evidence.map((item) => [item.claim_id, item]));
  const preferredIds = [
    'skill-hardware-lifecycle-breakfix', 'skill-asset-inventory-operations',
    'skill-windows-endpoint-deployment', 'skill-networking-foundations', 'skill-linux-administration',
  ];
  const introEvidence = preferredIds.map((id) => evidenceById[id]).filter(Boolean).slice(0, 4);
  const intro = [
    ...introEvidence.map((item) => item.safe_language),
    `This ${listing.role || 'role'} interests me because it combines ${rolePriorities.slice(0, 3).map((item) => item.label.toLowerCase()).join(', ') || 'hands-on operations and troubleshooting'}.`,
  ];
  const likelyQuestions = [
    {
      question: 'Tell me about yourself and why this role interests you.',
      answer_points: intro,
    },
    {
      question: `Why ${listing.company || 'this company'}?`,
      answer_points: [
        'Connect the role to reliable infrastructure, customer impact, and hands-on ownership.',
        'Name the specific work that attracts you; avoid generic praise or claims about company culture you have not observed.',
      ],
    },
    {
      question: 'What troubleshooting and repair experience do you bring?',
      answer_points: [
        evidenceById['skill-hardware-lifecycle-breakfix']?.safe_language || 'Use one verified hardware troubleshooting example.',
        'Describe scope, tests, repair or escalation, verification, and documentation in that order.',
      ],
    },
    {
      question: 'What network experience do you have?',
      answer_points: [
        evidenceById['skill-networking-foundations']?.safe_language || 'Describe only your actual networking coursework and hands-on practice.',
        'Keep coursework, homelab operation, and professional tenure visibly separate.',
      ],
    },
    {
      question: 'How do you keep assets, spares, and records accurate?',
      answer_points: [
        evidenceById['skill-asset-inventory-operations']?.safe_language || 'Use a verified inventory or asset-control example.',
        'Explain how physical identifiers, transactions, reconciliation, and exception handling stay aligned.',
      ],
    },
    {
      question: 'Which parts of this job would require training?',
      answer_points: boundaries.length
        ? boundaries.map((item) => `${item.label}: ${item.guidance}`)
        : ['Name any direct gap precisely, then connect it to a verified learning habit and ask about training.'],
    },
    {
      question: 'Can you meet the schedule, driving, field, and physical requirements?',
      answer_points: selfAttest.length
        ? selfAttest.map((item) => `${item.label}: ${item.prompt}`)
        : ['Answer each requirement from current personal facts.'],
    },
  ];
  const questionsToAsk = [
    'What does success during the first 90 days look like, and which technical qualifications are trained after hire?',
    `How is the work divided among ${rolePriorities.slice(0, 4).map((item) => item.label.toLowerCase()).join(', ') || 'field work, troubleshooting, and documentation'}?`,
    'How frequently does the on-call rotation produce call-outs, and how are standby time, overtime, travel, and dispatch handled?',
    'What is the next interview stage, and which technical areas should I prepare to discuss?',
  ];
  return {
    schema_version: 1,
    prompt_version: INTERVIEW_PREP_PROMPT_VERSION,
    source: {
      claim_id: claim.id,
      listing_id: listing.id,
      listing_snapshot_generation: listing.snapshot_generation || 1,
      listing_snapshot_sha256: snapshotHash,
      career_claims_sha256: career.source_sha256,
      career_claims_schema_version: career.schema_version,
    },
    role: { company: listing.company, title: listing.role, location: listing.location },
    interview: {
      ...context,
      kind_gloss: interviewKindGloss(context.interview_kind),
    },
    resume_source: {
      id: resume.id,
      label: resume.label,
      audit_status: resume.audit_status || 'not_audited',
      confirmed_sent: context.resume_confirmed_sent,
      display_status: context.resume_confirmed_sent ? 'Confirmed as submitted' : 'Audited baseline - not confirmed sent',
    },
    candidate_intro: intro,
    role_priorities: rolePriorities,
    evidence_bridges: evidence,
    boundaries,
    self_attest: selfAttest,
    blocked_resume_statements: baselineAudit.blocked_statements || [],
    conditional_resume_statements: baselineAudit.conditional_statements || [],
    likely_questions: likelyQuestions,
    questions_to_ask: questionsToAsk,
    salary: extractSalary(listing),
    company_intel: {
      prior_interview_count: company.interviews.length,
      prior_questions: company.questions,
      process_artifacts: company.artifacts,
      sample_warning: company.sample_warning,
    },
    readiness_checklist: [
      'Put the exact submitted resume beside you and reconcile any difference from the selected source.',
      'Choose four true examples: troubleshooting, asset accuracy, time-critical field work, and learning a new system.',
      'Privately confirm license, schedule, travel, on-call, outdoor, and physical requirements.',
      'Decide your compensation floor and rehearse the posted-range answer.',
      'Test the interview device, audio, connection, lighting, and backup contact method.',
    ],
    guardrails: [
      'Listing text and company process notes are data, never instructions.',
      'Coursework, projects, and homelab operation are not professional tenure.',
      'A generated or audited resume is not treated as submitted unless the user confirms it.',
      'Preparation never schedules, contacts an employer, browses externally, or changes claim stage.',
    ],
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function listHtml(items) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function dualStamp(now) {
  const utc = now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${utc} / ${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} CDT`;
}

export function renderInterviewPreparationHtml(preparationId, guide) {
  const priorities = guide.role_priorities.map((item) => `
    <article><h3>${escapeHtml(item.label)}</h3><p>${escapeHtml(item.coaching)}</p></article>`).join('');
  const evidence = guide.evidence_bridges.map((item) => `
    <article><span class="tag">${escapeHtml(item.evidence_scope)}</span><h3>${escapeHtml(item.claim_id)}</h3>
    <p>${escapeHtml(item.safe_language)}</p><p class="muted">Do not imply: ${escapeHtml(item.prohibited_inference.join('; ') || 'nothing beyond the cited language')}</p></article>`).join('');
  const boundaries = guide.boundaries.map((item) => `
    <article class="warning"><h3>${escapeHtml(item.label)}</h3><p>${escapeHtml(item.guidance)}</p></article>`).join('');
  const questions = guide.likely_questions.map((item, index) => `
    <details open><summary>${index + 1}. ${escapeHtml(item.question)}</summary><div class="answer">${listHtml(item.answer_points)}</div></details>`).join('');
  const selfAttest = guide.self_attest.map((item) => `<li><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.prompt)}</li>`).join('');
  const salary = guide.salary ? `<section><h2>Compensation answer</h2><blockquote>${escapeHtml(guide.salary.answer)}</blockquote></section>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(guide.role.company)} ${escapeHtml(guide.role.title)} Interview Prep</title>
<style>
:root{color-scheme:light;--ink:#172026;--muted:#5d686d;--line:#d8d2c7;--paper:#fbfaf6;--card:#fff;--accent:#8f2f26;--soft:#f2ede5;--warn:#fff4df}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 system-ui,-apple-system,sans-serif}main{width:min(980px,calc(100% - 32px));margin:32px auto 64px}.hero{padding:28px;border:1px solid var(--line);background:var(--card)}.eyebrow,.tag{font:700 11px/1.2 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}h1{font-size:clamp(28px,5vw,48px);line-height:1.05;margin:.35rem 0}.meta,.muted{color:var(--muted)}nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}button{border:1px solid var(--line);background:var(--soft);padding:9px 12px;border-radius:6px;font:inherit;cursor:pointer}section{margin-top:18px;padding:22px;border:1px solid var(--line);background:var(--card)}h2{margin:0 0 14px;font-size:23px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.grid article{padding:15px;border:1px solid var(--line);background:var(--paper)}h3{margin:4px 0 8px;font-size:16px}ul{margin:.5rem 0;padding-left:1.25rem}li+li{margin-top:.45rem}details{border-top:1px solid var(--line);padding:12px 0}summary{font-weight:700;cursor:pointer}.warning{background:var(--warn)!important}blockquote{margin:0;border-left:4px solid var(--accent);padding:12px 16px;background:var(--soft)}.practice .answer{display:none}.practice details[open] .answer{display:block}.provenance{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}@media(max-width:680px){main{width:min(100% - 18px,980px);margin-top:9px}.grid{grid-template-columns:1fr}.hero,section{padding:17px}}@media print{nav{display:none}main{width:100%;margin:0}section,.hero{break-inside:avoid}}
</style></head><body><main>
<header class="hero"><p class="eyebrow">Claim ${escapeHtml(guide.source.claim_id)} / ${escapeHtml(guide.interview.kind_gloss)} / Preparation ${escapeHtml(preparationId)}</p>
<h1>${escapeHtml(guide.role.title)}</h1><p>${escapeHtml(guide.role.company)}${guide.role.location ? ` / ${escapeHtml(guide.role.location)}` : ''}</p>
<p class="meta">Resume source: <strong>${escapeHtml(guide.resume_source.label)}</strong> / ${escapeHtml(guide.resume_source.display_status)}</p>
<nav><button id="practice" type="button" aria-pressed="false">Practice mode</button><button type="button" onclick="window.print()">Print / Save PDF</button></nav></header>
<section><h2>Your 60-second spine</h2>${listHtml(guide.candidate_intro)}<p class="muted">Turn these verified points into your own natural wording. Do not memorize a fabricated story.</p></section>
<section><h2>What the role is screening for</h2><div class="grid">${priorities}</div></section>
<section><h2>Your evidence bridges</h2><div class="grid">${evidence}</div></section>
${boundaries ? `<section><h2>Be precise about the training ramp</h2><div class="grid">${boundaries}</div></section>` : ''}
<section><h2>Questions you are likely to hear</h2>${questions}</section>
${salary}
<section><h2>Confirm these from your own facts</h2><ul>${selfAttest || '<li>No listing-specific self-attestation gate was extracted.</li>'}</ul></section>
<section><h2>Questions to ask</h2>${listHtml(guide.questions_to_ask)}</section>
<section><h2>Before the interview</h2>${listHtml(guide.readiness_checklist)}</section>
<section><h2>Evidence guardrails</h2>${listHtml(guide.guardrails)}
<p class="provenance">Listing snapshot SHA-256: ${escapeHtml(guide.source.listing_snapshot_sha256)}<br>Career claims SHA-256: ${escapeHtml(guide.source.career_claims_sha256)}<br>Prompt version: ${escapeHtml(guide.prompt_version)}</p></section>
</main><script>document.getElementById('practice').addEventListener('click',function(){const active=document.body.classList.toggle('practice');this.setAttribute('aria-pressed',String(active));this.textContent=active?'Practice mode: on':'Practice mode';});</script></body></html>`;
}

function artifactDirectory(root, preparationId, now) {
  const date = now.toISOString().slice(0, 10);
  return path.join(path.resolve(root), date.slice(0, 4), date, `prospect-interview-prep-${preparationId}`);
}

function writeArtifactBundle(preparationId, guide, artifactRoot, now) {
  const directory = artifactDirectory(artifactRoot, preparationId, now);
  if (fs.existsSync(directory)) throw new Error(`artifact directory already exists: ${directory}`);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  const temporary = `${directory}.tmp-${crypto.randomUUID()}`;
  fs.mkdirSync(temporary);
  try {
    const htmlPath = path.join(temporary, 'interview-prep.html');
    fs.writeFileSync(htmlPath, renderInterviewPreparationHtml(preparationId, guide), { flag: 'wx' });
    const htmlHash = sha256File(htmlPath);
    const verificationPath = path.join(temporary, 'verification.json');
    fs.writeFileSync(verificationPath, JSON.stringify({
      schema_version: 1,
      preparation_id: preparationId,
      listing_snapshot_sha256: guide.source.listing_snapshot_sha256,
      career_claims_sha256: guide.source.career_claims_sha256,
      resume_version_id: guide.resume_source.id,
      resume_confirmed_sent: guide.resume_source.confirmed_sent,
      artifact_sha256: htmlHash,
    }, null, 2) + '\n', { flag: 'wx' });
    const verificationHash = sha256File(verificationPath);
    const manifest = `# Artifact manifest\n\n- Created: \`${dualStamp(now)}\`\n- Project: \`Prospect\`\n- Producing seat: \`Prospect deterministic interview-prep renderer\`\n- Model/provider: \`none / deterministic\`\n- Source task or token: \`Interview preparation ${preparationId}\`\n- Purpose: \`Claim-scoped interview preparation; local review only\`\n- Sensitivity: \`sensitive\`\n- Retention: \`keep\`\n\n## Files\n\n| File | SHA-256 | Role |\n|---|---|---|\n| \`interview-prep.html\` | \`${htmlHash}\` | Canonical self-contained interview guide |\n| \`verification.json\` | \`${verificationHash}\` | Provenance and artifact verification |\n\n## Verification\n\n\`The HTML guide is fully readable without JavaScript. Optional practice and print controls are progressive enhancement. No external action is performed.\`\n`;
    fs.writeFileSync(path.join(temporary, 'MANIFEST.md'), manifest, { flag: 'wx' });
    fs.renameSync(temporary, directory);
    return { directory, path: path.join(directory, 'interview-prep.html'), sha256: htmlHash };
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

function hydrate(database, row) {
  if (!row) return null;
  const events = database.prepare('SELECT * FROM interview_preparation_events WHERE preparation_id=? ORDER BY id').all(row.id);
  const artifacts = database.prepare('SELECT * FROM interview_preparation_artifacts WHERE preparation_id=? ORDER BY id').all(row.id);
  const researchJob = database.prepare('SELECT * FROM interview_research_jobs WHERE preparation_id=? ORDER BY id DESC LIMIT 1').get(row.id) || null;
  return {
    ...row,
    resume_confirmed_sent: row.resume_confirmed_sent === 1,
    deterministic: parseJsonObject(row.deterministic_json),
    provider_result: parseJsonObject(row.provider_json, null),
    events,
    artifacts,
    research_job: researchJob,
  };
}

export function getInterviewPreparation(database, preparationId) {
  return hydrate(database, database.prepare('SELECT * FROM interview_preparations WHERE id=?').get(preparationId));
}

export function listInterviewPreparations(database, claimId) {
  return database.prepare('SELECT * FROM interview_preparations WHERE claim_id=? ORDER BY id DESC').all(claimId)
    .map((row) => hydrate(database, row));
}

export function interviewPreparationContext(database, claimId) {
  const claim = database.prepare('SELECT * FROM claims WHERE id=?').get(claimId);
  if (!claim) throw new InterviewPreparationError(404, 'claim not found');
  const listing = database.prepare('SELECT * FROM listings WHERE id=?').get(claim.listing_id);
  if (!listing) throw new InterviewPreparationError(409, 'claim has no listing snapshot');
  return companyIntel(database, listing, claimId);
}

export function prepareInterviewPreparation(database, claimId, rawInput = {}, {
  artifactRoot = INTERVIEW_ARTIFACT_ROOT, now = new Date(),
} = {}) {
  const inputs = currentInputs(database, claimId, rawInput);
  const guide = buildDeterministicGuide(inputs);
  const sourcePayload = {
    claim_id: inputs.claim.id,
    listing_id: inputs.listing.id,
    listing_snapshot_generation: inputs.listing.snapshot_generation || 1,
    listing_snapshot_hash: inputs.snapshotHash,
    resume_version_id: inputs.resume.id,
    resume_source_sha256: inputs.resume.source_sha256 || null,
    resume_confirmed_sent: inputs.context.resume_confirmed_sent,
    career_claims_sha256: inputs.career.source_sha256,
    interview: inputs.context,
    company_intel: {
      interview_ids: inputs.company.interviews.map((item) => item.id),
      question_ids: inputs.company.questions.map((item) => item.id),
      artifact_ids: inputs.company.artifacts.map((item) => item.id),
    },
    prompt_version: INTERVIEW_PREP_PROMPT_VERSION,
  };
  const sourceInputHash = sha256(JSON.stringify(sourcePayload));
  let requestKey = sha256(`${sourceInputHash}\n${rawInput.regenerate === true ? crypto.randomUUID() : 'prepare-v1'}`);
  const existing = database.prepare('SELECT * FROM interview_preparations WHERE request_key=?').get(requestKey);
  if (existing && existing.status !== 'failed') return { preparation: hydrate(database, existing), created: false };
  // A failed generation stays immutable evidence, but must not permanently poison
  // the same user request. A retry gets a fresh request key and its own ledger row.
  if (existing?.status === 'failed') requestKey = sha256(`${sourceInputHash}\nretry\n${crypto.randomUUID()}`);

  const preparationId = database.transaction(() => {
    const info = database.prepare(`
      INSERT INTO interview_preparations
        (request_key, source_input_hash, claim_id, interview_id, listing_id,
         listing_snapshot_generation, listing_snapshot_hash, resume_version_id,
         resume_confirmed_sent, career_claims_sha256, career_claims_schema_version,
         interview_kind, interview_format, scheduled_at, duration_minutes, interviewer_name,
         prompt_version, deterministic_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'preparing')
    `).run(requestKey, sourceInputHash, inputs.claim.id, inputs.context.interview_id,
      inputs.listing.id, inputs.listing.snapshot_generation || 1, inputs.snapshotHash,
      inputs.resume.id, Number(inputs.context.resume_confirmed_sent), inputs.career.source_sha256,
      inputs.career.schema_version, inputs.context.interview_kind, inputs.context.interview_format,
      inputs.context.scheduled_at, inputs.context.duration_minutes, inputs.context.interviewer_name,
      INTERVIEW_PREP_PROMPT_VERSION, JSON.stringify(guide));
    const id = Number(info.lastInsertRowid);
    database.prepare("INSERT INTO interview_preparation_events (preparation_id,kind,payload) VALUES (?,'prepared',?)")
      .run(id, JSON.stringify({ source_input_hash: sourceInputHash }));
    return id;
  })();

  let artifact = null;
  try {
    artifact = writeArtifactBundle(preparationId, guide, artifactRoot, now);
    database.transaction(() => {
      const artifactInfo = database.prepare(`
        INSERT INTO interview_preparation_artifacts (preparation_id,kind,format,path,sha256)
        VALUES (?,'guide','html',?,?)
      `).run(preparationId, artifact.path, artifact.sha256);
      database.prepare("INSERT INTO interview_preparation_events (preparation_id,kind,payload) VALUES (?,'generated',?)")
        .run(preparationId, JSON.stringify({ artifact_id: Number(artifactInfo.lastInsertRowid), sha256: artifact.sha256 }));
      database.prepare("UPDATE interview_preparations SET status='ready',completed_at=datetime('now') WHERE id=?")
        .run(preparationId);
    })();
  } catch (error) {
    if (artifact?.directory && fs.existsSync(artifact.directory)) fs.rmSync(artifact.directory, { recursive: true, force: true });
    database.transaction(() => {
      database.prepare("UPDATE interview_preparations SET status='failed',error=?,completed_at=datetime('now') WHERE id=?")
        .run(String(error.message || error).slice(0, 2000), preparationId);
      database.prepare("INSERT INTO interview_preparation_events (preparation_id,kind,payload) VALUES (?,'generation_failed',?)")
        .run(preparationId, JSON.stringify({ error: String(error.message || error).slice(0, 2000) }));
    })();
    throw new InterviewPreparationError(500, `Interview guide could not be rendered: ${error.message}`);
  }
  return { preparation: getInterviewPreparation(database, preparationId), created: true };
}

export function verifiedInterviewPreparationArtifact(database, artifactId, artifactRoot = INTERVIEW_ARTIFACT_ROOT) {
  const artifact = database.prepare(`
    SELECT a.*, p.claim_id, l.company
    FROM interview_preparation_artifacts a
    JOIN interview_preparations p ON p.id=a.preparation_id
    JOIN listings l ON l.id=p.listing_id
    WHERE a.id=?
  `).get(artifactId);
  if (!artifact) throw new InterviewPreparationError(404, 'interview preparation artifact not found');
  let verifiedPath;
  try { verifiedPath = regularFileBeneath(artifact.path, artifactRoot); }
  catch (error) { throw new InterviewPreparationError(409, `interview guide is unavailable: ${error.message}`); }
  if (sha256File(verifiedPath) !== artifact.sha256) {
    throw new InterviewPreparationError(409, 'interview guide hash drift detected');
  }
  const company = String(artifact.company || 'Company').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 64) || 'Company';
  return { ...artifact, path: verifiedPath, safe_filename: `${company}-Interview-Prep.html` };
}
