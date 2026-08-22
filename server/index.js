import {
  loadVapidConfig,
  ensureVapidKeys,
  upsertSubscription,
  deactivateSubscription,
  getSubscriptionStatus,
  updateSubscriptionPreferences,
  sendPushNotification,
} from './push.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { db, STAGES } from './db.js';
import {
  isValidEnum, isValidCurrency, toBool, toIntOrNull, toRealOrNull,
  computeAnnualComp, daysBetween, computeApplicantsPerDay, descHash,
  computePostingQuality, canonicalCompanyName, normalizeSkills, normalizeContacts,
} from './validate.js';
import { detectRepost, detectSemanticRepost, lineDiff, linkRepost, RepostLinkError } from './repost.js';
import { getHuntReport, renderHuntReportHtml } from './huntReport.js';
import { getClaimOffice, renderClaimOfficeHtml } from './claimoffice.js';
import { getDailyDiggings, renderDailyDiggingsHtml } from './diggings.js';
import { annotateClaimEvents, resolveDeadlineEvent } from './claimEvents.js';
import { deleteClaimById, ClaimDeleteError } from './deleteClaim.js';
import { recordResumeVersionSend } from './resumeVersionSends.js';
import { recordNextActionChange, computeHonestyLedger } from './nextActionCommitments.js';
import { computeLiveness } from './liveness.js';
import { computePledge, renderPledgeHtml } from './pledge.js';
import { computeStrikeSheet, renderStrikeSheetHtml, OFFER_SOURCES } from './strikeSheet.js';
import { computeSelectionIntel, INTERVIEW_KINDS, ARTIFACT_KINDS } from './selection.js';
import {
  computeOutreach, convertThreadToClaim, OutreachConvertError,
  OUTREACH_STATUSES, OUTREACH_DIRECTIONS,
} from './outreach.js';
import { computeVendorStatus, recordObservation, VENDORS } from './vendorStatus.js';
import { computeAlmanac, renderAlmanacHtml, HUNT_STATUSES } from './almanac.js';
import { computeCalibration, recordPrediction } from './calibration.js';
import { adjudicateLiveness, synthesizeOutcomes, draftStatusCheck } from './advisorSlices.js';
import { enqueue as enqueueEmbedding } from './enrich.js';
import './llmParse.js';
import './skillExtract.js';
import './advise.js';
import {
  createJobAudit, getJobAudit, listJobAuditsForClaim, waypointHandoff,
} from './jobAudit.js';
import { embedDocument } from './embed.js';
import { findSimilar } from './similar.js';
import { runFusedSearch } from './search.js';
import { classifyJobFamily } from './jobFamily.js';
import {
  getScout, importDiscoveries, linkCapturedDiscovery, renderScoutHtml,
  saveProfile, setDiscoveryStatus, stakeDiscovery, computeTriage, canonicalUrl,
  latestProfile, scoreJob,
} from './scout.js';
import { createApiTrustMiddleware } from './requestTrust.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// §5.2.4: job_family column may not exist yet (pre-migration-007 / v6 fixture DBs)
// — feature-detect once at boot, same pragma_table_info pattern as jobFamilyReport.js.
const HAS_JOB_FAMILY = db.prepare(`
  SELECT COUNT(*) AS n FROM pragma_table_info('listings') WHERE name='job_family'
`).get().n > 0;
const HAS_SCOUT = db.prepare(`
  SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='scout_discoveries'
`).get().n > 0;

ensureVapidKeys();
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/api', createApiTrustMiddleware());

// §6.8 tailoring-prompt export: directions template is a flat file David edits by hand
// (data/ is gitignored, alongside prospect.db). No prompt prose is hardcoded here — this
// is only a read-with-fallback, never a 500, so a missing/unreadable file never breaks the button.
const TAILORING_TEMPLATE_PATH = path.join(__dirname, '..', 'data', 'tailoring-template.txt');
const DEFAULT_TAILORING_TEMPLATE = `Please tailor my resume for this role using the job description below.

Role: {{role}}
Company: {{company}}
Location: {{location}}
Comp: {{comp}}
Source: {{source_url}}

--- Job description (verbatim, current snapshot) ---
{{description}}
--- end job description ---

Focus on: [replace with what to emphasize — impact, specific skills, keywords, tone]
Avoid: [replace with anything to downplay or exclude]

(Listing #{{listing_id}} · snapshot generation {{snapshot_generation}} · captured {{captured_at}})
`;

app.get('/api/tailoring-template', (req, res) => {
  let template;
  try {
    template = fs.readFileSync(TAILORING_TEMPLATE_PATH, 'utf8');
  } catch {
    template = DEFAULT_TAILORING_TEMPLATE;
  }
  res.json({ template });
});

function snapshotHash({ raw_payload, source, source_url, company, role, location, comp, description, posted_at }) {
  const canonical = raw_payload != null
    ? String(raw_payload)
    : JSON.stringify({ comp, company, description, location, posted_at, role, source, source_url }, Object.keys({ comp, company, description, location, posted_at, role, source, source_url }).sort());
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

app.get('/api/board', (req, res) => {
  const rows = db.prepare(`
    SELECT
      c.id AS claim_id, c.stage, c.next_action, c.next_action_date,
      c.created_at, c.updated_at,
      c.applied_at, c.stage_entered_at, c.outcome_reason,
      l.id AS listing_id, l.company, l.role, l.location, l.comp,
      l.source, l.source_url,
      l.employment_type, l.workplace_type, l.annual_comp_mid,
      l.applicant_count, l.applicants_per_day, l.posting_quality, l.company_id
    FROM claims c
    JOIN listings l ON l.id = c.listing_id
    ORDER BY c.updated_at DESC
  `).all();
  res.json({ claims: rows });
});

// §5.2.2: FTS5 text search fused with a query-time semantic KNN over listings_vec
// (server/search.js). The vec branch degrades internally on any failure (Ollama
// down/timeout, unmigrated/empty vector layer) so this route always resolves with
// at least the FTS5-only results — see search.js's runFusedSearch for the fusion
// and degrade contract.
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const result = await runFusedSearch(db, q);
  res.json(result);
});

app.get('/api/claims/:id/similar', (req, res) => {
  const claimId = Number(req.params.id);
  const result = findSimilar(db, claimId, { k: 5 });
  if (result === null) {
    return res.status(404).json({ error: 'claim not found' });
  }
  res.json(result);
});

