import React from 'react';
import { Badge, STAGE_TONE } from '@ds/components/core/Badge.jsx';
import { Tag } from '@ds/components/core/Tag.jsx';
import { KeyValue } from '@ds/components/data/KeyValue.jsx';
import { Textarea } from '@ds/components/forms/Textarea.jsx';
import { Input, labelStyle } from '@ds/components/forms/Input.jsx';
import { Button } from '@ds/components/core/Button.jsx';
import { IconButton } from '@ds/components/core/IconButton.jsx';
import { Tooltip } from '@ds/components/feedback/Tooltip.jsx';
import { EmptyState } from '@ds/components/data/EmptyState.jsx';
import { ALL_STAGES } from './stages.js';
import {
  getClaim, listResumeVersions, addNote, addClaimEvent, resolveClaimEvent, patchClaim,
  deleteClaim, createJobAudit, getJobAudit, getWaypointHandoff, getApplicationPackages,
  prepareApplicationPackage, registerApplicationPackageArtifact, appendApplicationPackageEvent,
  regenerateApplicationPackage, applicationArtifactDownloadUrl,
  prepareInterview, getInterviewPreparation, retryInterviewResearch, interviewPrepArtifactDownloadUrl,
} from './api.js';
import { DeleteClaimDialog } from './DeleteClaimDialog.jsx';
import { AddClaimEventDialog } from './AddClaimEventDialog.jsx';
import { ResolveClaimEventDialog } from './ResolveClaimEventDialog.jsx';

const GLOSS_BY_STAGE = Object.fromEntries(ALL_STAGES.map((s) => [s.key, s.gloss]));

// Source of truth: server/validate.js ENUMS.transition_cause / outcome_reason — keep in sync.
const TRANSITION_CAUSE_GLOSS = {
  stake: 'staked', manual: 'manual move', timeout: 'ghost timer', system: 'automated', other: 'other',
};
const OUTCOME_REASON_GLOSS = {
  rejected: 'rejected', ghosted: 'ghosted', withdrawn: 'withdrawn', closed: 'closed', declined: 'declined', timeout: 'timed out', other: 'other',
};
// Source of truth: server/validate.js ENUMS.claim_event_kind — keep in sync.
const CLAIM_EVENT_KIND_GLOSS = {
  assessment_requested: 'Assessment requested',
  assessment_completed: 'Assessment completed',
  recruiter_contact: 'Recruiter contact',
  employer_email: 'Employer email',
  status_check: 'Status check',
  deadline_resolved: 'Deadline resolved',
};
const DEADLINE_RESOLUTION_GLOSS = {
  completed: 'completed',
  no_longer_required: 'no longer required',
  superseded: 'superseded',
};

// payloadNoteText(payload) -> string | null — claim_events.payload follows listings.parsed's
// precedent (nullable JSON TEXT); the add-touchpoint dialog stores a freeform note as {note}.
function payloadNoteText(payload) {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    if (parsed && typeof parsed === 'object' && typeof parsed.note === 'string') return parsed.note;
    if (parsed && typeof parsed === 'object') return null;
  } catch { /* not JSON -- fall through and render the raw string */ }
  return String(payload);
}

function claimEventDetailText(event) {
  if (event.kind !== 'deadline_resolved') return payloadNoteText(event.payload);
  try {
    const payload = JSON.parse(event.payload);
    if (!payload || typeof payload !== 'object') return null;
    const target = Number.isInteger(payload.resolved_event_id)
      ? `gate #${payload.resolved_event_id}`
      : 'gate';
    const reason = DEADLINE_RESOLUTION_GLOSS[payload.resolution_reason] || payload.resolution_reason;
    return [target, reason, payload.note].filter(Boolean).join(' · ');
  } catch {
    return null;
  }
}

// The modal spends the view's one gold accent on the logbook "Add" submit —
// the stage badge is intentionally demoted off STAGE_TONE's gold for Strike
// so a Strike claim doesn't spend a second gold in the same view.
function badgeToneFor(stage) {
  const tone = STAGE_TONE[stage] || 'neutral';
  return tone === 'gold' ? 'positive' : tone;
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform var(--dur-flick) var(--ease-sluice)' }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6M10 14 21 3" />
    </svg>
  );
}

function httpUrlOrNull(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

// Keep the two application routes visible at the decision point instead of
// burying them in the captured-snapshot metadata. Easy Apply happens on the
// source listing; external applications use the captured employer/ATS URL.
export function ClaimApplyLinks({ listing }) {
  const easyApplyUrl = listing?.easy_apply ? httpUrlOrNull(listing.source_url) : null;
  const employerApplyUrl = httpUrlOrNull(listing?.apply_url);

  if (!easyApplyUrl && !employerApplyUrl) return null;

  return (
    <nav className="claim-apply-links" aria-label="Application links">
      {easyApplyUrl && (
        <a className="claim-apply-link" href={easyApplyUrl} target="_blank" rel="noreferrer noopener">
          Easy Apply <ExternalLinkIcon />
        </a>
      )}
      {employerApplyUrl && (
        <a className="claim-apply-link" href={employerApplyUrl} target="_blank" rel="noreferrer noopener">
          Apply on employer website <ExternalLinkIcon />
        </a>
      )}
    </nav>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.12em',
      textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10,
    }}>{children}</div>
  );
}

function humanize(v) {
  if (v == null) return v;
  return String(v).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatMoney(n) {
  if (n == null) return null;
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString('en-US', { maximumFractionDigits: 0 }) : null;
}

function salaryRangeText(listing) {
  const min = formatMoney(listing.salary_min);
  const max = formatMoney(listing.salary_max);
  if (min == null && max == null) return null;
  const cur = listing.salary_currency || 'USD';
  const range = min != null && max != null ? `${min}–${max}` : (min ?? max);
  const period = listing.salary_period ? ` / ${humanize(listing.salary_period)}` : '';
  return `${cur} ${range}${period}`;
}

function parseListingParsed(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Allowlist HTML -> React renderer (v3a item 5). listing.description already
// arrives pre-sanitized by the extension adapter's cleanDescriptionHtml(),
// but this renders defensively regardless -- it independently allowlists on
// the way out too (never trusts stored HTML blindly, e.g. a manually-staked
// claim or a future non-LinkedIn adapter might not sanitize). NEVER uses
// dangerouslySetInnerHTML. Non-allowlisted elements are unwrapped (their
// children still render); an <a> survives only with an http(s) href.
const DESCRIPTION_RENDER_ALLOWLIST = new Set(['P', 'UL', 'OL', 'LI', 'A', 'STRONG', 'B', 'EM', 'I', 'BR', 'H3', 'H4']);

function domNodeToReact(node, key) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return null;
  const tag = node.tagName;
  if (tag === 'BR') return <br key={key} />;
  const children = Array.from(node.childNodes).map((child, i) => domNodeToReact(child, `${key}-${i}`));
  if (!DESCRIPTION_RENDER_ALLOWLIST.has(tag)) return children;
  if (tag === 'A') {
    const href = node.getAttribute('href');
    if (href && /^https?:\/\//i.test(href)) {
      return <a key={key} href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
    }
    return children;
  }
  return React.createElement(tag.toLowerCase(), { key }, children);
}

// Named export purely for the jsdom render test (app has no test harness of
// its own yet) -- not otherwise used outside this module.
export function renderCleanHtml(cleanHtml) {
  if (!cleanHtml) return null;
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(cleanHtml, 'text/html');
    return Array.from(doc.body.childNodes).map((n, i) => domNodeToReact(n, i));
  }
  // No DOMParser (SSR/node): fall back to tag-stripped plain text. Still
  // XSS-safe either way -- this path just loses structure, never markup.
  return cleanHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

const COMPETITION_FLAGS = [
  ['easy_apply', 'Easy Apply'],
  ['promoted', 'Promoted'],
  ['verified', 'Verified'],
  ['actively_reviewing', 'Actively reviewing'],
  ['top_applicant_match', 'Top applicant match'],
];

// Read-only view of listings.parsed.llm_parse (server/llmParse.js, PROSPECT_LLM_PARSE-gated,
// currently OFF -- empty on every live row). Default collapsed: this is the first disclosure
// panel in the modal and shouldn't force itself open on every claim. Every field is free text
// from an unvalidated model response (llmParse.js never checks the shape it writes), so each
// one is type-guarded here rather than trusted. Never gold (parsed_by Tag precedent above).
function AiParsePanel({ llmParse }) {
  const [open, setOpen] = React.useState(false);

  const roleHint = typeof llmParse.role_hint === 'string' ? llmParse.role_hint : null;
  const skillsProse = typeof llmParse.skills_prose === 'string' ? llmParse.skills_prose : null;
  const compProse = typeof llmParse.comp_prose === 'string' ? llmParse.comp_prose : null;
  const sections = llmParse.sections && typeof llmParse.sections === 'object' && !Array.isArray(llmParse.sections)
    ? Object.entries(llmParse.sections).filter(([, text]) => typeof text === 'string')
    : [];
  const model = typeof llmParse.model === 'string' ? llmParse.model : null;
  const generatedAt = typeof llmParse.generated_at === 'string' ? llmParse.generated_at : null;

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--line)' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
          padding: 0, cursor: 'pointer', color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.05em', textTransform: 'uppercase',
        }}
      >
        <ChevronIcon open={open} /> AI parse
      </button>
      {open && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {roleHint && (
            <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-soft)' }}>{roleHint}</div>
          )}
          {skillsProse && (
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Skills</div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-soft)', whiteSpace: 'pre-wrap' }}>{skillsProse}</p>
            </div>
          )}
          {compProse && (
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Comp</div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-soft)', whiteSpace: 'pre-wrap' }}>{compProse}</p>
            </div>
          )}
          {sections.map(([name, text]) => (
            <div key={name}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                {humanize(name)}
              </div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-soft)', whiteSpace: 'pre-wrap' }}>{text}</p>
            </div>
          ))}
          {(model || generatedAt) && (
            <Tag style={{ alignSelf: 'flex-start' }}>
              AI-generated{model ? ` · ${model}` : ''}{generatedAt ? ` · ${generatedAt}` : ''}
            </Tag>
          )}
        </div>
      )}
    </div>
  );
}

