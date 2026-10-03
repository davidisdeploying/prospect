import crypto from 'node:crypto';

// Official BLS May 2025 Occupational Employment and Wage Statistics for the
// Dallas-Fort Worth-Arlington metropolitan area (area 0019100), retrieved from
// the BLS Public Data API on 2026-09-02. Keeping this small verified snapshot in
// source makes claim staking deterministic and independent of live network
// availability. Each value can be reproduced from the recorded series IDs.
export const DFW_OEWS_SNAPSHOT = Object.freeze({
  area_code: '0019100',
  area_title: 'Dallas-Fort Worth-Arlington, TX',
  data_period: 'May 2025',
  source_name: 'U.S. Bureau of Labor Statistics, Occupational Employment and Wage Statistics',
  source_url: 'https://data.bls.gov/oes/#/area/0019100/2025',
  retrieved_at: '2026-09-02',
  occupations: Object.freeze({
    '15-1231': Object.freeze({
      title: 'Computer Network Support Specialists', employment: 3340,
      annual_p25: 56200, annual_median: 75930, annual_p75: 103390,
      series_ids: ['OEUM001910000000015123101', 'OEUM001910000000015123112', 'OEUM001910000000015123113', 'OEUM001910000000015123114'],
    }),
    '15-1232': Object.freeze({
      title: 'Computer User Support Specialists', employment: 22600,
      annual_p25: 48830, annual_median: 60710, annual_p75: 74590,
      series_ids: ['OEUM001910000000015123201', 'OEUM001910000000015123212', 'OEUM001910000000015123213', 'OEUM001910000000015123214'],
    }),
    '15-1241': Object.freeze({
      title: 'Computer Network Architects', employment: 5900,
      annual_p25: 106020, annual_median: 137900, annual_p75: 167670,
      series_ids: ['OEUM001910000000015124101', 'OEUM001910000000015124112', 'OEUM001910000000015124113', 'OEUM001910000000015124114'],
    }),
    '15-1244': Object.freeze({
      title: 'Network and Computer Systems Administrators', employment: 11740,
      annual_p25: 80990, annual_median: 103260, annual_p75: 130470,
      series_ids: ['OEUM001910000000015124401', 'OEUM001910000000015124412', 'OEUM001910000000015124413', 'OEUM001910000000015124414'],
    }),
    '49-2011': Object.freeze({
      title: 'Computer, Automated Teller, and Office Machine Repairers', employment: 2650,
      annual_p25: 38960, annual_median: 46560, annual_p75: 56450,
      series_ids: ['OEUM001910000000049201101', 'OEUM001910000000049201112', 'OEUM001910000000049201113', 'OEUM001910000000049201114'],
    }),
  }),
});

export const DFW_OEWS_SNAPSHOT_SHA256 = crypto
  .createHash('sha256')
  .update(JSON.stringify(DFW_OEWS_SNAPSHOT))
  .digest('hex');

const ROLE_RULES = [
  { id: 'data-center-hardware-v1', code: '49-2011', confidence: 'medium', pattern: /\bdata\s*center\b|\bdatacenter\b|\binfrastructure\s+technician\b/i },
  { id: 'network-support-v1', code: '15-1231', confidence: 'high', pattern: /\bnetwork\s+(support|specialist|technician)\b/i },
  { id: 'network-architecture-v1', code: '15-1241', confidence: 'high', pattern: /\b(network\s+architect|network\s+engineer)\b/i },
  { id: 'systems-infrastructure-v1', code: '15-1244', confidence: 'medium', pattern: /\b(infrastructure|cloud|systems?)\s+(engineer|administrator|admin|analyst)\b|\b(information\s+technology|it|iam)\s+(administrator|admin)\b/i },
  { id: 'user-support-v1', code: '15-1232', confidence: 'high', pattern: /\b(desktop|deskside|service\s*desk|help\s*desk|it\s+support|technical\s+support|customer\s+support)\b/i },
];

const ENTRY_LEVEL_PATTERN = /\b(junior|jr\.?|associate|entry[- ]level|level\s*(?:1|i)|(?:engineer|technician)\s+i)\b/i;

function roundToThousand(value) {
  return Math.round(Number(value) / 1000) * 1000;
}