app.post('/api/claims', async (req, res) => {
  const {
    source, source_url, raw_payload,
    company, company_url, role, location, comp, description, posted_at,
    job_id, external_job_id, apply_url, location_city, location_state, location_metro,
    next_action, next_action_date,
    employment_type, workplace_type, seniority, role_family,
    salary_min, salary_max, salary_period, salary_currency, comp_disclosed,
    applicant_count, applicants_last_day,
    easy_apply, promoted, verified, actively_reviewing, top_applicant_match,
    skills, parsed, contacts,
  } = req.body || {};

  if (!source || !String(source).trim()) {
    return res.status(400).json({ error: 'source is required' });
  }
  for (const field of ['employment_type', 'workplace_type', 'seniority', 'role_family', 'salary_period']) {
    const value = req.body?.[field];
    if (!isValidEnum(field, value)) {
      return res.status(400).json({ error: `invalid ${field}: ${value}` });
    }
  }
  if (!isValidCurrency(salary_currency)) {
    return res.status(400).json({ error: `invalid salary_currency: ${salary_currency}` });
  }
  const skillsResult = normalizeSkills(skills);
  if (!skillsResult.ok) {
    return res.status(400).json({ error: skillsResult.error });
  }
  const contactsResult = normalizeContacts(contacts);
  if (!contactsResult.ok) {
    return res.status(400).json({ error: contactsResult.error });
  }

  const hash = snapshotHash({ raw_payload, source, source_url, company, role, location, comp, description, posted_at });
  const incomingDescHash = descHash(description);

  // Repost sentinel (§3.3, §5.2.3): detect against the corpus BEFORE the incoming
  // INSERT below, so this listing can never self-match. Best-effort — any
  // detection error must never block the stake (faithful-tracker: capture never
  // fails). EXACT/LIKELY are deterministic and checked first; the semantic tier
  // below only runs when both miss, and sits in its own try/catch (embed + KNN)
  // so a slow/unreachable Ollama degrades that tier alone, never the stake.
  let repostCandidate = null;
  try {
    const incomingCanonical = company && String(company).trim() ? canonicalCompanyName(company) : null;
    const detected = detectRepost(db, { descHash: incomingDescHash, canonicalName: incomingCanonical, role });
    if (detected) {
      const { prior_description, ...candidate } = detected;
      repostCandidate = { ...candidate, diff: lineDiff(prior_description, description ?? '') };
    }
  } catch (err) {
    repostCandidate = null;
  }

  if (!repostCandidate) {
    try {
      const embedInput = [role, company, description].filter(Boolean).join('\n');
      const embedding = await embedDocument(embedInput);
      const semanticHit = detectSemanticRepost(db, embedding);
      if (semanticHit) {
        const { prior_description, ...candidate } = semanticHit;
        repostCandidate = { ...candidate, diff: lineDiff(prior_description, description ?? '') };
      }
    } catch (err) {
      // Best-effort, advisory-only: Ollama down/slow/timeout, unmigrated or
      // empty listings_vec, or a malformed embedding all degrade to "no
      // semantic candidate" — never throws out to the stake below.
    }
  }

  const salaryMin = toRealOrNull(salary_min);
  const salaryMax = toRealOrNull(salary_max);
  const compDisclosed = toBool(comp_disclosed);
  const verifiedBool = toBool(verified);
  const { annual_comp_min, annual_comp_max, annual_comp_mid } = computeAnnualComp(salaryMin, salaryMax, salary_period ?? null);
  const applicantsPerDay = computeApplicantsPerDay(applicant_count, posted_at ?? null, null);
  const parsedValue = parsed != null && typeof parsed === 'object' ? JSON.stringify(parsed) : (typeof parsed === 'string' ? parsed : null);
  const postingQuality = computePostingQuality({
    comp_disclosed: compDisclosed, salary_min: salaryMin, salary_max: salaryMax,
    description, skillCount: skillsResult.skills.length, company, verified: verifiedBool,
  });
  const jobFamily = classifyJobFamily(role);

  const stake = db.transaction(() => {
    const extId = external_job_id || job_id;
    const cUrl = source_url ? canonicalUrl(source_url) : null;
    let existingRow = null;

    // A linked Scout discovery is the strongest identity signal because David already
    // attached it to a specific claim. It remains authoritative after the provisional
    // listing has been replaced by one or more verified browser generations.
    if (HAS_SCOUT && extId) {
      existingRow = db.prepare(`
        SELECT d.id AS discovery_id, d.linked_claim_id AS claim_id, c.listing_id AS old_listing_id
        FROM scout_discoveries d
        JOIN claims c ON d.linked_claim_id = c.id
        WHERE d.external_job_id = ? AND d.linked_claim_id IS NOT NULL
        ORDER BY d.id ASC LIMIT 1
      `).get(extId);
    }
    if (HAS_SCOUT && !existingRow && cUrl) {
      existingRow = db.prepare(`
        SELECT d.id AS discovery_id, d.linked_claim_id AS claim_id, c.listing_id AS old_listing_id
        FROM scout_discoveries d
        JOIN claims c ON d.linked_claim_id = c.id
        WHERE d.source_url = ? AND d.linked_claim_id IS NOT NULL
        ORDER BY d.id ASC LIMIT 1
      `).get(cUrl);
    }

    // Non-Scout captures (and already-verified Scout captures) still need a stable
    // re-survey path. Match only the claim's CURRENT listing by exact job identity;
    // historical generations never compete for ownership.
    if (!existingRow && cUrl) {
      existingRow = db.prepare(`
        SELECT NULL AS discovery_id, c.id AS claim_id, c.listing_id AS old_listing_id
        FROM claims c
        JOIN listings l ON c.listing_id = l.id
        WHERE l.source_url = ?
        ORDER BY c.id ASC LIMIT 1
      `).get(cUrl);
    }
    if (!existingRow && extId) {
      existingRow = db.prepare(`
        SELECT NULL AS discovery_id, c.id AS claim_id, c.listing_id AS old_listing_id
        FROM claims c
        JOIN listings l ON c.listing_id = l.id
        WHERE l.external_job_id = ? OR l.job_id = ?
        ORDER BY c.id ASC LIMIT 1
      `).get(extId, extId);
    }

    let existingCapture = null;
    if (existingRow) {
      const oldListing = db.prepare('SELECT * FROM listings WHERE id=?').get(existingRow.old_listing_id);
      if (oldListing) {
        let oldParsed = {};
        try { oldParsed = JSON.parse(oldListing.parsed || '{}'); } catch {}
        const isProvisional = oldListing.source === 'linkedin-alert'
          || oldParsed.verification_status === 'pending-browser-capture';

        // Find the nearest preserved nonblank location. This bounded ancestry walk
        // repairs legacy chains such as Claim #16 (gen2 omitted location, gen1 email
        // snapshot still has Dallas) without changing either historical generation.
        let inheritedLocation = oldListing.location;
        let inheritedLocationListingId = oldListing.id;
        let ancestryParsed = oldParsed;
        const seenListingIds = new Set([oldListing.id]);
        for (let depth = 0; depth < 20 && (!inheritedLocation || !String(inheritedLocation).trim()); depth += 1) {
          const priorId = Number(ancestryParsed.supersedes_listing_id);
          if (!priorId || seenListingIds.has(priorId)) break;
          seenListingIds.add(priorId);
          const priorListing = db.prepare('SELECT id, location, parsed FROM listings WHERE id=?').get(priorId);
          if (!priorListing) break;
          if (priorListing.location && String(priorListing.location).trim()) {
            inheritedLocation = priorListing.location;
            inheritedLocationListingId = priorListing.id;
            break;
          }
          try { ancestryParsed = JSON.parse(priorListing.parsed || '{}'); } catch { break; }
        }

        existingCapture = {
          discoveryId: existingRow.discovery_id,
          claimId: existingRow.claim_id,
          oldListingId: oldListing.id,
          oldGen: oldListing.snapshot_generation || 1,
          oldSnapshotHash: oldListing.snapshot_hash,
          inheritedLocation,
          inheritedLocationListingId,
          isProvisional,
        };
      }
    }

    // Exact repeat submissions are idempotent. Because better-sqlite3 transactions
    // execute serially, two concurrent identical POSTs race safely: the first appends
    // one generation and the second observes that new hash and returns it.
    if (existingCapture && existingCapture.oldSnapshotHash === hash) {
      return {
        claimId: existingCapture.claimId,
        listingId: existingCapture.oldListingId,
        linkCount: 0,
        upgradedExistingClaim: false,
        refreshedExistingClaim: false,
        duplicateCapture: true,
        snapshotGeneration: existingCapture.oldGen,
        matchedExistingClaim: true,
      };
    }

    let companyId = null;
    if (company && String(company).trim()) {
      const canon = canonicalCompanyName(company);
      const companyRow = db.prepare(`
        INSERT INTO companies (name, canonical_name, page_url) VALUES (@name,@canon,@page_url)
        ON CONFLICT(canonical_name) DO UPDATE SET name=excluded.name, page_url=COALESCE(excluded.page_url, companies.page_url)
        RETURNING id
      `).get({ name: company, canon, page_url: company_url ?? null });
      companyId = companyRow.id;
    }

    let incomingParsedObj = {};
    if (parsed != null) {
      if (typeof parsed === 'object') incomingParsedObj = parsed;
      else if (typeof parsed === 'string') {
        try { incomingParsedObj = JSON.parse(parsed); } catch {}
      }
    }

    let mergedParsedStr = parsedValue;
    let nextGen = 1;
    let effectiveLocation = location;

    if (existingCapture) {
      nextGen = existingCapture.oldGen + 1;
      const mergedParsedObj = {
        ...incomingParsedObj,
        capture_source: incomingParsedObj.capture_source || 'browser-extension',
        verification_status: 'browser-captured',
        supersedes_listing_id: existingCapture.oldListingId,
        resurvey_of_claim_id: existingCapture.claimId,
        resurvey_kind: existingCapture.isProvisional ? 'provisional-upgrade' : 'verified-resurvey',
      };
      if (existingCapture.discoveryId) mergedParsedObj.discovery_id = existingCapture.discoveryId;

      // Faithful-tracker note: the browser capture didn't observe a location (LinkedIn's
      // logged-in DOM doesn't always surface it) — carry forward the Scout-provisional
      // listing's location rather than silently dropping it, but say so explicitly in the
      // new generation's own parsed JSON rather than pretending the extension captured it.
      const incomingLocationBlank = !location || !String(location).trim();
      const priorLocationNonblank = existingCapture.inheritedLocation
        && String(existingCapture.inheritedLocation).trim();
      if (incomingLocationBlank && priorLocationNonblank) {
        effectiveLocation = existingCapture.inheritedLocation;
        mergedParsedObj.inherited_from_listing_id = existingCapture.inheritedLocationListingId;
        mergedParsedObj.inherited_fields = ['location'];
      }

      mergedParsedStr = JSON.stringify(mergedParsedObj);
    }

    const listingInfo = db.prepare(`
      INSERT INTO listings (
        source, source_url, raw_payload, company, role, location, comp, description, posted_at, snapshot_hash,
        job_id, external_job_id, apply_url, location_city, location_state, location_metro,
        company_id, employment_type, workplace_type, seniority, role_family,
        salary_min, salary_max, salary_period, salary_currency, comp_disclosed,
        annual_comp_min, annual_comp_max, annual_comp_mid,
        applicant_count, applicants_last_day, applicants_per_day,
        easy_apply, promoted, verified, actively_reviewing, top_applicant_match,
        posting_quality, desc_hash, parsed, snapshot_generation${HAS_JOB_FAMILY ? ', job_family' : ''}
      ) VALUES (
        @source, @source_url, @raw_payload, @company, @role, @location, @comp, @description, @posted_at, @snapshot_hash,
        @job_id, @external_job_id, @apply_url, @location_city, @location_state, @location_metro,
        @company_id, @employment_type, @workplace_type, @seniority, @role_family,
        @salary_min, @salary_max, @salary_period, @salary_currency, @comp_disclosed,
        @annual_comp_min, @annual_comp_max, @annual_comp_mid,
        @applicant_count, @applicants_last_day, @applicants_per_day,
        @easy_apply, @promoted, @verified, @actively_reviewing, @top_applicant_match,
        @posting_quality, @desc_hash, @parsed, @snapshot_generation${HAS_JOB_FAMILY ? ', @job_family' : ''}
      )
    `).run({
      source, source_url: source_url ?? null, raw_payload: raw_payload ?? null,
      company: company ?? null, role: role ?? null, location: effectiveLocation ?? null,
      comp: comp ?? null, description: description ?? null, posted_at: posted_at ?? null,
      snapshot_hash: hash,
      job_id: job_id ?? null, external_job_id: external_job_id ?? null, apply_url: apply_url ?? null,
      location_city: location_city ?? null,
      location_state: location_state ?? null, location_metro: location_metro ?? null,
      company_id: companyId,
      employment_type: employment_type ?? null, workplace_type: workplace_type ?? null,
      seniority: seniority ?? null, role_family: role_family ?? null,
      salary_min: salaryMin, salary_max: salaryMax, salary_period: salary_period ?? null,
      salary_currency: salary_currency ?? null, comp_disclosed: compDisclosed,
      annual_comp_min, annual_comp_max, annual_comp_mid,
      applicant_count: toIntOrNull(applicant_count), applicants_last_day: toIntOrNull(applicants_last_day),
      applicants_per_day: applicantsPerDay,
      easy_apply: toBool(easy_apply), promoted: toBool(promoted), verified: verifiedBool,
      actively_reviewing: toBool(actively_reviewing), top_applicant_match: toBool(top_applicant_match),
      posting_quality: postingQuality, desc_hash: incomingDescHash, parsed: mergedParsedStr,
      snapshot_generation: nextGen,
      ...(HAS_JOB_FAMILY ? { job_family: jobFamily } : {}),
    });
    const listingId = listingInfo.lastInsertRowid;

    for (const s of skillsResult.skills) {
      db.prepare('INSERT INTO listing_skills (listing_id, skill, tier) VALUES (?, ?, ?)').run(listingId, s.skill, s.tier);
    }

    let claimId;
    let upgradedExistingClaim = false;
    let refreshedExistingClaim = false;

    if (existingCapture) {
      claimId = existingCapture.claimId;
      upgradedExistingClaim = existingCapture.isProvisional;
      refreshedExistingClaim = !existingCapture.isProvisional;
      db.prepare("UPDATE claims SET listing_id=?, updated_at=datetime('now') WHERE id=?").run(listingId, claimId);

      const existingContacts = db.prepare("SELECT name, email, role FROM contacts WHERE claim_id = ?").all(claimId);
      const contactKeys = new Set(existingContacts.map(c => `${(c.name || '').toLowerCase()}|${(c.email || '').toLowerCase()}|${(c.role || '').toLowerCase()}`));
      for (const c of contactsResult.contacts) {
        const key = `${(c.name || '').toLowerCase()}|${(c.email || '').toLowerCase()}|${(c.role || '').toLowerCase()}`;
        if (!contactKeys.has(key)) {
          db.prepare(`
            INSERT INTO contacts (claim_id, name, role, email, notes, profile_url, is_job_poster)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(claimId, c.name, c.role, c.email, c.notes, c.profile_url, c.is_job_poster);
          contactKeys.add(key);
        }
      }
    } else {
      const claimInfo = db.prepare(`
        INSERT INTO claims (listing_id, next_action, next_action_date, stage_entered_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(listingId, next_action ?? null, next_action_date ?? null);
      claimId = claimInfo.lastInsertRowid;

      db.prepare(`
        INSERT INTO stage_transitions (claim_id, from_stage, to_stage, note, transition_cause)
        VALUES (?, NULL, 'Showings', 'staked', 'stake')
      `).run(claimId);

      for (const c of contactsResult.contacts) {
        db.prepare(`
          INSERT INTO contacts (claim_id, name, role, email, notes, profile_url, is_job_poster)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(claimId, c.name, c.role, c.email, c.notes, c.profile_url, c.is_job_poster);
      }
    }

    let linkCount = 0;
    if (HAS_SCOUT) {
      linkCount = linkCapturedDiscovery(db, {
        claimId,
        externalJobId: external_job_id ?? job_id,
        sourceUrl: source_url,
      });
    }

    return {
      claimId,
      listingId,
      linkCount,
      upgradedExistingClaim,
      refreshedExistingClaim,
      duplicateCapture: false,
      snapshotGeneration: nextGen,
      matchedExistingClaim: Boolean(existingCapture),
    };
  })();

  // Non-blocking: a no-op when PROSPECT_EMBEDDINGS is off; never awaited, so
  // capture returns 201 immediately regardless of embed state either way.
  if (!stake.duplicateCapture) enqueueEmbedding(stake.listingId);

  // §3.5b: if the snapshot just captured says the employer has stopped accepting applications,
  // record it as an observation. Only on a fresh snapshot -- a duplicate capture would otherwise
  // append the same observation every time the same dead posting is re-captured.
  if (!stake.duplicateCapture) {
    recordCaptureClosure(db, stake.claimId, parsed, source_url);
  }

  const claim = db.prepare(`
    SELECT
      c.id AS claim_id, c.stage, c.next_action, c.next_action_date,
      c.created_at, c.updated_at,
      l.id AS listing_id, l.company, l.role, l.location, l.comp,
      l.source, l.source_url
    FROM claims c JOIN listings l ON l.id = c.listing_id
    WHERE c.id = ?
  `).get(stake.claimId);

  res.status(stake.duplicateCapture ? 200 : 201).json({
    ...claim,
    scout_enriched: Boolean(stake.upgradedExistingClaim || (stake.linkCount && stake.linkCount > 0)),
    upgraded_existing_claim: Boolean(stake.upgradedExistingClaim),
    refreshed_existing_claim: Boolean(stake.refreshedExistingClaim),
    duplicate_capture: Boolean(stake.duplicateCapture),
    created_snapshot: !stake.duplicateCapture,
    snapshot_generation: stake.snapshotGeneration,
    // A provisional Scout claim being upgraded by its own real capture is the same job, not a
    // repost. The same is true of a verified re-survey or exact repeat submission.
    repost_candidate: stake.matchedExistingClaim ? null : repostCandidate,
  });
});

// The only listings UPDATE in the codebase: a David-initiated, optional link
// recording that the claim's listing is a repost of a prior one. Writes ONLY
// the incoming (this claim's) listing row — the prior snapshot is never touched.
// §3.5b + §6.3: a capture whose snapshot carries the employer's own "no longer accepting
// applications" banner records that as a vendor-status observation. The evidence is already in
// the snapshot, so this needs no network call and no crawler (DL-P8) -- and it flows straight into
// liveness, where the claim becomes closed_by_vendor instead of sitting in Showings looking live.
//
// Deliberately an OBSERVATION rather than a stage change: what the employer displays is not David's
// stage, and §3.5b's whole invariant is that the two never merge.
function recordCaptureClosure(db, claimId, parsedField, sourceUrl) {
  let parsed = parsedField;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return null; }
  }
  if (!parsed || parsed.applications_closed !== true) return null;
  const statusText = typeof parsed.applications_closed_text === 'string' && parsed.applications_closed_text.trim()
    ? parsed.applications_closed_text.trim()
    : 'No longer accepting applications';
  try {
    return recordObservation(db, claimId, { statusText, sourceUrl, note: 'observed in the captured snapshot' });
  } catch {
    // An observation is supplementary evidence; failing to record one must never fail the capture
    // that produced it.
    return null;
  }
}

app.post('/api/claims/:id/link-repost', (req, res) => {
  const claimId = Number(req.params.id);
  const repostOfId = toIntOrNull((req.body || {}).repost_of);
  try {
    res.json(linkRepost(db, claimId, repostOfId));
  } catch (err) {
    if (err instanceof RepostLinkError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

app.post('/api/claims/:id/stage', (req, res) => {
  const claimId = Number(req.params.id);
  const { to_stage, note, transition_cause, outcome_reason } = req.body || {};

  if (!STAGES.includes(to_stage)) {
    return res.status(400).json({ error: `to_stage must be one of: ${STAGES.join(', ')}` });
  }
  if (!isValidEnum('transition_cause', transition_cause)) {
    return res.status(400).json({ error: `invalid transition_cause: ${transition_cause}` });
  }
  if (to_stage === 'Tailings') {
    if (!outcome_reason || !String(outcome_reason).trim() || !isValidEnum('outcome_reason', outcome_reason)) {
      return res.status(400).json({ error: 'outcome_reason is required and must be valid when moving to Tailings' });
    }
  } else if (outcome_reason != null && !isValidEnum('outcome_reason', outcome_reason)) {
    return res.status(400).json({ error: `invalid outcome_reason: ${outcome_reason}` });
  }

  const current = db.prepare('SELECT stage, applied_at, listing_id FROM claims WHERE id = ?').get(claimId);
  if (!current) {
    return res.status(404).json({ error: 'claim not found' });
  }

  db.transaction(() => {
    const sets = ['stage = @to_stage', "updated_at = datetime('now')", "stage_entered_at = datetime('now')"];
    const params = { id: claimId, to_stage };

    if (to_stage === 'Staked' && current.applied_at == null) {
      sets.push("applied_at = datetime('now')");
      const listing = db.prepare('SELECT posted_at FROM listings WHERE id = ?').get(current.listing_id);
      const daysPostedAtApply = daysBetween(listing?.posted_at ?? null, null);
      if (daysPostedAtApply != null) {
        sets.push('days_posted_at_apply = @days_posted_at_apply');
        params.days_posted_at_apply = daysPostedAtApply;
      }
    }
    if (to_stage === 'Tailings') {
      sets.push('outcome_reason = @outcome_reason');
      params.outcome_reason = outcome_reason;
    }

    db.prepare(`UPDATE claims SET ${sets.join(', ')} WHERE id = @id`).run(params);
    db.prepare(`
      INSERT INTO stage_transitions (claim_id, from_stage, to_stage, note, transition_cause, outcome_reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(claimId, current.stage, to_stage, note ?? null, transition_cause ?? 'manual', outcome_reason ?? null);
  })();

  const claim = db.prepare(`
    SELECT
      c.id AS claim_id, c.stage, c.next_action, c.next_action_date,
      c.created_at, c.updated_at,
      l.id AS listing_id, l.company, l.role, l.location, l.comp,
      l.source, l.source_url
    FROM claims c JOIN listings l ON l.id = c.listing_id
    WHERE c.id = ?
  `).get(claimId);

  res.json(claim);
});

app.get('/api/claims/:id', (req, res) => {
  const claimId = Number(req.params.id);

  const claim = db.prepare('SELECT * FROM claims WHERE id = ?').get(claimId);
  if (!claim) {
    return res.status(404).json({ error: 'claim not found' });
  }

  const listing = db.prepare(`
    SELECT l.*, (
      SELECT c2.id FROM claims c2 WHERE c2.listing_id = l.repost_of ORDER BY c2.created_at DESC, c2.id DESC LIMIT 1
    ) AS repost_of_claim_id
    FROM listings l WHERE l.id = ?
  `).get(claim.listing_id);
  const notes = db.prepare('SELECT * FROM claim_notes WHERE claim_id = ? ORDER BY created_at, id').all(claimId);
  const transitions = db.prepare('SELECT * FROM stage_transitions WHERE claim_id = ? ORDER BY transitioned_at, id').all(claimId);
  const contacts = db.prepare('SELECT * FROM contacts WHERE claim_id = ?').all(claimId);
  const events = annotateClaimEvents(
    db.prepare('SELECT * FROM claim_events WHERE claim_id = ? ORDER BY occurred_at, id').all(claimId)
  );
  const resumeSends = db.prepare(`
    SELECT rvs.*, rv.label AS resume_label
    FROM resume_version_sends rvs
    LEFT JOIN resume_versions rv ON rv.id = rvs.resume_version_id
    WHERE rvs.claim_id = ? ORDER BY rvs.sent_at, rvs.id
  `).all(claimId);
  const careerProfile = latestProfile(db);
  const careerFit = listing && careerProfile
    ? {
        profile_id: careerProfile.id,
        profile_label: careerProfile.label,
        ...scoreJob({
          role: listing.role,
          location: listing.location,
          description: listing.description,
        }, careerProfile.profile),
      }
    : null;
  // Latest stored posting-judgment advisory for this listing (§6.7.1, migrations/013) — its
  // own append-only table, never listings.parsed, so a dedicated read here rather than a
  // SELECT l.* field like llm_parse/skill_extract get.
  const advisory = listing
    ? db.prepare('SELECT * FROM listing_advisories WHERE listing_id = ? ORDER BY id DESC LIMIT 1').get(listing.id)
    : null;
  const jobAudits = listJobAuditsForClaim(claimId);

  res.json({
    claim, listing, notes, transitions, contacts, events,
    resume_sends: resumeSends,
    career_fit: careerFit,
    advisory: advisory || null,
    job_audits: jobAudits,
  });
});

app.post('/api/claims/:id/job-audits', (req, res) => {
  const claimId = Number(req.params.id);
  const claim = db.prepare('SELECT id, listing_id FROM claims WHERE id = ?').get(claimId);
  if (!claim) return res.status(404).json({ error: 'claim not found' });
  try {
    const audit = createJobAudit({ listingId: claim.listing_id, claimId, force: req.body?.force === true });
    return res.status(audit.status === 'pending' ? 202 : 200).json(audit);
  } catch (error) {
    return res.status(503).json({ error: `job audit unavailable: ${error.message}` });
  }
});

app.get('/api/job-audits/:id', (req, res) => {
  const audit = getJobAudit(Number(req.params.id));
  if (!audit) return res.status(404).json({ error: 'job audit not found' });
  return res.json(audit);
});

app.post('/api/job-audits/:id/retry', (req, res) => {
  const prior = getJobAudit(Number(req.params.id));
  if (!prior) return res.status(404).json({ error: 'job audit not found' });
  try {
    return res.status(202).json(createJobAudit({
      listingId: prior.listing_id, claimId: prior.claim_id, force: true,
    }));
  } catch (error) {
    return res.status(503).json({ error: `job audit unavailable: ${error.message}` });
  }
});

app.get('/api/job-audits/:id/waypoint-handoff', (req, res) => {
  const audit = getJobAudit(Number(req.params.id));
  if (!audit) return res.status(404).json({ error: 'job audit not found' });
  return res.json(waypointHandoff(audit));
});

app.post('/api/claims/:id/notes', (req, res) => {
  const claimId = Number(req.params.id);
  const { body } = req.body || {};

  if (!body || !String(body).trim()) {
    return res.status(400).json({ error: 'body is required' });
  }

  const claim = db.prepare('SELECT id FROM claims WHERE id = ?').get(claimId);
  if (!claim) {
    return res.status(404).json({ error: 'claim not found' });
  }

  const info = db.prepare('INSERT INTO claim_notes (claim_id, body) VALUES (?, ?)').run(claimId, String(body));
  const note = db.prepare('SELECT * FROM claim_notes WHERE id = ?').get(info.lastInsertRowid);

  res.status(201).json(note);
});

// Manual-add path for contacts the extractor never sends (e.g. email/notes filled in by hand).
// Body is either a single contact object or {contacts: [...]}.
app.post('/api/claims/:id/contacts', (req, res) => {
  const claimId = Number(req.params.id);
  const body = req.body || {};
  const items = Array.isArray(body.contacts) ? body.contacts : [body];

  const claim = db.prepare('SELECT id FROM claims WHERE id = ?').get(claimId);
  if (!claim) {
    return res.status(404).json({ error: 'claim not found' });
  }

  const contactsResult = normalizeContacts(items);
  if (!contactsResult.ok) {
    return res.status(400).json({ error: contactsResult.error });
  }
  if (contactsResult.contacts.length === 0) {
    return res.status(400).json({ error: 'at least one contact is required' });
  }

  const inserted = db.transaction(() => {
    const rows = [];
    for (const c of contactsResult.contacts) {
      const info = db.prepare(`
        INSERT INTO contacts (claim_id, name, role, email, notes, profile_url, is_job_poster)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(claimId, c.name, c.role, c.email, c.notes, c.profile_url, c.is_job_poster);
      rows.push(db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid));
    }
    return rows;
  })();

  res.status(201).json(Array.isArray(body.contacts) ? inserted : inserted[0]);
});

// §3.4 typed claim events (employer gates/touchpoints) -- insert-only, single-object-only (no
// batch use case yet, unlike contacts). Same shape as stage_transitions/claim_notes: no PATCH/DELETE.
app.post('/api/claims/:id/events', (req, res) => {
  const claimId = Number(req.params.id);
  const { kind, occurred_at, due_at, payload } = req.body || {};

  const claim = db.prepare('SELECT id FROM claims WHERE id = ?').get(claimId);
  if (!claim) {
    return res.status(404).json({ error: 'claim not found' });
  }
  if (!kind || !isValidEnum('claim_event_kind', kind)) {
    return res.status(400).json({ error: `invalid kind: ${kind}` });
  }

  const payloadValue = payload == null
    ? null
    : (typeof payload === 'string' ? payload : JSON.stringify(payload));

  const inserted = db.transaction(() => {
    const info = occurred_at
      ? db.prepare('INSERT INTO claim_events (claim_id, kind, occurred_at, due_at, payload) VALUES (?, ?, ?, ?, ?)')
          .run(claimId, kind, occurred_at, due_at ?? null, payloadValue)
      : db.prepare('INSERT INTO claim_events (claim_id, kind, due_at, payload) VALUES (?, ?, ?, ?)')
          .run(claimId, kind, due_at ?? null, payloadValue);
    return db.prepare('SELECT * FROM claim_events WHERE id = ?').get(info.lastInsertRowid);
  })();

  res.status(201).json(inserted);
});

// Append-only hard-gate resolution. The original due-bearing event is immutable; resolving adds
// a deadline_resolved event whose payload references it. Repeat requests return the existing row.
app.post('/api/claims/:id/events/:eventId/resolve', (req, res) => {
  const result = resolveDeadlineEvent(db, {
    claimId: req.params.id,
    eventId: req.params.eventId,
    reason: req.body?.reason,
    note: req.body?.note,
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  const events = annotateClaimEvents(
    db.prepare('SELECT * FROM claim_events WHERE claim_id = ? ORDER BY occurred_at, id')
      .all(Number(req.params.id))
  );
  res.status(result.created ? 201 : 200).json({
    created: result.created,
    resolution: result.event,
    target_event_id: Number(req.params.eventId),
    events,
  });
});

const CLAIM_PATCH_KEYS = ['next_action', 'next_action_date', 'referral', 'cover_letter', 'application_minutes', 'gut_prediction', 'resume_version_id', 'outcome_reason', 'vendor_tracker_url'];

app.patch('/api/claims/:id', (req, res) => {
  const claimId = Number(req.params.id);
  const body = req.body || {};
  const keys = Object.keys(body);

  if (keys.length === 0 || !keys.every((k) => CLAIM_PATCH_KEYS.includes(k))) {
    return res.status(400).json({ error: `only these keys may be patched: ${CLAIM_PATCH_KEYS.join(', ')}` });
  }
  if (body.outcome_reason != null && !isValidEnum('outcome_reason', body.outcome_reason)) {
    return res.status(400).json({ error: `invalid outcome_reason: ${body.outcome_reason}` });
  }

  const current = db.prepare(
    'SELECT id, resume_version_id, next_action, next_action_date FROM claims WHERE id = ?'
  ).get(claimId);
  if (!current) {
    return res.status(404).json({ error: 'claim not found' });
  }

  const coerce = {
    next_action: (v) => v ?? null,
    next_action_date: (v) => v ?? null,
    referral: toBool,
    cover_letter: toBool,
    application_minutes: toIntOrNull,
    gut_prediction: toRealOrNull,
    resume_version_id: toIntOrNull,
    outcome_reason: (v) => v ?? null,
    vendor_tracker_url: (v) => v ?? null,
  };

  const sets = [];
  const params = { id: claimId };
  for (const key of keys) {
    sets.push(`${key} = @${key}`);
    params[key] = coerce[key](body[key]);
  }
  sets.push("updated_at = datetime('now')");

  const patchClaimTx = db.transaction(() => {
    db.prepare(`UPDATE claims SET ${sets.join(', ')} WHERE id = @id`).run(params);
    // H16: log an append-only send record whenever resume_version_id actually changes to a real
    // value, alongside the "current" column update above -- see server/resumeVersionSends.js.
    if (keys.includes('resume_version_id')) {
      recordResumeVersionSend(db, claimId, current.resume_version_id, params.resume_version_id);
    }
    // §6.3: same pattern one generation later -- next_action/next_action_date are a mutable
    // pair, so the append-only commitment ledger is written from this same transaction. Either
    // key may be patched alone, so the unpatched half falls back to its current value rather
    // than to undefined (which would read as a cleared commitment).
    // §5.4: gut_prediction is a mutable column, so the forecast is also logged append-only with
    // the claim's stage at the time. Scoring the column directly would measure hindsight.
    if (keys.includes('gut_prediction') && params.gut_prediction != null) {
      recordPrediction(db, claimId, { predictor: 'gut', value: params.gut_prediction, valueRaw: params.gut_prediction });
    }
    if (keys.includes('next_action') || keys.includes('next_action_date')) {
      recordNextActionChange(
        db,
        claimId,
        { action: current.next_action, due_date: current.next_action_date },
        {
          action: keys.includes('next_action') ? params.next_action : current.next_action,
          due_date: keys.includes('next_action_date') ? params.next_action_date : current.next_action_date,
        },
      );
    }
  });

  try {
    patchClaimTx();
  } catch (err) {
    if (String(err.message).includes('FOREIGN KEY constraint failed')) {
      return res.status(400).json({ error: 'invalid resume_version_id' });
    }
    throw err;
  }

  const claim = db.prepare('SELECT * FROM claims WHERE id = ?').get(claimId);
  res.json(claim);
});

// Hard delete, gated behind a client-side confirm dialog. Backs up the full claim bundle to
// deleted-claims/ BEFORE any DELETE statement runs, then cascades child rows in FK order
// (schema has no ON DELETE clause anywhere -- see deleteClaim.js). The listing is only removed
// once no other claim/repost still references it.
app.delete('/api/claims/:id', (req, res) => {
  const claimId = Number(req.params.id);
  try {
    res.json(deleteClaimById(db, claimId));
  } catch (err) {
    if (err instanceof ClaimDeleteError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

app.get('/api/resume-versions', (req, res) => {
  const rows = db.prepare('SELECT * FROM resume_versions ORDER BY created_at DESC, id DESC').all();
  res.json({ resume_versions: rows });
});

app.post('/api/resume-versions', (req, res) => {
  const { label, notes } = req.body || {};
  if (!label || !String(label).trim()) {
    return res.status(400).json({ error: 'label is required' });
  }
  const notesValue = notes != null && String(notes).trim() ? String(notes).trim() : null;

  const info = db.prepare('INSERT INTO resume_versions (label, notes) VALUES (?, ?)').run(String(label).trim(), notesValue);
  const row = db.prepare('SELECT * FROM resume_versions WHERE id = ?').get(info.lastInsertRowid);

  res.status(201).json(row);
});

// Read-only analytics report over the append-only stage_transitions log. Registered before the
// SPA catch-all below so it isn't swallowed by it.
app.get('/api/hunt-report', (req, res) => {
  res.json(getHuntReport(db));
});

app.get('/report', (req, res) => {
  res.send(renderHuntReportHtml(getHuntReport(db)));
});

// Read-only derived view over companies + contacts. Registered before the SPA catch-all below so
// it isn't swallowed by it, same pattern as /api/hunt-report + /report above.
// §6.3 deterministic liveness. Read-only and network-free -- see server/liveness.js on why this
// is not allowed to poll postings. `residue` is the contract §6.7.3 consumes.
app.get('/api/liveness', (req, res) => {
  res.json(computeLiveness(db));
});

// §6.3 honesty ledger over the append-only commitment log (migration 018).
app.get('/api/honesty-ledger', (req, res) => {
  res.json(computeHonestyLedger(db));
});

// §6.7.2 / §6.7.3 / §6.7.4 -- the judgment-only advisor slices. Each is gated on PROSPECT_ADVISOR
// and on its own data gate, and each returns {gated:true} with what it has and what it needs rather
// than a hedged answer produced from too little. All three are POST because they can run a model.
app.post('/api/advisor/liveness-adjudication', async (req, res) => {
  res.json(await adjudicateLiveness(db));
});

app.post('/api/advisor/outcome-synthesis', async (req, res) => {
  res.json(await synthesizeOutcomes(db));
});

app.post('/api/claims/:id/status-check-draft', async (req, res) => {
  res.json(await draftStatusCheck(db, Number(req.params.id)));
});

// Read back stored judgments without running anything.
app.get('/api/advisor/outputs', (req, res) => {
  const slice = req.query.slice ? String(req.query.slice) : null;
  const rows = slice
    ? db.prepare('SELECT * FROM advisor_outputs WHERE slice = ? ORDER BY generated_at DESC, id DESC LIMIT 100').all(slice)
    : db.prepare('SELECT * FROM advisor_outputs ORDER BY generated_at DESC, id DESC LIMIT 100').all();
  res.json(rows.map((row) => ({ ...row, output: JSON.parse(row.output) })));
});

// §5.4 calibration. Reports nothing until the evidence exists -- see server/calibration.js.
app.get('/api/calibration', (req, res) => {
  res.json(computeCalibration(db));
});

// §6.5 The Prospector's Almanac and multi-hunt archives.
app.get('/api/almanac', (req, res) => {
  res.json(computeAlmanac(db));
});

app.get('/almanac', (req, res) => {
  res.type('html').send(renderAlmanacHtml(computeAlmanac(db)));
});

app.get('/api/hunts', (req, res) => {
  res.json(db.prepare('SELECT * FROM hunts ORDER BY started_at ASC, id ASC').all());
});

app.post('/api/hunts', (req, res) => {
  const body = req.body || {};
  if (!String(body.name || '').trim()) return res.status(400).json({ error: 'name is required' });
  if (body.status != null && !HUNT_STATUSES.includes(body.status)) {
    return res.status(400).json({ error: `status must be one of: ${HUNT_STATUSES.join(', ')}` });
  }
  const info = db.prepare(`
    INSERT INTO hunts (name, goal, status, started_at)
    VALUES (@name, @goal, @status, COALESCE(@started_at, datetime('now')))
  `).run({
    name: String(body.name).trim(),
    goal: body.goal ?? null,
    status: body.status ?? 'active',
    started_at: body.started_at ?? null,
  });
  res.status(201).json(db.prepare('SELECT * FROM hunts WHERE id = ?').get(info.lastInsertRowid));
});

// Closing a hunt is the one mutation here, and it deliberately does NOT touch the hunt's claims.
// A hunt ending does not resolve the applications inside it -- some are still live, and marking
// them otherwise to tidy up a boundary would be exactly the silent loss this tracker exists to
// prevent. The claims keep their stages; the hunt simply stops being the current one.
app.patch('/api/hunts/:id', (req, res) => {
  const huntId = Number(req.params.id);
  const body = req.body || {};
  const hunt = db.prepare('SELECT * FROM hunts WHERE id = ?').get(huntId);
  if (!hunt) return res.status(404).json({ error: 'hunt not found' });

  const allowed = ['name', 'goal', 'status', 'ended_at', 'outcome_note'];
  const keys = Object.keys(body);
  if (keys.length === 0 || !keys.every((k) => allowed.includes(k))) {
    return res.status(400).json({ error: `only these keys may be patched: ${allowed.join(', ')}` });
  }
  if (body.status != null && !HUNT_STATUSES.includes(body.status)) {
    return res.status(400).json({ error: `status must be one of: ${HUNT_STATUSES.join(', ')}` });
  }

  const sets = keys.map((k) => `${k} = @${k}`);
  const params = { id: huntId };
  for (const key of keys) params[key] = body[key] ?? null;
  db.prepare(`UPDATE hunts SET ${sets.join(', ')} WHERE id = @id`).run(params);
  res.json(db.prepare('SELECT * FROM hunts WHERE id = ?').get(huntId));
});

// §3.5b vendor-status observations. Employer-claimed status, kept strictly separate from
// claims.stage -- this write path never touches the stage log.
app.get('/api/vendor-status', (req, res) => {
  res.json(computeVendorStatus(db));
});

app.post('/api/claims/:id/vendor-status', (req, res) => {
  const claimId = Number(req.params.id);
  const body = req.body || {};
  if (!String(body.status_text || '').trim()) {
    return res.status(400).json({ error: 'status_text is required' });
  }
  if (body.vendor != null && !VENDORS.includes(body.vendor)) {
    return res.status(400).json({ error: `vendor must be one of: ${VENDORS.join(', ')}` });
  }
  const row = recordObservation(db, claimId, {
    statusText: body.status_text,
    vendor: body.vendor ?? null,
    sourceUrl: body.source_url ?? null,
    note: body.note ?? null,
    observedAt: body.observed_at ?? null,
  });
  if (!row) return res.status(404).json({ error: 'claim not found' });
  res.status(201).json(row);
});

// §6.6 inbound outreach: claim-less recruiter leads, and the origin edge when one converts.
app.get('/api/outreach', (req, res) => {
  res.json(computeOutreach(db));
});

app.post('/api/outreach', (req, res) => {
  const body = req.body || {};
  // A thread with no way to identify who it is from is not a lead. Requiring one identifier keeps
  // the list from filling with rows nobody can act on.
  const identified = ['contact_name', 'contact_email', 'contact_profile_url', 'company_name']
    .some((key) => String(body[key] || '').trim());
  if (!identified) {
    return res.status(400).json({ error: 'at least one of contact_name, contact_email, contact_profile_url, company_name is required' });
  }
  if (body.status != null && !OUTREACH_STATUSES.includes(body.status)) {
    return res.status(400).json({ error: `status must be one of: ${OUTREACH_STATUSES.join(', ')}` });
  }
  if (body.company_id != null && !db.prepare('SELECT id FROM companies WHERE id = ?').get(Number(body.company_id))) {
    return res.status(400).json({ error: 'company not found' });
  }
  const info = db.prepare(`
    INSERT INTO outreach_threads (
      company_id, company_name, contact_name, contact_role, contact_email, contact_profile_url,
      channel, role_pitched, location, status, first_contact_at, note
    ) VALUES (
      @company_id, @company_name, @contact_name, @contact_role, @contact_email, @contact_profile_url,
      @channel, @role_pitched, @location, @status, COALESCE(@first_contact_at, datetime('now')), @note
    )
  `).run({
    company_id: body.company_id == null ? null : Number(body.company_id),
    company_name: body.company_name ?? null,
    contact_name: body.contact_name ?? null,
    contact_role: body.contact_role ?? null,
    contact_email: body.contact_email ?? null,
    contact_profile_url: body.contact_profile_url ?? null,
    channel: body.channel ?? null,
    role_pitched: body.role_pitched ?? null,
    location: body.location ?? null,
    status: body.status ?? 'open',
    first_contact_at: body.first_contact_at ?? null,
    note: body.note ?? null,
  });
  res.status(201).json(db.prepare('SELECT * FROM outreach_threads WHERE id = ?').get(info.lastInsertRowid));
});

app.post('/api/outreach/:id/messages', (req, res) => {
  const threadId = Number(req.params.id);
  const body = req.body || {};
  if (!db.prepare('SELECT id FROM outreach_threads WHERE id = ?').get(threadId)) {
    return res.status(404).json({ error: 'outreach thread not found' });
  }
  if (!OUTREACH_DIRECTIONS.includes(body.direction)) {
    return res.status(400).json({ error: `direction must be one of: ${OUTREACH_DIRECTIONS.join(', ')}` });
  }
  const info = db.prepare(`
    INSERT INTO outreach_messages (thread_id, direction, body, occurred_at)
    VALUES (?, ?, ?, COALESCE(?, datetime('now')))
  `).run(threadId, body.direction, body.body ?? null, body.occurred_at ?? null);
  res.status(201).json(db.prepare('SELECT * FROM outreach_messages WHERE id = ?').get(info.lastInsertRowid));
});

// Links an already-captured claim to the thread it came from. Deliberately does not create a
// listing -- see server/outreach.js on why a recruiter's pitch must not become a snapshot.
app.post('/api/outreach/:id/convert', (req, res) => {
  try {
    res.json(convertThreadToClaim(db, Number(req.params.id), { claimId: Number((req.body || {}).claim_id) }));
  } catch (err) {
    if (err instanceof OutreachConvertError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

// §6.4 selection-process intelligence: the interview log, the question bank, and company-scoped
// process artifacts. Read model is all-SELECT; the three POSTs below are the write path.
app.get('/api/selection-intel', (req, res) => {
  res.json(computeSelectionIntel(db));
});

app.post('/api/claims/:id/interviews', (req, res) => {
  const claimId = Number(req.params.id);
  const body = req.body || {};
  if (!db.prepare('SELECT id FROM claims WHERE id = ?').get(claimId)) {
    return res.status(404).json({ error: 'claim not found' });
  }
  if (!INTERVIEW_KINDS.includes(body.kind)) {
    return res.status(400).json({ error: `kind must be one of: ${INTERVIEW_KINDS.join(', ')}` });
  }
  // contact_id must belong to THIS claim -- contacts are claim-scoped, and accepting an arbitrary id
  // would silently attach another application's interviewer to this one.
  if (body.contact_id != null) {
    const contact = db.prepare('SELECT id FROM contacts WHERE id = ? AND claim_id = ?').get(Number(body.contact_id), claimId);
    if (!contact) return res.status(400).json({ error: 'contact_id must be a contact on this claim' });
  }
  const info = db.prepare(`
    INSERT INTO interviews (claim_id, kind, format, scheduled_at, occurred_at, duration_minutes, contact_id, outcome_note)
    VALUES (@claim_id, @kind, @format, @scheduled_at, @occurred_at, @duration_minutes, @contact_id, @outcome_note)
  `).run({
    claim_id: claimId,
    kind: body.kind,
    format: body.format ?? null,
    scheduled_at: body.scheduled_at ?? null,
    occurred_at: body.occurred_at ?? null,
    duration_minutes: toIntOrNull(body.duration_minutes),
    contact_id: body.contact_id == null ? null : Number(body.contact_id),
    outcome_note: body.outcome_note ?? null,
  });
  res.status(201).json(db.prepare('SELECT * FROM interviews WHERE id = ?').get(info.lastInsertRowid));
});

app.post('/api/claims/:id/questions', (req, res) => {
  const claimId = Number(req.params.id);
  const body = req.body || {};
  const claim = db.prepare(`
    SELECT c.id, l.company_id FROM claims c LEFT JOIN listings l ON l.id = c.listing_id WHERE c.id = ?
  `).get(claimId);
  if (!claim) return res.status(404).json({ error: 'claim not found' });
  if (!String(body.question || '').trim()) return res.status(400).json({ error: 'question is required' });
  if (body.interview_id != null) {
    const interview = db.prepare('SELECT id FROM interviews WHERE id = ? AND claim_id = ?').get(Number(body.interview_id), claimId);
    if (!interview) return res.status(400).json({ error: 'interview_id must be an interview on this claim' });
  }
  const info = db.prepare(`
    INSERT INTO interview_questions (claim_id, company_id, interview_id, question, category, asked_by, answer_note)
    VALUES (@claim_id, @company_id, @interview_id, @question, @category, @asked_by, @answer_note)
  `).run({
    claim_id: claimId,
    // The company is derived from the claim rather than accepted from the client: the question bank
    // is only useful if a question is filed under the company that actually asked it.
    company_id: claim.company_id ?? null,
    interview_id: body.interview_id == null ? null : Number(body.interview_id),
    question: String(body.question).trim(),
    category: body.category ?? null,
    asked_by: body.asked_by ?? null,
    answer_note: body.answer_note ?? null,
  });
  res.status(201).json(db.prepare('SELECT * FROM interview_questions WHERE id = ?').get(info.lastInsertRowid));
});

app.post('/api/companies/:id/artifacts', (req, res) => {
  const companyId = Number(req.params.id);
  const body = req.body || {};
  if (!db.prepare('SELECT id FROM companies WHERE id = ?').get(companyId)) {
    return res.status(404).json({ error: 'company not found' });
  }
  if (!ARTIFACT_KINDS.includes(body.kind)) {
    return res.status(400).json({ error: `kind must be one of: ${ARTIFACT_KINDS.join(', ')}` });
  }
  if (!String(body.title || '').trim()) return res.status(400).json({ error: 'title is required' });
  const info = db.prepare(`
    INSERT INTO company_process_artifacts (company_id, kind, title, body, reference_path, source_claim_id)
    VALUES (@company_id, @kind, @title, @body, @reference_path, @source_claim_id)
  `).run({
    company_id: companyId,
    kind: body.kind,
    title: String(body.title).trim(),
    body: body.body ?? null,
    reference_path: body.reference_path ?? null,
    source_claim_id: body.source_claim_id == null ? null : Number(body.source_claim_id),
  });
  res.status(201).json(db.prepare('SELECT * FROM company_process_artifacts WHERE id = ?').get(info.lastInsertRowid));
});

// §6.1 Strike Sheet: the offer comparator. Read-only; offers are written by the POST below.
app.get('/api/strike-sheet', (req, res) => {
  res.json(computeStrikeSheet(db));
});

app.get('/strike-sheet', (req, res) => {
  res.type('html').send(renderStrikeSheetHtml(computeStrikeSheet(db)));
});

// §6.1 record an offer generation. Append-only: there is deliberately no PATCH or DELETE for an
// offer -- a renegotiated number is a NEW generation, and overwriting the previous one would
// destroy the only evidence of what the negotiation moved.
app.post('/api/claims/:id/offers', (req, res) => {
  const claimId = Number(req.params.id);
  const body = req.body || {};
  const claim = db.prepare('SELECT id FROM claims WHERE id = ?').get(claimId);
  if (!claim) return res.status(404).json({ error: 'claim not found' });

  const source = body.source ?? 'employer';
  if (!OFFER_SOURCES.includes(source)) {
    return res.status(400).json({ error: `source must be one of: ${OFFER_SOURCES.join(', ')}` });
  }
  if (body.currency != null && !isValidCurrency(body.currency)) {
    return res.status(400).json({ error: 'currency must be a 3-letter ISO code' });
  }

  const components = {};
  for (const key of ['base_annual', 'bonus_annual', 'equity_annual', 'other_annual']) {
    const value = toRealOrNull(body[key]);
    if (body[key] != null && body[key] !== '' && value == null) {
      return res.status(400).json({ error: `${key} must be a number` });
    }
    if (value != null && value < 0) return res.status(400).json({ error: `${key} must not be negative` });
    components[key] = value;
  }
  // An offer with no figure at all is not an offer. Rejecting it here keeps the Strike Sheet
  // from showing a row that says nothing.
  if (Object.values(components).every((value) => value == null)) {
    return res.status(400).json({ error: 'at least one of base_annual, bonus_annual, equity_annual, other_annual is required' });
  }

  const info = db.prepare(`
    INSERT INTO claim_offers (claim_id, source, base_annual, bonus_annual, equity_annual, other_annual, currency, note)
    VALUES (@claim_id, @source, @base_annual, @bonus_annual, @equity_annual, @other_annual, @currency, @note)
  `).run({
    claim_id: claimId,
    source,
    ...components,
    currency: body.currency ?? null,
    note: body.note ?? null,
  });
  res.status(201).json(db.prepare('SELECT * FROM claim_offers WHERE id = ?').get(info.lastInsertRowid));
});

// §6.3 data pledge. Server-rendered and JS-free like /report and /claim-office.
app.get('/pledge', (req, res) => {
  res.type('html').send(renderPledgeHtml(computePledge(db)));
});

app.get('/api/claim-office', (req, res) => {
  res.json(getClaimOffice(db));
});

app.get('/claim-office', (req, res) => {
  res.send(renderClaimOfficeHtml(getClaimOffice(db)));
});

function requireScout(res) {
  if (HAS_SCOUT) return true;
  res.status(503).json({ error: 'Scout requires database migration 014' });
  return false;
}

app.get('/api/scout', (req, res) => {
  if (!requireScout(res)) return;
  const status = String(req.query.status || 'review');
  if (!['review', 'all', 'new', 'shortlisted', 'dismissed', 'captured', 'top', 'anomalies'].includes(status)) {
    return res.status(400).json({ error: 'invalid Scout status filter' });
  }
  res.json(getScout(db, { status }));
});

app.post('/api/scout/profile', (req, res) => {
  if (!requireScout(res)) return;
  const result = saveProfile(db, req.body?.label, req.body?.profile);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.status(201).json(result.profile);
});

app.post('/api/scout/discoveries/import', (req, res) => {
  if (!requireScout(res)) return;
  try {
    const result = importDiscoveries(db, req.body);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof TypeError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

app.patch('/api/scout/discoveries/:id', (req, res) => {
  if (!requireScout(res)) return;
  const result = setDiscoveryStatus(db, Number(req.params.id), req.body?.status);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json(result.discovery);
});

app.post('/api/scout/discoveries/:id/stake', (req, res) => {
  if (!requireScout(res)) return;
  const result = stakeDiscovery(db, Number(req.params.id));
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  res.status(result.status).json({
    ok: true,
    claim_id: result.claimId,
    created: result.created,
    navigate: `/?claim=${result.claimId}`
  });
});

app.get('/api/push/vapid-public-key', (req, res) => {
  const config = loadVapidConfig();
  if (!config.enabled) return res.json({ enabled: false });
  res.json({ enabled: true, publicKey: config.publicKey });
});

app.post('/api/push/subscribe', (req, res) => {
  const { endpoint, p256dh, auth, keys } = req.body || {};
  const keyP256 = p256dh || keys?.p256dh;
  const keyAuth = auth || keys?.auth;
  const result = upsertSubscription(db, {
    endpoint,
    p256dh: keyP256,
    auth: keyAuth,
    userAgent: req.headers['user-agent'],
  });
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {};
  deactivateSubscription(db, endpoint);
  res.json({ ok: true });
});

app.post('/api/push/test', async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint || typeof endpoint !== 'string') {
    return res.status(400).json({ ok: false, error: 'endpoint string required' });
  }
  const sub = db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ? AND active = 1').get(endpoint);
  if (!sub) {
    return res.status(404).json({ ok: false, error: 'No active subscription found for endpoint' });
  }
  const testPayload = {
    web_push: 8030,
    notification: {
      title: 'Scout Push Test',
      body: 'Web Push notifications are working on this device.',
      navigate: '/scout',
      tag: 'scout-test',
      app_badge: 1,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    },
  };
  const sendRes = await sendPushNotification(db, sub, testPayload, { eventKey: 'scout-test' });
  if (!sendRes.ok) {
    return res.status(500).json({ ok: false, error: sendRes.error || 'Push delivery failed' });
  }
  res.json({ ok: true });
});

app.get('/api/push/status', (req, res) => {
  const endpoint = String(req.query.endpoint || '');
  res.json(getSubscriptionStatus(db, endpoint));
});

app.put('/api/push/preferences', (req, res) => {
  const { endpoint, ...preferences } = req.body || {};
  const result = updateSubscriptionPreferences(db, endpoint, preferences);
  if (!result.ok) return res.status(result.status || 400).json({ ok: false, error: result.error });
  res.json(result);
});

app.get('/scout', (req, res) => {
  if (!HAS_SCOUT) {
    return res.status(503).send('Scout requires database migration 014.');
  }
  const status = String(req.query.status || 'review');
  const validStatus = ['review', 'all', 'new', 'shortlisted', 'dismissed', 'captured', 'top'].includes(status) ? status : 'review';
  res.send(renderScoutHtml(getScout(db, { status: validStatus }), { status: validStatus }));
});

app.get('/api/diggings', (req, res) => {
  const data = getDailyDiggings(db);
  res.json(data);
});

app.get('/diggings', (req, res) => {
  const data = getDailyDiggings(db);
  res.send(renderDailyDiggingsHtml(data));
});

const distDir = path.join(__dirname, '../app/dist');
const brandLockupPath = path.join(__dirname, '../design-system/assets/prospect-lockup.svg');
const brandCompactMarkPath = path.join(__dirname, '../design-system/assets/prospect-mark-compact.svg');
app.get('/brand/prospect-lockup.svg', (req, res) => res.sendFile(brandLockupPath));
app.get('/brand/prospect-mark-compact.svg', (req, res) => res.sendFile(brandCompactMarkPath));
app.use(express.static(distDir));
app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`prospect-server listening on :${PORT}`);
});
