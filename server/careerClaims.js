import crypto from 'node:crypto';
import fs from 'node:fs';
import { parse } from 'yaml';

export const DEFAULT_CAREER_CLAIMS_PATH = '/home/david/Vaults/career-vault/research/skills-credentials-claims.md';

function fail(message) {
  throw new Error(`invalid Career claims source: ${message}`);
}

function requireText(record, field, claimId) {
  if (typeof record[field] !== 'string' || !record[field].trim()) fail(`${claimId}.${field} must be nonblank text`);
}

function requireStringArray(record, field, claimId, optional = false) {
  if (optional && record[field] == null) return [];
  if (!Array.isArray(record[field]) || record[field].some((item) => typeof item !== 'string' || !item.trim())) {
    fail(`${claimId}.${field} must be an array of nonblank strings`);
  }
  return record[field].map((item) => item.trim());
}

export function extractCareerClaimsYaml(markdown) {
  const blocks = [...String(markdown).matchAll(/^```yaml[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gmi)];
  if (blocks.length !== 1) fail(`expected exactly one fenced yaml block, found ${blocks.length}`);
  return blocks[0][1];
}

export function parseCareerClaimsMarkdown(markdown, sourcePath = '<memory>') {
  let document;
  try {
    document = parse(extractCareerClaimsYaml(markdown), { prettyErrors: true, uniqueKeys: true });
  } catch (error) {
    if (String(error.message).startsWith('invalid Career claims source:')) throw error;
    fail(`malformed YAML in ${sourcePath}: ${error.message}`);
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) fail('top level must be an object');
  if (!Number.isInteger(document.schema_version) || document.schema_version < 1) fail('schema_version must be a positive integer');
  if (typeof document.person !== 'string' || !document.person.trim()) fail('person must be nonblank text');
  if (!Array.isArray(document.claims) || document.claims.length === 0) fail('claims must be a nonempty array');

  const ids = new Set();
  const claims = document.claims.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`claims[${index}] must be an object`);
    requireText(raw, 'claim_id', `claims[${index}]`);
    const claimId = raw.claim_id.trim();
    if (ids.has(claimId)) fail(`duplicate claim_id ${claimId}`);
    ids.add(claimId);
    for (const field of ['kind', 'status', 'evidence_class', 'claim', 'safe_language', 'confidence']) requireText(raw, field, claimId);
    const prohibitedInference = requireStringArray(raw, 'prohibited_inference', claimId);
    const sourceRefs = requireStringArray(raw, 'source_refs', claimId);
    const matchTerms = requireStringArray(raw, 'match_terms', claimId, true);
    const jobFamilies = requireStringArray(raw, 'job_families', claimId, true);
    // Canonical v2 uses `conditional` for statements that need an audit guard. Expose a
    // strict boolean to consumers while retaining that source qualifier separately.
    if (typeof raw.public_safe !== 'boolean' && raw.public_safe !== 'conditional') {
      fail(`${claimId}.public_safe must be boolean or the canonical conditional qualifier`);
    }
    return Object.freeze({
      ...raw,
      claim_id: claimId,
      kind: raw.kind.trim(),
      status: raw.status.trim(),
      evidence_class: raw.evidence_class.trim(),
      claim: raw.claim.trim(),
      safe_language: raw.safe_language.trim(),
      confidence: raw.confidence.trim(),
      prohibited_inference: prohibitedInference,
      source_refs: sourceRefs,
      match_terms: matchTerms,
      job_families: jobFamilies,
      public_safe_status: raw.public_safe,
      public_safe: raw.public_safe === true,
    });
  });
  const claimsById = Object.freeze(Object.fromEntries(claims.map((claim) => [claim.claim_id, claim])));
  return Object.freeze({
    source_path: sourcePath,
    source_sha256: crypto.createHash('sha256').update(String(markdown)).digest('hex'),
    schema_version: document.schema_version,
    person: document.person.trim(),
    claims: Object.freeze(claims),
    claims_by_id: claimsById,
  });
}

export function loadCareerClaims(sourcePath = process.env.CAREER_CLAIMS_PATH || DEFAULT_CAREER_CLAIMS_PATH) {
  return parseCareerClaimsMarkdown(fs.readFileSync(sourcePath, 'utf8'), sourcePath);
}