function candidateSalaryAnswer(suggestedMin, suggestedMax) {
  const analyticalMin = Number(suggestedMin);
  const analyticalMax = Number(suggestedMax);
  const roundedMin = Math.ceil(analyticalMin / 10000) * 10000;
  const roundedMax = Math.floor(analyticalMax / 10000) * 10000;
  const answerMin = roundedMin <= roundedMax ? roundedMin : analyticalMin;
  const answerMax = roundedMin <= roundedMax ? roundedMax : analyticalMax;
  const amount = answerMin === answerMax
    ? `$${answerMin.toLocaleString('en-US')}`
    : `$${answerMin.toLocaleString('en-US')}–$${answerMax.toLocaleString('en-US')}`;
  return {
    answer_min: answerMin,
    answer_max: answerMax,
    response_text: `My target base salary is ${amount}, depending on the role's scope and total compensation.`,
  };
}

function annualRangeFromDescription(description) {
  const match = String(description || '').match(
    /\bbase salary range(?: for this role)?(?: is|:)\s*\$([\d,]+)\s*(?:-|–|—|to)\s*\$([\d,]+)/i,
  );
  if (!match) return null;
  const min = Number(match[1].replaceAll(',', ''));
  const max = Number(match[2].replaceAll(',', ''));
  return Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min
    ? { min, max, source: 'captured description' }
    : null;
}

export function employerAnnualRange(listing) {
  const min = Number(listing?.annual_comp_min);
  const max = Number(listing?.annual_comp_max);
  if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min) {
    return { min, max, source: 'captured compensation fields' };
  }
  return annualRangeFromDescription(listing?.description);
}

export function applyEmployerRange(guidance, listing) {
  if (!guidance || guidance.status !== 'ready') return guidance;
  const employer = employerAnnualRange(listing);
  if (!employer) return { ...guidance, ...candidateSalaryAnswer(guidance.suggested_min, guidance.suggested_max) };

  const marketMin = Number(guidance.suggested_min);
  const marketMax = Number(guidance.suggested_max);
  const overlapMin = Math.max(marketMin, employer.min);
  const overlapMax = Math.min(marketMax, employer.max);
  const suggestedMin = overlapMin <= overlapMax ? overlapMin : employer.min;
  const suggestedMax = overlapMin <= overlapMax ? overlapMax : employer.max;

  return {
    ...guidance,
    market_suggested_min: marketMin,
    market_suggested_max: marketMax,
    employer_range_min: employer.min,
    employer_range_max: employer.max,
    employer_range_source: employer.source,
    suggested_min: suggestedMin,
    suggested_max: suggestedMax,
    range_basis: `${guidance.range_basis}; intersected with employer posted range`,
    ...candidateSalaryAnswer(suggestedMin, suggestedMax),
  };
}

export function matchDfwOccupation(role) {
  const normalizedRole = String(role || '').trim();
  const rule = ROLE_RULES.find((candidate) => candidate.pattern.test(normalizedRole));
  if (!rule) return null;
  return {
    code: rule.code,
    rule_id: rule.id,
    confidence: rule.confidence,
    occupation: DFW_OEWS_SNAPSHOT.occupations[rule.code],
  };
}