// Exported purely for the AI Parse panel regression test (same precedent as
// renderCleanHtml above) -- not otherwise used outside this module.
export function CapturedSnapshot({ listing, closing }) {
  const applicantsBits = [];
  if (listing.applicant_count != null) applicantsBits.push(String(listing.applicant_count));
  if (listing.applicants_last_day != null) applicantsBits.push(`+${listing.applicants_last_day} last day`);
  if (listing.applicants_per_day != null) applicantsBits.push(`${Number(listing.applicants_per_day).toFixed(1)}/day`);

  const locationDetail = [listing.location_city, listing.location_state, listing.location_metro]
    .filter(Boolean).join(', ');

  const rows = [
    listing.company && { k: 'Company', v: listing.company },
    listing.role && { k: 'Role', v: listing.role },
    listing.location && { k: 'Location', v: listing.location },
    locationDetail && { k: 'Location detail', v: locationDetail },
    listing.comp && { k: 'Comp', v: listing.comp, num: true },
    listing.employment_type && { k: 'Employment type', v: humanize(listing.employment_type) },
    listing.workplace_type && { k: 'Workplace', v: humanize(listing.workplace_type) },
    listing.seniority && { k: 'Seniority', v: humanize(listing.seniority) },
    listing.role_family && { k: 'Role family', v: humanize(listing.role_family) },
    salaryRangeText(listing) && { k: 'Salary range', v: salaryRangeText(listing), num: true },
    listing.annual_comp_mid != null && { k: 'Annualized', v: `≈ ${formatMoney(listing.annual_comp_mid)} ${listing.salary_currency || 'USD'}`, num: true },
    listing.comp_disclosed != null && { k: 'Comp disclosed', v: listing.comp_disclosed ? 'Yes' : 'No' },
    applicantsBits.length > 0 && { k: 'Applicants', v: applicantsBits.join(' · '), num: true },
    listing.posting_quality && { k: 'Posting quality', v: humanize(listing.posting_quality) },
    listing.source_url
      ? { k: 'Source', v: (
          <a href={listing.source_url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-body)' }}>
            {listing.source}<ExternalLinkIcon />
          </a>
        ) }
      : listing.source && { k: 'Source', v: listing.source },
    listing.posted_at && { k: 'Posted', v: listing.posted_at, num: true },
    listing.job_id && { k: 'Job ID', v: listing.job_id, num: true },
    listing.external_job_id && { k: 'External job ID', v: listing.external_job_id, num: true },
    listing.apply_url && { k: 'Apply', v: (
        <a href={listing.apply_url} target="_blank" rel="noreferrer noopener" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-body)' }}>
          {listing.apply_url}<ExternalLinkIcon />
        </a>
      ) },
  ].filter(Boolean);

  const activeFlags = COMPETITION_FLAGS.filter(([key]) => listing[key]);
  const parsed = parseListingParsed(listing.parsed);
  const sections = parsed?.sections && typeof parsed.sections === 'object' ? Object.entries(parsed.sections) : [];

  // v3a item 4 long-tail: scalars as KeyValue rows, lists as bullets,
  // candidate_pool as its own small labeled sub-block -- same never-gold
  // styling as the rest of this parsed_by-tagged block.
  const longTailRows = [
    parsed?.normalized_role && { k: 'Normalized role', v: parsed.normalized_role },
    parsed?.company_legal_name && { k: 'Company (legal)', v: parsed.company_legal_name },
    parsed?.company_review_time && { k: 'Company review time', v: parsed.company_review_time },
    parsed?.apply_nuance && { k: 'Apply nuance', v: parsed.apply_nuance },
  ].filter(Boolean);
  const benefits = Array.isArray(parsed?.benefits) ? parsed.benefits : [];
  const industries = Array.isArray(parsed?.industries) ? parsed.industries : [];
  const candidatePool = parsed?.candidate_pool && typeof parsed.candidate_pool === 'object' ? parsed.candidate_pool : null;
  const seniorityMix = candidatePool?.seniority_mix && typeof candidatePool.seniority_mix === 'object'
    ? Object.entries(candidatePool.seniority_mix) : [];
  const hasLongTail = longTailRows.length > 0 || benefits.length > 0 || industries.length > 0 || !!candidatePool;
  const llmParse = parsed?.llm_parse && typeof parsed.llm_parse === 'object' && !Array.isArray(parsed.llm_parse)
    ? parsed.llm_parse : null;

  return (
    <div className={`claim-snapshot${closing ? ' is-closing' : ''}`} style={{
      background: 'var(--bg-sunken)', border: '1px solid var(--line)',
      borderRadius: 'var(--r-md)', padding: 16,
      boxShadow: 'inset 0 1px 3px rgba(0,0,0,.35)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <SectionLabel>Captured snapshot</SectionLabel>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>
          from {listing.source || 'unknown'} · {listing.captured_at}
        </span>
      </div>
      {listing.repost_of != null && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)', marginBottom: 12 }}>
          Repost of claim #{listing.repost_of_claim_id ?? listing.repost_of} · generation {listing.snapshot_generation || 1}
        </div>
      )}
      {rows.length > 0 && <KeyValue rows={rows} />}
      {activeFlags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {activeFlags.map(([key, label]) => <Tag key={key}>{label}</Tag>)}
        </div>
      )}
      {listing.description && (
        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-soft)', marginTop: 14 }}>
          {renderCleanHtml(listing.description)}
        </div>
      )}
      {parsed && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <SectionLabel>Parsed sections</SectionLabel>
            {parsed.parsed_by && <Tag>parsed_by: {parsed.parsed_by}</Tag>}
          </div>
          {sections.length > 0 ? sections.map(([name, bullets]) => (
            <div key={name} style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                {humanize(name)}
              </div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {(bullets || []).map((b, i) => (
                  <li key={i} style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-soft)' }}>{b}</li>
                ))}
              </ul>
            </div>
          )) : !hasLongTail && (
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>No sections detected.</p>
          )}
          {longTailRows.length > 0 && (
            <div style={{ marginTop: sections.length > 0 ? 10 : 0, marginBottom: 10 }}>
              <KeyValue rows={longTailRows} />
            </div>
          )}
          {benefits.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Benefits</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {benefits.map((b, i) => (
                  <li key={i} style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-soft)' }}>{b}</li>
                ))}
              </ul>
            </div>
          )}
          {industries.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Industries</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {industries.map((ind, i) => (
                  <li key={i} style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-soft)' }}>{ind}</li>
                ))}
              </ul>
            </div>
          )}
          {candidatePool && (
            <div style={{
              marginTop: 4, padding: 10, background: 'var(--surface-card)',
              border: '1px solid var(--line)', borderRadius: 'var(--r-sm, 6px)',
            }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Candidate pool</div>
              <div style={{ fontSize: 13, color: 'var(--text-soft)' }}>
                {candidatePool.total != null && <span>{candidatePool.total} total</span>}
                {candidatePool.total != null && candidatePool.past_day != null && ' · '}
                {candidatePool.past_day != null && <span>+{candidatePool.past_day} last day</span>}
              </div>
              {seniorityMix.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {seniorityMix.map(([level, pct]) => (
                    <Tag key={level}>{humanize(level)}: {pct}%</Tag>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {llmParse && <AiParsePanel llmParse={llmParse} />}
    </div>
  );
}

export function SalaryGuidancePanel({ guidance }) {
  const [copyState, setCopyState] = React.useState('idle');
  if (!guidance) return null;

  if (guidance.status !== 'ready') {
    return (
      <section className="salary-guidance salary-guidance--unavailable" aria-labelledby="salary-guidance-title">
        <div>
          <SectionLabel>DFW salary guidance</SectionLabel>
          <h3 id="salary-guidance-title">No reliable occupation match yet</h3>
          <p>{guidance.unavailable_reason || 'Prospect could not map this title to a supported BLS occupation.'}</p>
        </div>
        <span className="salary-guidance-vintage">{guidance.data_period} BLS OEWS</span>
      </section>
    );
  }

  const sourceUrl = httpUrlOrNull(guidance.source_url);
  const responseText = String(guidance.response_text || '');
  const answerMin = guidance.answer_min ?? guidance.suggested_min;
  const answerMax = guidance.answer_max ?? guidance.suggested_max;
  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(responseText);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  }

  return (
    <section className="salary-guidance" aria-labelledby="salary-guidance-title">
      <div className="salary-guidance-head">
        <div>
          <SectionLabel>DFW salary guidance</SectionLabel>
          <h3 id="salary-guidance-title">Suggested salary answer</h3>
          <p>Use this as a market anchor, then adjust for the employer's stated range, benefits, and the role's actual scope.</p>
        </div>
        <span className="salary-guidance-vintage">{guidance.data_period} BLS OEWS</span>
      </div>

      <div className="salary-guidance-answer">
        <strong>{formatMoney(answerMin)}{answerMin === answerMax ? '' : `–${formatMoney(answerMax)}`}</strong>
        <p>{responseText}</p>
        <Button variant="quiet" size="sm" onClick={copyAnswer} disabled={!responseText}>
          {copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy answer'}
        </Button>
      </div>

      {guidance.employer_range_min != null && guidance.employer_range_max != null && (
        <div className="salary-guidance-source">
          <span>Employer posted range: {formatMoney(guidance.employer_range_min)}–{formatMoney(guidance.employer_range_max)} · DFW market anchor: {formatMoney(guidance.market_suggested_min)}–{formatMoney(guidance.market_suggested_max)}</span>
        </div>
      )}

      <div className="salary-guidance-market" aria-label="DFW market percentiles">
        <div><span>25th percentile</span><strong>{formatMoney(guidance.annual_p25)}</strong></div>
        <div><span>Median</span><strong>{formatMoney(guidance.annual_median)}</strong></div>
        <div><span>75th percentile</span><strong>{formatMoney(guidance.annual_p75)}</strong></div>
      </div>

      <div className="salary-guidance-source">
        <span>Mapped to {guidance.occupation_title} ({guidance.occupation_code}) · {Number(guidance.employment || 0).toLocaleString('en-US')} DFW jobs · ask basis: {guidance.range_basis}</span>
        {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer noopener">View BLS source <ExternalLinkIcon /></a>}
      </div>
    </section>
  );
}

function Logbook({ claimId, notes, onNoteAdded }) {
  const [draft, setDraft] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);

  async function submit() {
    if (!draft.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const note = await addNote(claimId, draft.trim());
      setDraft('');
      onNoteAdded(note);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <SectionLabel>Logbook</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
        {notes.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Nothing logged yet.</p>
        )}
        {notes.map((n) => (
          <div key={n.id} style={{ borderLeft: '2px solid var(--line)', paddingLeft: 10 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)', marginBottom: 3 }}>
              {n.created_at}
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-body)', whiteSpace: 'pre-wrap' }}>
              {n.body}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Textarea
          rows={3}
          placeholder="Log what you dug up — contacts, comp signals, gut read…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        {error && <p style={{ fontSize: 12, color: 'var(--danger)', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="gold" size="sm" disabled={!draft.trim() || submitting} onClick={submit}>
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

function WorkingState({ claim, onPatched }) {
  const [nextAction, setNextAction] = React.useState(claim.next_action || '');
  const [nextActionDate, setNextActionDate] = React.useState(claim.next_action_date || '');
  const [applicationMinutes, setApplicationMinutes] = React.useState(claim.application_minutes ?? '');
  const [gutPrediction, setGutPrediction] = React.useState(claim.gut_prediction ?? '');
  const [vendorTrackerUrl, setVendorTrackerUrl] = React.useState(claim.vendor_tracker_url || '');
  const [saveState, setSaveState] = React.useState({ status: 'idle', message: '' });

  React.useEffect(() => {
    setNextAction(claim.next_action || '');
    setNextActionDate(claim.next_action_date || '');
    setApplicationMinutes(claim.application_minutes ?? '');
    setGutPrediction(claim.gut_prediction ?? '');
    setVendorTrackerUrl(claim.vendor_tracker_url || '');
  }, [claim.id]);

  async function save(e) {
    if (e) { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.boxShadow = 'none'; }
    setSaveState({ status: 'saving', message: 'Saving…' });
    try {
      const updated = await patchClaim(claim.id, {
        next_action: nextAction || null,
        next_action_date: nextActionDate || null,
        application_minutes: applicationMinutes === '' ? null : applicationMinutes,
        gut_prediction: gutPrediction === '' ? null : gutPrediction,
        vendor_tracker_url: vendorTrackerUrl || null,
      });
      onPatched(updated);
      setSaveState({ status: 'saved', message: 'Saved' });
    } catch (err) {
      setSaveState({ status: 'error', message: err?.message || 'Save failed' });
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Tooltip label={GLOSS_BY_STAGE[claim.stage] || claim.stage}>
          <Badge tone={badgeToneFor(claim.stage)}>{claim.stage}</Badge>
        </Tooltip>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <Input
            label="Next action"
            placeholder="Follow up with recruiter"
            value={nextAction}
            onChange={(e) => setNextAction(e.target.value)}
            onBlur={save}
          />
        </div>
        <div style={{ width: 150 }}>
          <Input
            label="When"
            type="date"
            mono
            value={nextActionDate || ''}
            onChange={(e) => setNextActionDate(e.target.value)}
            onBlur={save}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <Input
            label="Effort"
            type="number"
            min="0"
            mono
            placeholder="Minutes"
            value={applicationMinutes}
            onChange={(e) => setApplicationMinutes(e.target.value)}
            onBlur={save}
          />
          <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '4px 0 0' }}>minutes spent working this application</p>
        </div>
        <div style={{ flex: 1 }}>
          <Input
            label="Gut odds"
            type="number"
            min="0"
            max="1"
            step="0.05"
            mono
            placeholder="0 – 1"
            value={gutPrediction}
            onChange={(e) => setGutPrediction(e.target.value)}
            onBlur={save}
          />
          <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '4px 0 0' }}>your gut odds of a strike, 0–1</p>
        </div>
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <label htmlFor="in-vendor-tracker" style={labelStyle}>Vendor tracker</label>
          {claim.vendor_tracker_url && (
            <a href={claim.vendor_tracker_url} target="_blank" rel="noreferrer noopener" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-body)' }}>
              <ExternalLinkIcon />
            </a>
          )}
        </div>
        <Input
          id="in-vendor-tracker"
          placeholder="https://vendor.example.com/tracker/…"
          mono
          value={vendorTrackerUrl}
          onChange={(e) => setVendorTrackerUrl(e.target.value)}
          onBlur={save}
        />
      </div>
      <div role="status" aria-live="polite" style={{ minHeight: 22, display: 'flex', alignItems: 'center', gap: 8 }}>
        {saveState.status !== 'idle' && (
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10.5,
            color: saveState.status === 'error' ? 'var(--danger)' : saveState.status === 'saved' ? 'var(--positive)' : 'var(--text-faint)',
          }}>{saveState.message}</span>
        )}
        {saveState.status === 'error' && (
          <Button variant="quiet" size="sm" onClick={() => save()}>Retry</Button>
        )}
      </div>
    </div>
  );
}

function CareerFitPanel({ fit }) {
  if (!fit) return null;
  return (
    <section aria-labelledby="career-fit-heading" style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 14, background: 'var(--bg-sunken)' }}>
      <SectionLabel>Career evidence</SectionLabel>
      <h3 id="career-fit-heading" style={{ fontFamily: 'var(--font-slab)', fontSize: 17, color: 'var(--text-strong)', margin: '0 0 4px' }}>
        Why this role fits · {fit.score}/100
      </h3>
      <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '0 0 10px' }}>
        Against {fit.profile_label || 'the current Career profile'} · deterministic evidence, not an employability verdict
      </p>
      {fit.reasons?.length > 0 ? (
        <ul style={{ margin: '0 0 10px', paddingLeft: 18, color: 'var(--text-body)', fontSize: 12.5 }}>
          {fit.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      ) : <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No configured match signals were found.</p>}
      {fit.cautions?.length > 0 && (
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Missing or verify</div>
          <ul style={{ margin: '5px 0 0', paddingLeft: 18, color: 'var(--text-muted)', fontSize: 12.5 }}>
            {fit.cautions.map((caution) => <li key={caution}>{caution}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

function ResumeVersionPanel({ claim, versions, sends, onRecorded }) {
  const [selected, setSelected] = React.useState(claim.resume_version_id ? String(claim.resume_version_id) : '');
  const [state, setState] = React.useState({ status: 'idle', message: '' });

  React.useEffect(() => {
    setSelected(claim.resume_version_id ? String(claim.resume_version_id) : '');
  }, [claim.id, claim.resume_version_id]);

  async function record() {
    if (!selected || Number(selected) === Number(claim.resume_version_id)) return;
    setState({ status: 'saving', message: 'Recording…' });
    try {
      await patchClaim(claim.id, { resume_version_id: Number(selected) });
      setState({ status: 'saved', message: 'Résumé version recorded' });
      await onRecorded();
    } catch (err) {
      setState({ status: 'error', message: err?.message || 'Could not record résumé version' });
    }
  }

  const current = versions.find((version) => Number(version.id) === Number(claim.resume_version_id));
  return (
    <section aria-labelledby="resume-version-heading" style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 14 }}>
      <SectionLabel>Application evidence</SectionLabel>
      <h3 id="resume-version-heading" style={{ fontFamily: 'var(--font-slab)', fontSize: 17, color: 'var(--text-strong)', margin: '0 0 4px' }}>Résumé version used</h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px' }}>
        {current ? current.label : 'No résumé version recorded for this application.'}
      </p>
      {versions.length > 0 ? (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ ...labelStyle, flex: '1 1 210px' }}>
            Version
            <select value={selected} onChange={(event) => setSelected(event.target.value)} style={{ display: 'block', width: '100%', marginTop: 5, minHeight: 38, background: 'var(--bg-sunken)', color: 'var(--text-strong)', border: '1px solid var(--line)', borderRadius: 6, padding: '7px 9px' }}>
              <option value="">Choose a version</option>
              {versions.map((version) => <option key={version.id} value={version.id}>{version.label}</option>)}
            </select>
          </label>
          <Button variant="quiet" size="sm" disabled={!selected || Number(selected) === Number(claim.resume_version_id) || state.status === 'saving'} onClick={record}>Record version used</Button>
        </div>
      ) : <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>Create a résumé version while staking a claim to make it selectable here.</p>}
      <div role="status" aria-live="polite" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: state.status === 'error' ? 'var(--danger)' : 'var(--text-faint)', minHeight: 18, marginTop: 6 }}>{state.message}</div>
      {sends?.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12 }}>Version history · {sends.length}</summary>
          <ol style={{ margin: '8px 0 0', paddingLeft: 20, color: 'var(--text-muted)', fontSize: 12 }}>
            {sends.map((send) => <li key={send.id}>{send.resume_label || `Version #${send.resume_version_id}`} · {send.sent_at}</li>)}
          </ol>
        </details>
      )}
    </section>
  );
}

