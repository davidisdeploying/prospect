// server/selection.js — §6.4 selection-process intelligence. All-SELECT read model over the three
// tables migration 020 adds: the interview log, the question bank, and company-scoped process
// artifacts.
//
// The organising idea is that selection processes REPEAT PER COMPANY. A role changes, a recruiter
// changes, but the assessment format and the interview questions a company runs are remarkably
// stable — which is why the artifacts hang off companies rather than claims, and why the question
// bank's most useful output is recurrence rather than a flat list.
//
// What this module will not do: infer a "process" a company follows from one sighting. A format
// seen once is reported as seen once. `recurring` means genuinely more than one observation, and
// everything else is listed as a single occurrence, because a sample of one dressed up as a pattern
// is how a tracker starts lying to its owner.

export const INTERVIEW_KINDS = Object.freeze([
  'phone_screen', 'recruiter_screen', 'technical', 'panel', 'onsite', 'assessment', 'final', 'other',
]);

export const ARTIFACT_KINDS = Object.freeze([
  'assessment_guide', 'process_note', 'interview_format', 'take_home', 'other',
]);

const INTERVIEW_KIND_GLOSS = {
  phone_screen: 'Phone screen',
  recruiter_screen: 'Recruiter screen',
  technical: 'Technical',
  panel: 'Panel',
  onsite: 'On-site',
  assessment: 'Assessment',
  final: 'Final',
  other: 'Other',
};

export function interviewKindGloss(kind) {
  return INTERVIEW_KIND_GLOSS[kind] || kind || 'Unknown';
}

function tableMissing(db, name) {
  return db.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name).n === 0;
}

const EMPTY = {
  available: false,
  interviews: [],
  question_bank: { total: 0, recurring: [], all: [] },
  companies: [],
  totals: { interviews: 0, held: 0, scheduled_not_held: 0, questions: 0, artifacts: 0 },
};

// computeSelectionIntel(db) -> read model. Degrades to an explicitly unavailable shape on a pre-020
// database rather than throwing, matching jobFamilyReport.js's feature-detect posture.
export function computeSelectionIntel(db) {
  if (tableMissing(db, 'interviews')) return { ...EMPTY };

  const interviews = db.prepare(`
    SELECT
      i.*, c.stage, l.company, l.role, l.company_id,
      ct.name AS interviewer_name, ct.role AS interviewer_role
    FROM interviews i
    JOIN claims c ON c.id = i.claim_id
    LEFT JOIN listings l ON l.id = c.listing_id
    LEFT JOIN contacts ct ON ct.id = i.contact_id
    ORDER BY COALESCE(i.occurred_at, i.scheduled_at) DESC, i.id DESC
  `).all().map((row) => ({
    ...row,
    kind_gloss: interviewKindGloss(row.kind),
    // Scheduled-but-never-held is a real outcome, not missing data, so it is named rather than
    // silently folded in with interviews that simply have no date yet.
    held: row.occurred_at != null,
    scheduled_not_held: row.occurred_at == null && row.scheduled_at != null,
  }));

  const questions = db.prepare(`
    SELECT q.*, co.name AS company_name, l.role
    FROM interview_questions q
    LEFT JOIN companies co ON co.id = q.company_id
    LEFT JOIN claims c ON c.id = q.claim_id
    LEFT JOIN listings l ON l.id = c.listing_id
    ORDER BY q.created_at DESC, q.id DESC
  `).all();

  // Recurrence is keyed on normalized question text: the same question asked at two companies is
  // the interesting signal, and punctuation/casing should not hide it.
  const byNormalized = new Map();
  for (const q of questions) {
    const key = String(q.question || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
    if (!key) continue;
    if (!byNormalized.has(key)) byNormalized.set(key, { question: q.question, occurrences: [], companies: new Set() });
    const entry = byNormalized.get(key);
    entry.occurrences.push(q);
    if (q.company_name) entry.companies.add(q.company_name);
  }
  const recurring = [...byNormalized.values()]
    .filter((entry) => entry.occurrences.length > 1)
    .map((entry) => ({
      question: entry.question,
      times_asked: entry.occurrences.length,
      companies: [...entry.companies].sort(),
    }))
    .sort((a, b) => b.times_asked - a.times_asked);

  const artifacts = tableMissing(db, 'company_process_artifacts') ? [] : db.prepare(`
    SELECT a.*, co.name AS company_name
    FROM company_process_artifacts a
    LEFT JOIN companies co ON co.id = a.company_id
    ORDER BY a.created_at DESC, a.id DESC
  `).all();

  // Company-scoped rollup: what is actually known about how each company selects.
  const companyMap = new Map();
  const ensureCompany = (id, name) => {
    const key = id ?? `name:${name}`;
    if (!companyMap.has(key)) {
      companyMap.set(key, {
        company_id: id ?? null, company: name || 'Unknown',
        interview_kinds: new Map(), questions: 0, artifacts: [], interviews: 0,
      });
    }
    return companyMap.get(key);
  };
  for (const row of interviews) {
    const entry = ensureCompany(row.company_id, row.company);
    entry.interviews += 1;
    entry.interview_kinds.set(row.kind, (entry.interview_kinds.get(row.kind) || 0) + 1);
  }
  for (const q of questions) if (q.company_id != null || q.company_name) ensureCompany(q.company_id, q.company_name).questions += 1;
  for (const a of artifacts) ensureCompany(a.company_id, a.company_name).artifacts.push({ id: a.id, kind: a.kind, title: a.title });

  const companies = [...companyMap.values()].map((entry) => ({
    company_id: entry.company_id,
    company: entry.company,
    interviews: entry.interviews,
    questions: entry.questions,
    artifacts: entry.artifacts,
    // A stage seen once is reported as seen once -- `recurring` is strictly more than one.
    stages: [...entry.interview_kinds.entries()]
      .map(([kind, count]) => ({ kind, gloss: interviewKindGloss(kind), count, recurring: count > 1 }))
      .sort((a, b) => b.count - a.count),
  })).sort((a, b) => (b.interviews + b.artifacts.length) - (a.interviews + a.artifacts.length));

  return {
    available: true,
    interviews,
    question_bank: { total: questions.length, recurring, all: questions },
    companies,
    totals: {
      interviews: interviews.length,
      held: interviews.filter((i) => i.held).length,
      scheduled_not_held: interviews.filter((i) => i.scheduled_not_held).length,
      questions: questions.length,
      artifacts: artifacts.length,
    },
  };
}