export function buildSalaryGuidance(listing) {
  const match = matchDfwOccupation(listing?.role);
  const base = {
    status: match ? 'ready' : 'unavailable',
    area_code: DFW_OEWS_SNAPSHOT.area_code,
    area_title: DFW_OEWS_SNAPSHOT.area_title,
    data_period: DFW_OEWS_SNAPSHOT.data_period,
    source_name: DFW_OEWS_SNAPSHOT.source_name,
    source_url: DFW_OEWS_SNAPSHOT.source_url,
    source_retrieved_at: DFW_OEWS_SNAPSHOT.retrieved_at,
    dataset_sha256: DFW_OEWS_SNAPSHOT_SHA256,
  };
  if (!match) {
    return {
      ...base,
      mapping_rule: 'no-supported-title-match-v1',
      mapping_confidence: 'none',
      unavailable_reason: 'No reliable BLS occupation match for this title.',
    };
  }

  const entryLevel = ENTRY_LEVEL_PATTERN.test(String(listing?.role || ''))
    || String(listing?.seniority || '').toLowerCase() === 'entry_level';
  const low = entryLevel ? match.occupation.annual_p25 : match.occupation.annual_median;
  const high = entryLevel ? match.occupation.annual_median : match.occupation.annual_p75;
  const suggestedMin = roundToThousand(low);
  const suggestedMax = roundToThousand(high);
  const rangeBasis = entryLevel ? '25th percentile to median' : 'median to 75th percentile';

  return {
    ...base,
    occupation_code: match.code,
    occupation_title: match.occupation.title,
    mapping_rule: match.rule_id,
    mapping_confidence: match.confidence,
    employment: match.occupation.employment,
    annual_p25: match.occupation.annual_p25,
    annual_median: match.occupation.annual_median,
    annual_p75: match.occupation.annual_p75,
    suggested_min: suggestedMin,
    suggested_max: suggestedMax,
    range_basis: rangeBasis,
    response_text: candidateSalaryAnswer(suggestedMin, suggestedMax).response_text,
    source_series_json: JSON.stringify(match.occupation.series_ids),
  };
}

export function hasSalaryGuidanceTable(database) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='salary_guidance'").get());
}

export function getSalaryGuidance(database, listingId) {
  if (!listingId || !hasSalaryGuidanceTable(database)) return null;
  const guidance = database.prepare('SELECT * FROM salary_guidance WHERE listing_id = ? ORDER BY id DESC LIMIT 1').get(listingId) || null;
  if (!guidance) return null;
  const listing = database.prepare(`
    SELECT role, seniority, description, annual_comp_min, annual_comp_max
    FROM listings WHERE id = ?
  `).get(listingId);
  return applyEmployerRange(guidance, listing);
}

export function ensureSalaryGuidance(database, { claimId, listingId }) {
  if (!claimId || !listingId || !hasSalaryGuidanceTable(database)) return null;
  const existing = getSalaryGuidance(database, listingId);
  if (existing) return existing;
  const listing = database.prepare(`
    SELECT role, seniority, description, annual_comp_min, annual_comp_max
    FROM listings WHERE id = ?
  `).get(listingId);
  if (!listing) return null;
  const guidance = buildSalaryGuidance(listing);
  database.prepare(`
    INSERT INTO salary_guidance (
      claim_id, listing_id, status, area_code, area_title, data_period,
      occupation_code, occupation_title, mapping_rule, mapping_confidence,
      employment, annual_p25, annual_median, annual_p75,
      suggested_min, suggested_max, range_basis, response_text,
      unavailable_reason, source_name, source_url, source_series_json,
      source_retrieved_at, dataset_sha256
    ) VALUES (
      @claim_id, @listing_id, @status, @area_code, @area_title, @data_period,
      @occupation_code, @occupation_title, @mapping_rule, @mapping_confidence,
      @employment, @annual_p25, @annual_median, @annual_p75,
      @suggested_min, @suggested_max, @range_basis, @response_text,
      @unavailable_reason, @source_name, @source_url, @source_series_json,
      @source_retrieved_at, @dataset_sha256
    ) ON CONFLICT(listing_id) DO NOTHING
  `).run({
    claim_id: claimId,
    listing_id: listingId,
    occupation_code: null,
    occupation_title: null,
    employment: null,
    annual_p25: null,
    annual_median: null,
    annual_p75: null,
    suggested_min: null,
    suggested_max: null,
    range_basis: null,
    response_text: null,
    unavailable_reason: null,
    source_series_json: null,
    ...guidance,
  });
  return getSalaryGuidance(database, listingId);
}

export function backfillSalaryGuidance(database) {
  if (!hasSalaryGuidanceTable(database)) return { inserted: 0, total: 0 };
  const rows = database.prepare(`
    SELECT c.id AS claim_id, c.listing_id
    FROM claims c
    LEFT JOIN salary_guidance sg ON sg.listing_id = c.listing_id
    WHERE sg.id IS NULL
    ORDER BY c.id
  `).all();
  let inserted = 0;
  for (const row of rows) {
    if (ensureSalaryGuidance(database, { claimId: row.claim_id, listingId: row.listing_id })) inserted += 1;
  }
  return { inserted, total: rows.length };
}