// Strata only deposit, never rearrange (§3.4): `items` is rendered in the exact server ASC
// order — never sorted/reversed here. The first batch present at mount gets an oldest-first
// stagger; any row appended later (new key, not in this set) keys off the CSS fallback `0ms`
// and gets a single settle instead of replaying the whole cascade. Shared by History
// (stage_transitions) and Touchpoints (claim_events) -- both server-ASC, insert-only logs.
function Strata({ items, renderItem }) {
  const initialIdsRef = React.useRef(null);
  if (initialIdsRef.current === null) {
    initialIdsRef.current = new Set(items.map((item) => item.id));
  }

  return (
    <div className="claim-strata" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item, i) => {
        const layerStyle = {};
        if (initialIdsRef.current.has(item.id)) {
          // Capped per §2's stagger rule (per-item step, total <= 600ms).
          layerStyle['--claim-strata-delay'] = `min(calc(${i} * var(--stagger)), 600ms)`;
        }
        return (
          <div key={item.id} className="claim-strata-layer" style={layerStyle}>
            {renderItem(item, i)}
          </div>
        );
      })}
    </div>
  );
}

function History({ transitions }) {
  return (
    <div>
      <SectionLabel>History</SectionLabel>
      <Strata items={transitions} renderItem={(t) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12.5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <span style={{ color: 'var(--text-body)' }}>
              {t.from_stage ? `${t.from_stage} → ${t.to_stage}` : `Staked as ${t.to_stage}`}
              {t.note && <span style={{ color: 'var(--text-muted)' }}> — {t.note}</span>}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
              {t.transitioned_at}
            </span>
          </div>
          {(t.transition_cause || t.outcome_reason) && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>
              {t.transition_cause && `cause: ${TRANSITION_CAUSE_GLOSS[t.transition_cause] || t.transition_cause}`}
              {t.transition_cause && t.outcome_reason && ' · '}
              {t.outcome_reason && `reason: ${OUTCOME_REASON_GLOSS[t.outcome_reason] || t.outcome_reason}`}
            </span>
          )}
        </div>
      )} />
    </div>
  );
}

