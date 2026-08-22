// §5.2.4 job-family clustering: deterministic title-normalization only — no
// embeddings, no vec reads, no LLM. Classifies on the listing's role TITLE
// only (description/JD text adds noise, not signal).
//
// NOTE: this is a DIFFERENT concept from listings.role_family (the locked
// §1.2 enum vocab in ENUMS.role_family, populated by the LinkedIn extension
// adapter from LinkedIn's own job-function criteria). This module writes to
// its own new column, listings.job_family, and never touches role_family.

// Ordered {pattern -> family} rules, first match wins. Add a family by
// appending one entry. Values are lowercase slugs (matches role_family's
// stored-value convention); display-casing is a UI concern.
export const JOB_FAMILY_RULES = [
  { pattern: /datacenter|data center/, family: 'datacenter' },
  { pattern: /desktop/, family: 'desktop_support' },
  { pattern: /it support|technical support|help desk|helpdesk|service desk/, family: 'it_support' },
];

export const UNCATEGORIZED = 'uncategorized';

function normalizeTitle(title) {
  return String(title ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyJobFamily(role) {
  const normalized = normalizeTitle(role);
  if (!normalized) return UNCATEGORIZED;
  for (const { pattern, family } of JOB_FAMILY_RULES) {
    if (pattern.test(normalized)) return family;
  }
  return UNCATEGORIZED;
}