// §3.4 typed touchpoints (claim_events) -- a distinct section from Logbook (claim_notes stays
// freeform-only); see server/validate.js ENUMS.claim_event_kind for the source vocabulary.
function Touchpoints({ claimId, events, onEventAdded }) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [resolveEvent, setResolveEvent] = React.useState(null);

  async function handleAdd(payload) {
    const event = await addClaimEvent(claimId, payload);
    onEventAdded(event);
    setDialogOpen(false);
  }

  async function handleResolve(payload) {
    const result = await resolveClaimEvent(claimId, resolveEvent.id, payload);
    onEventAdded(null, result.events);
    setResolveEvent(null);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <SectionLabel>Touchpoints</SectionLabel>
        <Button variant="ghost" size="sm" onClick={() => setDialogOpen(true)}>Log touchpoint</Button>
      </div>
      {events.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No touchpoints logged yet.</p>
      )}
      <Strata items={events} renderItem={(e) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12.5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <span style={{ color: 'var(--text-body)' }}>{CLAIM_EVENT_KIND_GLOSS[e.kind] || e.kind}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
              {e.occurred_at}
            </span>
          </div>
          {(e.due_at || claimEventDetailText(e)) && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>
              {e.due_at && `due ${e.due_at}`}
              {e.due_at && claimEventDetailText(e) && ' · '}
              {claimEventDetailText(e)}
            </span>
          )}
          {e.resolution && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--positive)' }}>
              resolved {DEADLINE_RESOLUTION_GLOSS[e.resolution.reason] || e.resolution.reason}
              {e.resolution.occurred_at && ` · ${e.resolution.occurred_at}`}
              {e.resolution.note && ` · ${e.resolution.note}`}
            </span>
          )}
          {e.due_at && !e.resolution && e.kind !== 'deadline_resolved' && (
            <div style={{ marginTop: 6 }}>
              <Button variant="ghost" size="sm" onClick={() => setResolveEvent(e)}>Resolve gate</Button>
            </div>
          )}
        </div>
      )} />
      <AddClaimEventDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onAdd={handleAdd} />
      <ResolveClaimEventDialog
        open={Boolean(resolveEvent)}
        event={resolveEvent}
        onClose={() => setResolveEvent(null)}
        onResolve={handleResolve}
      />
    </div>
  );
}

function Contacts({ contacts }) {
  if (contacts.length === 0) return null;
  return (
    <div>
      <SectionLabel>Contacts</SectionLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {contacts.map((c) => (
          <Tag key={c.id}>
            {c.profile_url ? (
              <a href={c.profile_url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                {[c.name, c.role].filter(Boolean).join(' · ') || c.email || 'Profile'}
              </a>
            ) : (
              [c.name, c.role].filter(Boolean).join(' · ') || c.email
            )}
            {c.is_job_poster ? <span style={{ color: 'var(--text-faint)' }}> · poster</span> : null}
          </Tag>
        ))}
      </div>
    </div>
  );
}

// Read-only view of the latest listing_advisories row (server/advise.js, PROSPECT_ADVISOR-gated,
// §6.7.1). The gate was flipped ON in production on 2026-07-28 and every live listing now carries
// an advisory, so this panel renders on real rows -- it is no longer the dormant surface the
// original comment described. Sits in the §6.8 "Copy tailoring
// prompt" neighbourhood (footer, just below) per the §6.7 scoping lock's surface decision --
// same modal, not a new page. Every field is free text from an unvalidated model response
// (advise.js never checks the shape it writes beyond its own tolerant normalizer), so each one
// is type-guarded here rather than trusted, same posture as AiParsePanel above. Never renders
// model output as HTML (no dangerouslySetInnerHTML anywhere in this component).
// Exported for its own regression test, same precedent as CapturedSnapshot above.
export function PostingJudgmentPanel({ advisory }) {
  let parsed = null;
  try { parsed = JSON.parse(advisory.advisory); } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const compAssessment = typeof parsed.comp_assessment === 'string' ? parsed.comp_assessment : null;
  const seniorityAssessment = typeof parsed.seniority_assessment === 'string' ? parsed.seniority_assessment : null;
  const repostAssessment = typeof parsed.repost_assessment === 'string' ? parsed.repost_assessment : null;
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions.filter((q) => typeof q === 'string' && q.trim())
    : [];
  const hasContent = compAssessment || seniorityAssessment || repostAssessment || questions.length > 0;
  if (!hasContent) return null;

  const fields = [
    ['Comp language', compAssessment],
    ['Seniority vs. duties', seniorityAssessment],
    ['Repost / agency tells', repostAssessment],
  ].filter(([, text]) => text);

  return (
    <div>
      <SectionLabel>Posting judgment</SectionLabel>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {fields.map(([label, text]) => (
          <div key={label}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
              {label}
            </div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-soft)', whiteSpace: 'pre-wrap' }}>{text}</p>
          </div>
        ))}
        {questions.length > 0 && (
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
              Questions worth asking
            </div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {questions.map((q, i) => (
                <li key={i} style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-soft)' }}>{q}</li>
              ))}
            </ul>
          </div>
        )}
        <Tag style={{ alignSelf: 'flex-start' }}>
          AI-generated{typeof advisory.model === 'string' ? ` · ${advisory.model}` : ''}{typeof advisory.generated_at === 'string' ? ` · ${advisory.generated_at}` : ''}
        </Tag>
      </div>
    </div>
  );
}

// navigator.clipboard requires a secure context; a tailnet-direct http:// origin
// doesn't qualify, so this falls back to the classic hidden-textarea copy trick.
export async function copyTextToClipboard(text) {
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('clipboard API unavailable');
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      if (!document.execCommand('copy')) throw new Error('execCommand copy failed');
    } finally {
      document.body.removeChild(textarea);
    }
  }
}

const INTERVIEW_KIND_OPTIONS = [
  ['recruiter_screen', 'Recruiter screen'], ['phone_screen', 'Phone screen'],
  ['technical', 'Technical interview'], ['panel', 'Panel interview'], ['onsite', 'On-site interview'],
  ['assessment', 'Assessment'], ['final', 'Final interview'], ['other', 'Other'],
];

function GuideList({ items = [] }) {
  if (!items.length) return <p className="interview-prep-muted">Nothing was extracted for this section.</p>;
  return <ul>{items.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul>;
}

function AgentFindingList({ items = [] }) {
  if (!items.length) return <p className="interview-prep-muted">No source-grounded findings were returned for this section.</p>;
  return <div className="interview-prep-cards">{items.map((item, index) => (
    <article key={`${index}:${item.finding || item.question}`}>
      <strong>{item.finding || item.question}</strong>
      <p>{item.why_it_matters || item.rationale}</p>
      {item.confidence && <span>Confidence: {item.confidence}</span>}
      <span>Sources: {item.source_ids.join(', ')}</span>
    </article>
  ))}</div>;
}

export function InterviewPreparationPanel({ claim, versions = [], initialPreparations = [] }) {
  const usableVersions = versions.filter((version) => String(version.body || '').trim());
  const preferredResumeId = usableVersions.some((version) => Number(version.id) === Number(claim.resume_version_id))
    ? String(claim.resume_version_id)
    : String(usableVersions.find((version) => version.kind === 'baseline' && version.audit_status)?.id || usableVersions[0]?.id || '');
  const [preparations, setPreparations] = React.useState(initialPreparations);
  const [activeId, setActiveId] = React.useState(initialPreparations[0]?.id || null);
  const [form, setForm] = React.useState({
    interview_kind: 'recruiter_screen', interview_format: '', scheduled_at: '',
    duration_minutes: '30', interviewer_name: '', resume_version_id: preferredResumeId,
    resume_confirmed_sent: false,
  });
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const active = preparations.find((item) => Number(item.id) === Number(activeId)) || preparations[0] || null;
  const guide = active?.deterministic || null;
  const agentResearch = active?.provider_result || null;
  const researchJob = active?.research_job || null;
  const chosenResume = usableVersions.find((version) => String(version.id) === String(form.resume_version_id));

  React.useEffect(() => {
    if (!active?.id || !['queued', 'researching'].includes(researchJob?.status)) return undefined;
    let cancelled = false;
    const refresh = async () => {
      try {
        const updated = await getInterviewPreparation(active.id);
        if (!cancelled) setPreparations((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
      } catch { /* The visible job state remains truthful; the next poll may recover. */ }
    };
    const timer = window.setInterval(refresh, 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [active?.id, researchJob?.status]);

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function generate(regenerate = false) {
    setBusy(true); setMessage('');
    try {
      const result = await prepareInterview(claim.id, {
        ...form,
        resume_version_id: Number(form.resume_version_id),
        duration_minutes: form.duration_minutes === '' ? null : Number(form.duration_minutes),
        scheduled_at: form.scheduled_at || null,
        regenerate,
      });
      const preparation = result.preparation;
      setPreparations((current) => [preparation, ...current.filter((item) => item.id !== preparation.id)]);
      setActiveId(preparation.id);
      setMessage(result.created
        ? 'Interview guide ready. Agent company and role research is queued; no employer contact, scheduling, or claim-stage change occurred.'
        : 'The matching preparation was already ready; Prospect reopened it and its research without creating a duplicate.');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function retryResearch() {
    if (!active?.id) return;
    setBusy(true); setMessage('');
    try {
      const result = await retryInterviewResearch(active.id);
      setPreparations((current) => [result.preparation, ...current.filter((item) => item.id !== result.preparation.id)]);
      setMessage('Agent research queued with a fresh request. The deterministic guide remains available.');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  return (
    <section className="interview-prep" aria-labelledby="interview-prep-title">
      <SectionLabel>Interview preparation</SectionLabel>
      <div className="interview-prep-head">
        <div><h3 id="interview-prep-title">Prepare from this exact claim</h3>
          <p>Prospect grounds the guide in the captured listing, verified Career evidence, and the résumé source you choose.</p></div>
        {active && <span>Prep #{active.id} · {active.status}</span>}
      </div>
      <div className="interview-prep-form">
        <label style={labelStyle}>Interview type
          <select value={form.interview_kind} onChange={(event) => setField('interview_kind', event.target.value)}>
            {INTERVIEW_KIND_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label style={labelStyle}>Résumé source
          <select value={form.resume_version_id} onChange={(event) => setField('resume_version_id', event.target.value)}>
            <option value="">Choose a résumé with source text</option>
            {usableVersions.map((version) => <option key={version.id} value={version.id}>{version.label} · {version.audit_status || 'not audited'}</option>)}
          </select>
        </label>
        <label style={labelStyle}>Format
          <Input value={form.interview_format} placeholder="Phone, video, on-site…" onChange={(event) => setField('interview_format', event.target.value)} />
        </label>
        <label style={labelStyle}>Scheduled time
          <Input type="datetime-local" value={form.scheduled_at} onChange={(event) => setField('scheduled_at', event.target.value)} />
        </label>
        <label style={labelStyle}>Duration (minutes)
          <Input type="number" min="1" max="480" value={form.duration_minutes} onChange={(event) => setField('duration_minutes', event.target.value)} />
        </label>
        <label style={labelStyle}>Interviewer
          <Input value={form.interviewer_name} placeholder="Name or role, if known" onChange={(event) => setField('interviewer_name', event.target.value)} />
        </label>
      </div>
      <label className="interview-prep-confirm">
        <input type="checkbox" checked={form.resume_confirmed_sent} onChange={(event) => setField('resume_confirmed_sent', event.target.checked)} />
        <span>I confirm this is the résumé I sent for this job.</span>
      </label>
      {!form.resume_confirmed_sent && chosenResume && (
        <p className="interview-prep-warning"><strong>Audited baseline — not confirmed sent.</strong> Prospect will use it for preparation without claiming the employer received it.</p>
      )}
      <div className="interview-prep-actions">
        <Button size="sm" onClick={() => generate(false)} disabled={busy || !form.resume_version_id}>{busy ? 'Preparing…' : 'Prepare for Interview'}</Button>
        {active && <Button variant="ghost" size="sm" onClick={() => generate(true)} disabled={busy || !form.resume_version_id}>Regenerate as new prep</Button>}
      </div>
      {message && <p className="interview-prep-message" role="status">{message}</p>}

      {guide && (
        <div className="interview-prep-guide">
          <div className="interview-prep-guide-head">
            <div><span>{guide.interview.kind_gloss}</span><h4>{guide.role.company} · {guide.role.title}</h4></div>
            {active.artifacts?.[0] && <a href={interviewPrepArtifactDownloadUrl(active.artifacts[0].id)}>Download self-contained guide</a>}
          </div>
          <section><h5>Your 60-second spine</h5><GuideList items={guide.candidate_intro} /></section>
          <section><h5>What this role is screening for</h5>
            <div className="interview-prep-cards">{guide.role_priorities.map((item) => <article key={item.key}><strong>{item.label}</strong><p>{item.coaching}</p></article>)}</div>
          </section>
          <section><h5>Your verified evidence bridges</h5>
            <div className="interview-prep-cards">{guide.evidence_bridges.map((item) => <article key={item.claim_id}><span>{item.evidence_scope}</span><strong>{item.safe_language}</strong><p>Do not imply: {item.prohibited_inference.join('; ') || 'anything beyond this wording'}</p></article>)}</div>
          </section>
          {guide.boundaries.length > 0 && <section className="interview-prep-boundaries"><h5>Be precise about the training ramp</h5>
            <div className="interview-prep-cards">{guide.boundaries.map((item) => <article key={item.key}><strong>{item.label}</strong><p>{item.guidance}</p></article>)}</div>
          </section>}
          <section><h5>Questions you are likely to hear</h5>
            {guide.likely_questions.map((item, index) => <details key={item.question}><summary>{index + 1}. {item.question}</summary><GuideList items={item.answer_points} /></details>)}
          </section>
          <section className="interview-prep-agent-research"><h5>Agent company and role research</h5>
            {['queued', 'researching'].includes(researchJob?.status) && <p role="status">{researchJob.status === 'queued' ? 'Research queued.' : 'An agent is researching current public sources…'} The deterministic guide is ready while this runs.</p>}
            {researchJob?.status === 'failed' && <div><p>Agent research failed: {researchJob.error || active.provider_error || 'No verified research was returned.'}</p><Button variant="ghost" size="sm" onClick={retryResearch} disabled={busy}>Retry agent research</Button></div>}
            {agentResearch && <div>
              <p>{agentResearch.summary}</p>
              <h6>Company context</h6><AgentFindingList items={agentResearch.company_findings} />
              <h6>Role context</h6><AgentFindingList items={agentResearch.role_findings} />
              <h6>Interview signals</h6><AgentFindingList items={agentResearch.interview_findings} />
              <h6>Research-backed questions</h6><AgentFindingList items={agentResearch.questions_to_ask} />
              {agentResearch.caveats?.length > 0 && <div><h6>Caveats</h6><GuideList items={agentResearch.caveats} /></div>}
              <details><summary>Research sources</summary><ol>{agentResearch.sources.map((source) => <li key={source.id}>
                <a href={source.url} target="_blank" rel="noreferrer">{source.id}: {source.title}</a>
                <span> · {source.publisher} · {source.source_type.replaceAll('_', ' ')}</span>
              </li>)}</ol></details>
            </div>}
            {!researchJob && !agentResearch && <p className="interview-prep-muted">Research begins only after you prepare this claim.</p>}
          </section>
          {guide.salary && <section><h5>Compensation answer</h5><blockquote>{guide.salary.answer}</blockquote></section>}
          <section><h5>Confirm from your own facts</h5><GuideList items={guide.self_attest.map((item) => `${item.label}: ${item.prompt}`)} /></section>
          <section><h5>Questions to ask</h5><GuideList items={guide.questions_to_ask} /></section>
          <section><h5>Before the interview</h5><GuideList items={guide.readiness_checklist} /></section>
          <details className="interview-prep-history"><summary>Preparation history and provenance</summary>
            <p>Listing snapshot {guide.source.listing_snapshot_generation} · <code>{guide.source.listing_snapshot_sha256}</code></p>
            <p>Career evidence · <code>{guide.source.career_claims_sha256}</code></p>
            <label style={labelStyle}>Immutable preparations
              <select value={active.id} onChange={(event) => setActiveId(Number(event.target.value))}>{preparations.map((item) => <option key={item.id} value={item.id}>Prep {item.id} · {item.created_at} · {item.status}</option>)}</select>
            </label>
          </details>
        </div>
      )}
    </section>
  );
}

const ACTIVE_GENERATION_STATES = new Set(['queued', 'auditing', 'drafting', 'rendering']);

const GENERATION_PROGRESS = {
  queued: { value: 10, label: 'Queued', detail: 'The package worker will pick this up shortly.' },
  auditing: { value: 30, label: 'Checking your evidence', detail: 'Prospect is locking the current listing, Career claims, and audited baseline.' },
  drafting: { value: 60, label: 'Writing your documents', detail: 'The agent is tailoring the résumé and cover letter from verified evidence.' },
  rendering: { value: 85, label: 'Creating and verifying files', detail: 'Prospect is rendering PDF and DOCX files, then checking their hashes.' },
  ready: { value: 100, label: 'Documents ready', detail: 'Your verified résumé and cover letter are ready to download.' },
};

export function LiveProgress({ label, detail, value }) {
  const boundedValue = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="live-progress" role="status" aria-live="polite">
      <div className="live-progress-copy">
        <strong>{label}</strong>
        <span className="live-progress-percent">{boundedValue}%</span>
      </div>
      <div
        className="live-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={boundedValue}
      >
        <span style={{ transform: `scaleX(${boundedValue / 100})` }} />
      </div>
      {detail && <p>{detail}</p>}
    </div>
  );
}

export function ApplicationPackagePanel({
  claim, versions, initialPackages = [], readinessRevision = '', baselineId = '', onBaselineChange,
}) {
  const baselines = versions.filter((version) => version.kind === 'baseline' && version.body && version.audit_status);
  const [packages, setPackages] = React.useState(initialPackages);
  const [readiness, setReadiness] = React.useState(null);
  const [activeId, setActiveId] = React.useState(initialPackages[0]?.id || null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [copyStatus, setCopyStatus] = React.useState('idle');
  const [artifact, setArtifact] = React.useState({ kind: 'resume', format: 'pdf', path: '' });
  const [generationJob, setGenerationJob] = React.useState(null);

  const refresh = React.useCallback(async (selected = baselineId) => {
    const result = await getApplicationPackages(claim.id, selected || null);
    setPackages(result.packages || []);
    setReadiness(result.readiness);
    setGenerationJob(result.generation_job || null);
    setActiveId((current) => current || result.packages?.[0]?.id || null);
  }, [claim.id, baselineId, readinessRevision]);

  React.useEffect(() => {
    refresh().catch((error) => setMessage(error.message));
  }, [refresh]);

  React.useEffect(() => {
    if (!generationJob || !ACTIVE_GENERATION_STATES.has(generationJob.status)) return undefined;
    const timer = setInterval(() => refresh().catch((error) => setMessage(error.message)), 2500);
    return () => clearInterval(timer);
  }, [generationJob?.status, refresh]);

  const active = packages.find((item) => Number(item.id) === Number(activeId)) || packages[0] || null;
  const checks = [
    ['Job listing captured', readiness?.checks?.listing_snapshot],
    ['Career evidence loaded', readiness?.checks?.career_claims],
    ['Baseline résumé ready', readiness?.checks?.baseline_resume],
    ['Job audit complete', readiness?.checks?.completed_audit],
  ];

  async function prepare() {
    setBusy(true); setMessage('');
    try {
      const created = await prepareApplicationPackage(claim.id, baselineId);
      await refresh(baselineId);
      setActiveId(created.id);
      setMessage(`Package ${created.id} prepared. No application was submitted.`);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function copyBrief() {
    if (!active) return;
    setCopyStatus('copying');
    try { await copyTextToClipboard(active.brief_markdown); setCopyStatus('copied'); }
    catch { setCopyStatus('error'); }
    setTimeout(() => setCopyStatus('idle'), 2000);
  }

  async function registerArtifact(event) {
    event.preventDefault();
    if (!active || !artifact.path.trim()) return;
    setBusy(true); setMessage('');
    try {
      await registerApplicationPackageArtifact(active.id, artifact);
      setArtifact((value) => ({ ...value, path: '' }));
      await refresh(baselineId);
      setMessage('Artifact registered from its verified local file.');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function appendEvent(kind) {
    if (!active) return;
    setBusy(true); setMessage('');
    try {
      await appendApplicationPackageEvent(active.id, kind);
      await refresh(baselineId);
      setMessage(`${kind === 'reviewed' ? 'Review' : 'Finalization'} recorded without external action.`);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function regenerate() {
    setBusy(true); setMessage('');
    try {
      const queued = await regenerateApplicationPackage(claim.id, baselineId);
      setGenerationJob(queued);
      setMessage(`Generation job ${queued.id} queued. Prior packages and files remain immutable.`);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  const stateLabels = {
    queued: 'Queued', auditing: 'Checking your evidence', drafting: 'Writing your documents',
    rendering: 'Creating and verifying files', needs_review: 'Needs review', failed: 'Generation failed', ready: 'Documents ready',
  };
  const generatedPackage = packages.find((item) => Number(item.id) === Number(generationJob?.package_id)) || active;
  const artifactBy = (kind, format) => generatedPackage?.artifacts?.find((item) => item.kind === kind && item.format === format);
  const resumePdf = artifactBy('resume', 'pdf'); const coverPdf = artifactBy('cover_letter', 'pdf');
  const resumeDocx = artifactBy('resume', 'docx'); const coverDocx = artifactBy('cover_letter', 'docx');
  const generationActive = ACTIVE_GENERATION_STATES.has(generationJob?.status);
  const hasGeneratedDocuments = Boolean(resumePdf || coverPdf || resumeDocx || coverDocx);
  const generationProgress = GENERATION_PROGRESS[generationJob?.status];
  const missingReadiness = checks.find(([, check]) => !check?.ready)?.[0] || null;
  let nextStep = 'Checking what Prospect needs…';
  if (generationActive) nextStep = 'Prospect is working now. You can leave this window open; progress updates automatically.';
  else if (generationJob?.status === 'ready') nextStep = 'Your verified files are ready. Download and review both before applying.';
  else if (generationJob?.status === 'needs_review') nextStep = 'Generation paused. Fix the issue shown above, then generate the documents again.';
  else if (generationJob?.status === 'failed') nextStep = 'Generation stopped. Review the error above, then try generating the documents again.';
  else if (missingReadiness === 'Job audit complete') nextStep = 'Prospect starts the first job audit automatically. Watch the progress above; generation unlocks as soon as the evidence review completes.';
  else if (missingReadiness === 'Baseline résumé ready') nextStep = 'Next: choose an audited baseline résumé below.';
  else if (missingReadiness) nextStep = `Prospect still needs: ${missingReadiness}.`;
  else nextStep = 'Everything is ready. Generate a tailored résumé and cover letter for this job.';

  return (
    <section className="application-package" aria-labelledby="application-package-title">
      <SectionLabel>Application package</SectionLabel>
      <h3 id="application-package-title">Tailored résumé and cover letter</h3>
      <p>Prospect creates these from your verified Career evidence and audited baseline. It never submits an application or changes a profile.</p>
      {generationProgress && <LiveProgress {...generationProgress} />}
      {generationJob && !generationProgress && (
        <div className={`application-generation-state application-generation-state--${generationJob.status}`} role="status">
          <strong>{stateLabels[generationJob.status] || generationJob.status}</strong>
          <span>Job {generationJob.id} · attempt {generationJob.attempts}/{generationJob.max_attempts}</span>
          {generationJob.error && <p>{generationJob.error}</p>}
        </div>
      )}
      <div className="application-package-readiness">
        {checks.map(([label, check]) => <div className={check?.ready ? 'is-ready' : 'is-pending'} key={label}><span aria-hidden="true">{check?.ready ? '✓' : '○'}</span><span>{label}</span></div>)}
      </div>
      <div className="application-package-next-step" role="status"><strong>What happens next</strong><p>{nextStep}</p></div>
      <label style={labelStyle}>Audited baseline résumé
        <select value={baselineId} onChange={(event) => { onBaselineChange?.(event.target.value); setActiveId(null); }}>
          <option value="">Choose an audited baseline</option>
          {baselines.map((version) => <option key={version.id} value={version.id}>{version.label} · {version.audit_status}</option>)}
        </select>
      </label>
      <div className="application-package-actions">
        <Button size="sm" onClick={regenerate} disabled={busy || generationActive || !readiness?.ready}>
          {busy ? 'Starting…' : generationActive ? 'Generating documents…' : hasGeneratedDocuments ? 'Regenerate documents' : 'Generate tailored résumé & cover letter'}
        </Button>
      </div>
      {message && <p role="status" className="application-package-message">{message}</p>}
      {generationJob?.status === 'ready' && resumePdf && coverPdf && (
        <div className="application-package-downloads">
          <a className="application-package-download-primary" href={applicationArtifactDownloadUrl(resumePdf.id)}>Download Tailored Resume</a>
          <a className="application-package-download-primary" href={applicationArtifactDownloadUrl(coverPdf.id)}>Download Cover Letter</a>
          {resumeDocx && <a href={applicationArtifactDownloadUrl(resumeDocx.id)}>Resume DOCX</a>}
          {coverDocx && <a href={applicationArtifactDownloadUrl(coverDocx.id)}>Cover Letter DOCX</a>}
        </div>
      )}
      {(readiness?.ready || packages.length > 0) && (
        <details className="application-package-advanced">
          <summary>Package history and advanced tools</summary>
          <div className="application-package-actions">
            <Button variant="ghost" size="sm" onClick={prepare} disabled={busy || !readiness?.ready}>Create brief only</Button>
            <Button variant="ghost" size="sm" onClick={copyBrief} disabled={!active || copyStatus === 'copying'}>
              {{ copying: 'Copying…', copied: 'Copied!', error: 'Copy failed' }[copyStatus] || 'Copy application brief'}
            </Button>
          </div>
          {packages.length > 0 && <div className="application-package-history">
          <label style={labelStyle}>Immutable package history
            <select value={active?.id || ''} onChange={(event) => setActiveId(Number(event.target.value))}>
              {packages.map((item) => <option key={item.id} value={item.id}>Package {item.id} · {item.created_at} · {item.latest_event?.kind || 'prepared'}</option>)}
            </select>
          </label>
          {active && <p>Latest event: <strong>{active.latest_event?.kind || 'prepared'}</strong> · {active.latest_event?.occurred_at}</p>}
          <form className="application-package-artifact" onSubmit={registerArtifact}>
            <select aria-label="Artifact kind" value={artifact.kind} onChange={(event) => setArtifact((value) => ({ ...value, kind: event.target.value }))}>
              <option value="resume">Résumé</option><option value="cover_letter">Cover letter</option>
            </select>
            <Input aria-label="Artifact path" placeholder="/home/david/Vaults/career-vault/files/…" value={artifact.path} onChange={(event) => setArtifact((value) => ({ ...value, path: event.target.value }))} />
            <Input aria-label="Artifact format" value={artifact.format} onChange={(event) => setArtifact((value) => ({ ...value, format: event.target.value }))} />
            <Button variant="quiet" size="sm" type="submit" disabled={busy || !artifact.path.trim()}>Register artifact</Button>
          </form>
          <div className="application-package-actions">
            <Button variant="ghost" size="sm" onClick={() => appendEvent('reviewed')} disabled={busy}>Mark reviewed</Button>
            <Button variant="ghost" size="sm" onClick={() => appendEvent('finalized')} disabled={busy}>Mark finalized</Button>
          </div>
          </div>}
        </details>
      )}
    </section>
  );
}

const AUDIT_LABELS = {
  apply_now: 'Strong match to apply', reasonable_stretch: 'A realistic stretch',
  premature: 'Build a few essentials first', excluded: 'Outside your target path',
  supported: 'You have evidence', hard_gap: 'Missing must-have',
  competitive_gap: 'Worth strengthening', partial_evidence: 'Related experience',
  unknown: 'Needs a closer look',
};

const AUDIT_GROUPS = [
  { key: 'hard_gap', title: 'Missing must-haves', intro: 'These are the clearest blockers in the listing.' },
  { key: 'competitive_gap', title: 'Worth strengthening', intro: 'These may not block you, but stronger proof would help.' },
  { key: 'partial_evidence', title: 'Related experience', intro: 'You have adjacent evidence, not a direct match yet.' },
  { key: 'supported', title: 'Evidence you already have', intro: 'Your Career record supports these requirements.' },
  { key: 'unknown', title: 'Needs a closer look', intro: 'Prospect cannot rate these confidently from the available text.' },
];

function auditOverview(result) {
  const hard = result.requirements.filter((item) => item.classification === 'hard_gap').length;
  if (result.overall.decision === 'apply_now') return 'Your current Career evidence covers the must-have requirements Prospect found.';
  if (result.overall.decision === 'reasonable_stretch') return `${hard || 'A few'} must-have ${hard === 1 ? 'area still needs' : 'areas still need'} stronger evidence, but this could be a realistic stretch.`;
  if (result.overall.decision === 'excluded') return 'This role falls outside the career path you asked Prospect to prioritize.';
  return `${hard || 'Several'} must-have ${hard === 1 ? 'area needs' : 'areas need'} stronger evidence. Focus on those before treating similar roles as strong targets.`;
}

function requirementHelp(item) {
  if (item.classification === 'supported') return 'Your Career record contains direct evidence for this.';
  if (item.classification === 'hard_gap') return 'The listing treats this as required, and your Career record does not show enough evidence yet.';
  if (item.classification === 'competitive_gap') return 'Not necessarily a blocker, but stronger proof would make you more competitive.';
  if (item.classification === 'partial_evidence') return 'You have related experience, but not direct evidence for this exact requirement.';
  return 'The listing or your evidence is too unclear to rate confidently.';
}

function readableAuditText(value) {
  return String(value || '')
    .replace(/\s*\([a-f0-9]{10,64}\)/gi, '')
    .replace(/^The candidate\b/i, 'You')
    .replace(/\bthe candidate\b/gi, 'you')
    .replace(/\bthe current resume\b/gi, 'your current résumé')
    .replace(/\bcurrent resume\b/gi, 'current résumé')
    .replace(/\s+•\s+/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function numberedAuditSteps(value) {
  const clean = readableAuditText(value);
  const matches = [...clean.matchAll(/(?:^|\s)(\d+)\.\s+(.+?)(?=(?:\s+\d+\.\s)|$)/g)];
  return matches.length > 1 ? matches.map((match) => match[2].trim()) : [];
}

function readableTechnology(value) {
  const clean = String(value || '').replace(/[-_]+/g, ' ').trim();
  return clean ? clean[0].toUpperCase() + clean.slice(1) : clean;
}

function waypointScopeText(item) {
  const scope = {
    published_pack: 'Study material is ready in Waypoint',
    domain_scaffold: 'Waypoint has an outline; full study material is not ready yet',
    missing: 'Not yet available in Waypoint',
    unmapped: 'Not mapped to a certification plan',
  }[item.waypoint_scope_status];
  return [item.certification_label, scope].filter(Boolean).join(' · ');
}

function marketSignalText(item, total) {
  const required = item.required_count
    ? `${item.required_count} ${item.required_count === 1 ? 'listing treats' : 'listings treat'} it as required`
    : 'none mark it as required';
  const preferred = item.preferred_count
    ? `; ${item.preferred_count} ${item.preferred_count === 1 ? 'lists' : 'list'} it as preferred`
    : '';
  return `${item.occurrence_count} of ${total} similar listings mention this; ${required}${preferred}.`;
}

function JobListingAuditPanel({ claimId, initialAudits = [], baselineResumeVersionId = '', onChanged }) {
  const [audits, setAudits] = React.useState(initialAudits);
  const [active, setActive] = React.useState(initialAudits[0] || null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const autoStartedClaimRef = React.useRef(null);

  React.useEffect(() => {
    setAudits(initialAudits);
    setActive(initialAudits[0] || null);
  }, [initialAudits]);

  React.useEffect(() => {
    if (!active || active.enrichment?.status !== 'queued') return undefined;
    const timer = setInterval(async () => {
      try {
        const next = await getJobAudit(active.id);
        setActive(next);
        setAudits((rows) => [next, ...rows.filter((row) => row.id !== next.id)]);
        if (next.enrichment?.status !== 'queued') onChanged?.();
      } catch (err) { setError(err.message); }
    }, 1500);
    return () => clearInterval(timer);
  }, [active?.id, active?.enrichment?.status, onChanged]);

  async function run(force = false) {
    setBusy(true); setError(null);
    try {
      const audit = await createJobAudit(claimId, force, baselineResumeVersionId);
      setActive(audit);
      setAudits((rows) => [audit, ...rows.filter((row) => row.id !== audit.id)]);
      // The deterministic audit is already durable when POST returns. Refresh the
      // package-readiness panel immediately; optional prose enrichment may continue.
      onChanged?.();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  React.useEffect(() => {
    if (!baselineResumeVersionId) return;
    const hasCurrentBaselineAudit = initialAudits.some(
      (audit) => Number(audit.resume_version_id) === Number(baselineResumeVersionId) && audit.status === 'complete',
    );
    const autoStartKey = `${claimId}:${baselineResumeVersionId}`;
    if (hasCurrentBaselineAudit || autoStartedClaimRef.current === autoStartKey) return;
    autoStartedClaimRef.current = autoStartKey;
    run(false);
  }, [claimId, baselineResumeVersionId, initialAudits]);

  async function sendToWaypoint() {
    setBusy(true); setError(null);
    try {
      const handoff = await getWaypointHandoff(active.id);
      window.open(handoff.url, '_blank', 'noopener,noreferrer');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const result = active?.deterministic;
  const actionSteps = active?.synthesis ? numberedAuditSteps(active.synthesis.stronger_candidate_path) : [];
  const repeatedSignals = result?.market_intelligence?.status === 'sufficient'
    ? result.market_intelligence.skills.filter((item) => item.repeated_signal)
    : [];
  const auditProgress = busy
    ? { value: 20, label: 'Reviewing this job', detail: 'Prospect is comparing the captured requirements with your verified Career evidence.' }
    : active?.enrichment?.status === 'queued'
      ? { value: 75, label: 'Writing the explanation', detail: 'The evidence review is complete. Prospect is adding an optional plain-language explanation.' }
      : null;
  return (
    <section className="job-audit" aria-labelledby="job-audit-title">
      <div className="job-audit-head">
        <div>
          <SectionLabel>Job listing audit</SectionLabel>
          <h3 id="job-audit-title">How well does this role fit you?</h3>
          <p>Prospect compares the job with your verified Career record. Coursework and projects stay separate from professional experience.</p>
        </div>
        <Button size="sm" onClick={() => run(Boolean(active))} disabled={busy || active?.enrichment?.status === 'queued'}>
          {busy && !active ? 'Starting audit…' : active ? 'Refresh audit' : 'Audit starts automatically'}
        </Button>
      </div>
      {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
      {auditProgress && <LiveProgress {...auditProgress} />}
      {result && (
        <div className="audit-report">
          <div className={`audit-verdict audit-verdict--${result.overall.decision}`}>
            <span className="audit-verdict-kicker">Prospect's read</span>
            <strong>{AUDIT_LABELS[result.overall.decision] || humanize(result.overall.decision)}</strong>
            <p>{auditOverview(result)}</p>
          </div>

          <div className="audit-section">
            <div className="audit-section-heading">
              <h4>What this job expects</h4>
              <p>Grouped by what matters most, instead of an internal scoring matrix.</p>
            </div>
            <div className="audit-requirement-groups">
              {AUDIT_GROUPS.map((group) => {
                const items = result.requirements.filter((item) => item.classification === group.key);
                if (!items.length) return null;
                return (
                  <section className={`audit-requirement-group audit-requirement-group--${group.key}`} key={group.key}>
                    <div className="audit-group-title"><h5>{group.title}</h5><span>{items.length}</span></div>
                    <p className="audit-group-intro">{group.intro}</p>
                    <ul>
                      {items.map((item) => (
                        <li key={item.requirement_id}>
                          <strong>{readableTechnology(item.wording)}</strong>
                          <span>{requirementHelp(item)}</span>
                          {item.resume_visibility === 'visibility_gap' ? <em>This evidence is not visible in the selected résumé.</em> : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          </div>

          {active.synthesis && (
            <section className="audit-section audit-next-steps">
              <div className="audit-section-heading">
                <h4>Your strongest next steps</h4>
                <p>Practical ways to become more credible for jobs like this.</p>
              </div>
              {actionSteps.length > 0
                ? <ol>{actionSteps.map((step, index) => <li key={index}>{step}</li>)}</ol>
                : <p>{readableAuditText(active.synthesis.stronger_candidate_path)}</p>}
            </section>
          )}
          {active.enrichment?.status === 'failed' && (
            <div className="audit-callout"><p>The deterministic evidence review is complete, but Prospect could not write the optional explanation{active.enrichment.error ? `: ${active.enrichment.error}` : '.'}</p><Button variant="ghost" size="sm" onClick={() => run(true)}>Try the explanation again</Button></div>
          )}

          <section className="audit-section">
            <div className="audit-section-heading audit-section-heading--action">
              <div><h4>Skills worth building</h4><p>Projects and study areas that would strengthen your evidence.</p></div>
              <Button variant="ghost" size="sm" onClick={sendToWaypoint} disabled={busy || !result.recommendations.length}>Plan these in Waypoint</Button>
            </div>
            {result.recommendations.length
              ? <div className="audit-learning-grid">{result.recommendations.map((item) => (
                <article key={item.technology}>
                  <h5>{readableTechnology(item.technology)}</h5>
                  <p>{item.evidence_building_method}</p>
                  {waypointScopeText(item) ? <span>{waypointScopeText(item)}</span> : null}
                </article>
              ))}</div>
              : <p>No learning recommendation was generated from the captured requirements.</p>}
          </section>

          <section className="audit-section audit-market">
            <div className="audit-section-heading"><h4>What similar jobs keep asking for</h4></div>
            {repeatedSignals.length > 0 ? (
              <div className="audit-market-grid">{repeatedSignals.map((item) => (
                <article key={item.skill}>
                  <strong>{readableTechnology(item.skill)}</strong>
                  <p>{marketSignalText(item, result.market_intelligence.comparable_listing_count)}</p>
                </article>
              ))}</div>
            ) : <p>Prospect needs more comparable listings before it can call something a real pattern.</p>}
          </section>

          <details className="audit-technical">
            <summary>Evidence details and audit history</summary>
            <p>These references let an agent verify the result. You do not need them to read the recommendation.</p>
            <ul>{result.requirements.map((item) => (
              <li key={item.requirement_id}>
                <strong>{item.wording}</strong> — {AUDIT_LABELS[item.classification] || humanize(item.classification)}
                {item.claim_ids.length ? ` · Career evidence: ${item.claim_ids.join(', ')}` : ' · No matching Career claim'}
              </li>
            ))}</ul>
            {active.synthesis?.summary ? <p><strong>AI source explanation:</strong> {readableAuditText(active.synthesis.summary)}</p> : null}
            {audits.length > 1 && <div><strong>Previous audits</strong><ol>{audits.map((audit) => <li key={audit.id}><button className="text-button" onClick={() => setActive(audit)}>Audit {audit.id} · {audit.created_at} · {audit.status}</button></li>)}</ol></div>}
          </details>
        </div>
      )}
    </section>
  );
}

// Fail-safe buffer added on top of the live --dur-move-exit reading below —
// covers rounding/paint jitter so the timer fires just after the real
// transition would, never meaningfully before it.
const CLOSING_FALLBACK_BUFFER_MS = 40;

export function ClaimDetail({ claimId, onClose }) {
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [packageBaselineId, setPackageBaselineId] = React.useState('');
  // 'closed': unmounted (renders null). 'open': live. 'closing': close was
  // requested — stays mounted so the exit parallax (§3.3, leave-faster
  // §5.8) can play before the real onClose fires. App.jsx always renders
  // <ClaimDetail>; ClaimDetail owns its own open→closing→gone lifecycle
  // rather than snapping shut the instant claimId goes null.
  const [phase, setPhase] = React.useState('closed');
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const panelRef = React.useRef(null);
  const closingRef = React.useRef(false);
  const fallbackTimerRef = React.useRef(null);
  const previousFocusRef = React.useRef(null);

  const load = React.useCallback(() => {
    if (claimId == null) return;
    Promise.all([getClaim(claimId), listResumeVersions()])
      .then(([claimData, resumeData]) => setData({ ...claimData, resume_versions: resumeData.resume_versions || [] }))
      .catch((err) => setError(err.message));
  }, [claimId]);

  React.useEffect(() => {
    if (claimId == null) return;
    previousFocusRef.current = document.activeElement;
    closingRef.current = false;
    if (fallbackTimerRef.current) { clearTimeout(fallbackTimerRef.current); fallbackTimerRef.current = null; }
    setData(null);
    setError(null);
    setPackageBaselineId('');
    setPhase('open');
    load();
  }, [claimId, load]);

  React.useEffect(() => () => {
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
  }, []);

  React.useEffect(() => {
    if (phase !== 'open' || !panelRef.current || deleteOpen) return undefined;
    const panel = panelRef.current;
    const selector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const first = panel.querySelector(selector);
    (first || panel).focus();
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...panel.querySelectorAll(selector)].filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) { event.preventDefault(); panel.focus(); return; }
      const firstItem = focusable[0];
      const lastItem = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [phase, deleteOpen]);

  // Always reaches phase 'closed' + calls the real onClose exactly once,
  // whether triggered by the panel's transitionend or the fallback timer —
  // fail-safe: never stuck open, never a silent no-close.
  function finishClose() {
    if (!closingRef.current) return;
    closingRef.current = false;
    if (fallbackTimerRef.current) { clearTimeout(fallbackTimerRef.current); fallbackTimerRef.current = null; }
    setPhase('closed');
    if (previousFocusRef.current?.focus) previousFocusRef.current.focus();
    previousFocusRef.current = null;
    onClose && onClose();
  }

  function requestClose() {
    if (closingRef.current || phase !== 'open') return;
    closingRef.current = true;
    setPhase('closing');
    // transitionend alone isn't reliable here: under reduced motion
    // --dur-move-exit resolves to 0 and zero-duration CSS transitions
    // don't fire transitionend. Read the live token off the root so the
    // fallback tracks whatever's actually in effect (full motion or
    // reduced) instead of assuming a duration.
    let fallbackMs = CLOSING_FALLBACK_BUFFER_MS;
    try {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--dur-move');
      const durMove = parseFloat(raw) || 0;
      fallbackMs = durMove * 0.7 + CLOSING_FALLBACK_BUFFER_MS;
    } catch { /* keep the buffer-only fallback */ }
    fallbackTimerRef.current = setTimeout(finishClose, fallbackMs);
  }

  // Closes the modal through the same requestClose path as the X button, so App.jsx's
  // onClose (setOpenClaimId(null) + refresh()) runs afterward and the deleted card drops off
  // the board on the next render -- no separate board-state plumbing needed here.
  async function confirmDelete() {
    await deleteClaim(claimId);
    setDeleteOpen(false);
    requestClose();
  }

  function handlePanelTransitionEnd(e) {
    if (e.target !== panelRef.current || e.propertyName !== 'transform') return;
    finishClose();
  }

  if (phase === 'closed') return null;

  const closing = phase === 'closing';
  const auditedBaselines = data?.resume_versions?.filter(
    (version) => version.kind === 'baseline' && version.body && version.audit_status,
  ) || [];
  const defaultBaselineId = auditedBaselines.some((version) => Number(version.id) === Number(data?.claim?.resume_version_id))
    ? String(data.claim.resume_version_id)
    : (auditedBaselines[0] ? String(auditedBaselines[0].id) : '');
  const selectedPackageBaselineId = packageBaselineId || defaultBaselineId;

  return (
    <React.Fragment>
    <div
      onClick={requestClose}
      className={`claim-scrim${closing ? ' is-closing' : ''}`}
      style={{
        position: 'fixed', inset: 0, zIndex: 70,
        background: 'rgba(16,23,26,.6)',
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={data ? 'claim-detail-title' : undefined}
        aria-label={!data ? `Claim #${claimId}` : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onTransitionEnd={handlePanelTransitionEnd}
        className={`claim-panel on-light${closing ? ' is-closing' : ''}`}
        style={{
          background: 'var(--surface-card)',
          boxShadow: 'var(--shadow-pop)', display: 'flex', flexDirection: 'column', overflowY: 'auto',
        }}
      >
        <div className="claim-detail-header" style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 18px', borderBottom: '1px dashed var(--galena-dim)', background: 'var(--bg-sunken)',
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
            claim #{claimId}
          </span>
          <IconButton size="sm" label="Close" onClick={requestClose}><CloseIcon /></IconButton>
        </div>

        {error && (
          <div style={{ padding: 20 }}>
            <EmptyState title="Couldn't load this claim" line={error} />
          </div>
        )}

        {!error && !data && (
          <div style={{ padding: 20, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)' }}>
            loading…
          </div>
        )}

        {!error && data && (
          <div className={`claim-content${closing ? ' is-closing' : ''}`} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div>
              <h2 id="claim-detail-title" style={{ fontFamily: 'var(--font-slab)', fontWeight: 700, fontSize: 22, color: 'var(--text-strong)', margin: 0 }}>
                {data.listing.role || 'Untitled role'}
              </h2>
              <div style={{ color: 'var(--text-muted)', margin: '3px 0 0', fontSize: 14 }}>
                {data.listing.company}{data.listing.location ? ` — ${data.listing.location}` : ''}
              </div>
              <ClaimApplyLinks listing={data.listing} />
            </div>

            <WorkingState claim={data.claim} onPatched={(claim) => setData((d) => ({ ...d, claim }))} />

            <CareerFitPanel fit={data.career_fit} />

            <SalaryGuidancePanel guidance={data.salary_guidance} />

            <InterviewPreparationPanel
              claim={data.claim}
              versions={data.resume_versions || []}
              initialPreparations={data.interview_preparations || []}
            />

            <JobListingAuditPanel
              claimId={claimId}
              initialAudits={data.job_audits || []}
              baselineResumeVersionId={selectedPackageBaselineId}
              onChanged={load}
            />

            <ApplicationPackagePanel
              claim={data.claim}
              versions={data.resume_versions || []}
              initialPackages={data.application_packages || []}
              readinessRevision={`${data.job_audits?.[0]?.id || 'none'}:${data.job_audits?.[0]?.status || 'none'}:${data.job_audits?.[0]?.enrichment?.status || 'none'}`}
              baselineId={selectedPackageBaselineId}
              onBaselineChange={setPackageBaselineId}
            />

            <ResumeVersionPanel
              claim={data.claim}
              versions={data.resume_versions || []}
              sends={data.resume_sends || []}
              onRecorded={load}
            />

            <CapturedSnapshot listing={data.listing} closing={closing} />

            <Logbook
              claimId={claimId}
              notes={data.notes}
              onNoteAdded={(note) => setData((d) => ({ ...d, notes: [...d.notes, note] }))}
            />

            <History transitions={data.transitions} />

            <Touchpoints
              claimId={claimId}
              events={data.events}
              onEventAdded={(event, replacement) => setData((d) => ({
                ...d,
                events: replacement || [...d.events, event],
              }))}
            />

            <Contacts contacts={data.contacts} />

            {data.advisory && <PostingJudgmentPanel advisory={data.advisory} />}
          </div>
        )}

        {!error && data && (
          <div className="claim-detail-footer" style={{
            flexShrink: 0,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 20px', borderTop: '1px dashed var(--galena-dim)',
            background: 'var(--surface-card)',
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>Packages prepare locally; no external action</span>
            <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
              Abandon claim
            </Button>
          </div>
        )}
      </div>
    </div>

    <DeleteClaimDialog
      open={deleteOpen}
      onClose={() => setDeleteOpen(false)}
      onConfirm={confirmDelete}
    />
    </React.Fragment>
  );
}
