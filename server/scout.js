import { renderPwaHeadTags } from './pwaHead.js';
import { recordPrediction } from './calibration.js';
import { renderSidebarNav, renderTopBar, renderTabBar, SHELL_STYLE } from './shell.js';
import { canonicalCompanyName, descHash } from './validate.js';
import { classifyJobFamily } from './jobFamily.js';
import crypto from 'node:crypto';

const STATUSES = new Set(['new', 'shortlisted', 'dismissed']);

function text(value) {
  return value == null ? '' : String(value).trim();
}

function lower(value) {
  return text(value).toLocaleLowerCase('en-US');
}

function list(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function includesPhrase(haystack, phrase) {
  return phrase && haystack.includes(lower(phrase));
}

export function validateProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'profile must be a JSON object' };
  }
  const profile = {
    target_titles: list(input.target_titles),
    preferred_locations: list(input.preferred_locations),
    credentials: list(input.credentials),
    skills: list(input.skills),
    experience_terms: list(input.experience_terms),
    avoid_titles: list(input.avoid_titles),
  };
  if (profile.target_titles.length === 0) {
    return { ok: false, error: 'profile.target_titles must contain at least one title' };
  }
  return { ok: true, profile };
}

export function scoreJob(job, profile) {
  const role = lower(job.role);
  const location = lower(job.location);
  const corpus = lower([job.role, job.description].filter(Boolean).join('\n'));
  let score = 35;
  const reasons = [];
  const cautions = [];

  const targetMatches = list(profile?.target_titles).filter((term) => includesPhrase(role, term));
  if (targetMatches.length) {
    score += 30;
    reasons.push(`Target-title match: ${targetMatches.slice(0, 2).join(', ')}`);
  } else {
    cautions.push('Title is outside the configured target list');
  }

  const skillMatches = list(profile?.skills).filter((term) => includesPhrase(corpus, term));
  if (skillMatches.length) {
    score += Math.min(25, skillMatches.length * 5);
    reasons.push(`Skill overlap: ${skillMatches.slice(0, 5).join(', ')}`);
  }

  const experienceMatches = list(profile?.experience_terms).filter((term) => includesPhrase(corpus, term));
  if (experienceMatches.length) {
    score += Math.min(15, experienceMatches.length * 5);
    reasons.push(`Experience overlap: ${experienceMatches.slice(0, 3).join(', ')}`);
  }

  const credentialWords = list(profile?.credentials)
    .flatMap((credential) => lower(credential).split(/[^a-z0-9+#.]+/))
    .filter((word) => word.length >= 3 && !['completed', '2026'].includes(word));
  const credentialMatches = [...new Set(credentialWords.filter((word) => corpus.includes(word)))];
  if (credentialMatches.length) {
    score += Math.min(10, credentialMatches.length * 3);
    reasons.push(`Credential relevance: ${credentialMatches.slice(0, 3).join(', ')}`);
  }

  const locationMatches = list(profile?.preferred_locations).filter((term) => includesPhrase(location, term));
  if (locationMatches.length) {
    score += 10;
    reasons.push(`Preferred location: ${locationMatches[0]}`);
  } else if (location) {
    cautions.push('Location is outside the configured preference');
  }

  const avoidMatches = list(profile?.avoid_titles).filter((term) => includesPhrase(role, term));
  if (avoidMatches.length) {
    score -= 45;
    cautions.push(`Seniority/title caution: ${avoidMatches.join(', ')}`);
  }

  score = Math.max(0, Math.min(100, score));
  const label = score >= 75 ? 'strong' : score >= 55 ? 'possible' : 'stretch';
  return {
    score,
    label,
    reasons,
    cautions,
    note: 'Deterministic lead score for review; verify the full posting before applying.',
  };
}

export function canonicalUrl(value) {
  const raw = text(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('trk') || key.startsWith('tracking') || key.startsWith('utm_')) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function sourceKey(job) {
  const external = text(job.external_job_id || job.job_id);
  if (external) return `job:${external}`;
  const url = canonicalUrl(job.source_url || job.url);
  if (url) return `url:${url}`;
  return `fallback:${hash([job.company, job.role, job.location].map(lower).join('\n'))}`;
}

export function saveProfile(db, label, input) {
  const result = validateProfile(input);
  if (!result.ok) return result;
  const profileJson = JSON.stringify(result.profile);
  const profileHash = hash(profileJson);
  const inserted = db.prepare(`
    INSERT INTO scout_profile_versions (label, profile_json, profile_hash)
    VALUES (?, ?, ?)
    ON CONFLICT(profile_hash) DO NOTHING
    RETURNING id, label, profile_json, profile_hash, created_at
  `).get(text(label) || 'Candidate profile', profileJson, profileHash);
  const row = inserted ?? db.prepare(`
    SELECT id, label, profile_json, profile_hash, created_at
    FROM scout_profile_versions WHERE profile_hash=?
  `).get(profileHash);
  return { ok: true, profile: { ...row, profile: JSON.parse(row.profile_json) } };
}

export function latestProfile(db) {
  const row = db.prepare(`
    SELECT id, label, profile_json, profile_hash, created_at
    FROM scout_profile_versions ORDER BY id DESC LIMIT 1
  `).get();
  return row ? { ...row, profile: JSON.parse(row.profile_json) } : null;
}

export function importDiscoveries(db, payload) {
  const source = text(payload?.source) || 'linkedin-alert';
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  if (jobs.length === 0) return { ok: false, error: 'jobs must contain at least one job' };
  if (jobs.length > 200) return { ok: false, error: 'at most 200 jobs may be imported at once' };
  const profileVersion = latestProfile(db);
  if (!profileVersion) return { ok: false, error: 'create a Scout candidate profile before importing jobs' };

  return db.transaction(() => {
    const imported = [];
    for (const job of jobs) {
      if (!job || typeof job !== 'object' || !text(job.role) || !text(job.source_url || job.url)) {
        throw new TypeError('each job requires role and source_url');
      }
      const key = sourceKey(job);
      const rawPayload = typeof job.raw_payload === 'string'
        ? job.raw_payload
        : JSON.stringify(job.raw_payload ?? job);
      const snapshotHash = hash(`${source}\n${key}\n${rawPayload}`);
      const assessment = scoreJob(job, profileVersion.profile);
      const info = db.prepare(`
        INSERT INTO scout_discoveries (
          source, source_key, external_job_id, source_url, apply_url, company, role, location,
          description, posted_at, profile_version_id, fit_score, fit_label, assessment_json
        ) VALUES (
          @source, @source_key, @external_job_id, @source_url, @apply_url, @company, @role,
          @location, @description, @posted_at, @profile_version_id, @fit_score, @fit_label,
          @assessment_json
        )
        ON CONFLICT(source, source_key) DO NOTHING
        RETURNING id
      `).get({
        source,
        source_key: key,
        external_job_id: text(job.external_job_id || job.job_id) || null,
        source_url: canonicalUrl(job.source_url || job.url),
        apply_url: canonicalUrl(job.apply_url) || null,
        company: text(job.company) || null,
        role: text(job.role),
        location: text(job.location) || null,
        description: text(job.description) || null,
        posted_at: text(job.posted_at) || null,
        profile_version_id: profileVersion.id,
        fit_score: assessment.score,
        fit_label: assessment.label,
        assessment_json: JSON.stringify(assessment),
      });
      const discoveryId = info?.id ?? db.prepare(
        'SELECT id FROM scout_discoveries WHERE source = ? AND source_key = ?'
      ).get(source, key).id;
      if (!info) {
        db.prepare("UPDATE scout_discoveries SET last_seen_at=datetime('now') WHERE id=?").run(discoveryId);
      }
      const sighting = db.prepare(`
        INSERT INTO scout_sightings (discovery_id, message_id, raw_payload, snapshot_hash)
        VALUES (?, ?, ?, ?) ON CONFLICT(snapshot_hash) DO NOTHING
      `).run(discoveryId, text(payload.message_id) || null, rawPayload, snapshotHash);
      imported.push({
        discovery_id: discoveryId,
        created: !!info,
        new_sighting: sighting.changes === 1,
        fit_score: assessment.score,
        fit_label: assessment.label,
      });
    }
    return { ok: true, imported };
  })();
}

export function computeTriage(discovery, options = {}) {
  const now = options.now ? new Date(options.now).getTime() : Date.now();
  const baseFit = Math.max(0, Math.min(100, Number(discovery?.fit_score) || 0));

  const factors = [
    { label: 'Base fit score', delta: baseFit }
  ];

  let shortlistedDelta = 0;
  if (discovery?.status === 'shortlisted') {
    shortlistedDelta = 20;
    factors.push({ label: 'Shortlisted boost', delta: shortlistedDelta });
  }

  let sightingDelta = 0;
  const sightingCount = Number(discovery?.sighting_count) || 1;
  if (sightingCount > 1) {
    sightingDelta = Math.min(15, (sightingCount - 1) * 5);
    factors.push({ label: `Re-sighting signal (${sightingCount}x)`, delta: sightingDelta });
  }

  let freshnessDelta = 0;
  let freshnessLabel = '';
  const seenTime = new Date(discovery?.last_seen_at || discovery?.first_seen_at || Date.now()).getTime();
  const hoursAgo = isNaN(seenTime) ? 999 : Math.max(0, (now - seenTime) / (1000 * 60 * 60));

  if (hoursAgo <= 24) {
    freshnessDelta = 15;
    freshnessLabel = 'Freshness (<24h)';
  } else if (hoursAgo <= 48) {
    freshnessDelta = 10;
    freshnessLabel = 'Freshness (<48h)';
  } else if (hoursAgo <= 168) {
    freshnessDelta = 5;
    freshnessLabel = 'Freshness (<7d)';
  }

  if (freshnessDelta > 0) {
    factors.push({ label: freshnessLabel, delta: freshnessDelta });
  }

  const rawScore = baseFit + shortlistedDelta + sightingDelta + freshnessDelta;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  let tier = 'low';
  if (score >= 80) {
    tier = 'top';
  } else if (score >= 55) {
    tier = 'review';
  }

  return {
    score,
    tier,
    factors
  };
}

const HTML_ENTITY_RE = /&(?:[a-z][a-z0-9]+|#\d+|#x[\da-f]+);/i;
const GENERIC_ROLE_RE = /^(?:job|jobs|job alert|new job|view job|view details?|see details?|apply)$/i;

// Import anomalies are read-time observations over the fields Scout actually received. They do
// not rewrite a discovery, lower its fit score, or pretend a missing field was present. This keeps
// parser drift visible while preserving immutable sightings as the repair source.
export function detectImportAnomalies(discovery) {
  const company = text(discovery?.company);
  const role = text(discovery?.role);
  const location = text(discovery?.location);
  const sourceKeyValue = text(discovery?.source_key);
  const fields = [
    ['company', company],
    ['role', role],
    ['location', location],
  ];
  const anomalies = [];

  if (!company) {
    anomalies.push({ code: 'missing_company', severity: 'warning', label: 'Company missing' });
  }
  if (!location) {
    anomalies.push({ code: 'missing_location', severity: 'warning', label: 'Location missing' });
  }
  if (GENERIC_ROLE_RE.test(role)) {
    anomalies.push({ code: 'generic_role', severity: 'error', label: 'Role looks like interface copy' });
  }

  const entityFields = fields.filter(([, value]) => HTML_ENTITY_RE.test(value)).map(([name]) => name);
  if (entityFields.length) {
    anomalies.push({
      code: 'html_entity',
      severity: 'error',
      label: `Encoded HTML remains in ${entityFields.join(', ')}`,
    });
  }

  if (!location && /\s[·•]\s/.test(company)) {
    anomalies.push({
      code: 'fused_company_location',
      severity: 'error',
      label: 'Company and location may be fused',
    });
  }

  const comparable = fields.filter(([, value]) => value).map(([name, value]) => [name, lower(value)]);
  const repeated = [];
  for (let i = 0; i < comparable.length; i += 1) {
    for (let j = i + 1; j < comparable.length; j += 1) {
      if (comparable[i][1] === comparable[j][1]) repeated.push(`${comparable[i][0]}/${comparable[j][0]}`);
    }
  }
  if (repeated.length) {
    anomalies.push({
      code: 'duplicate_fields',
      severity: 'error',
      label: `Imported fields repeat: ${repeated.join(', ')}`,
    });
  }

  if (!text(discovery?.external_job_id) && sourceKeyValue.startsWith('fallback:')) {
    anomalies.push({
      code: 'weak_identity',
      severity: 'warning',
      label: 'Discovery identity uses field fallback',
    });
  }

  return anomalies;
}

export function getScout(db, { status = 'review' } = {}) {
  const isReview = status === 'review';
  const isTop = status === 'top';
  const isAnomalies = status === 'anomalies';
  const isAll = status === 'all';

  let where = 'WHERE d.status = @status';
  if (isReview || isTop || isAnomalies) {
    where = "WHERE d.status IN ('new','shortlisted')";
  } else if (isAll) {
    where = '';
  }

  const hasClaims = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='claims'").get()?.n > 0;
  const statement = hasClaims
    ? db.prepare(`
        SELECT d.*,
          (SELECT COUNT(*) FROM scout_sightings s WHERE s.discovery_id=d.id) AS sighting_count,
          c.id AS claim_id,
          l.id AS listing_id,
          l.source AS listing_source,
          l.role AS listing_role,
          l.company AS listing_company,
          l.location AS listing_location,
          l.comp AS listing_comp,
          l.description AS listing_description,
          l.posted_at AS listing_posted_at,
          l.employment_type AS listing_employment_type,
          l.workplace_type AS listing_workplace_type,
          l.seniority AS listing_seniority,
          l.salary_min AS listing_salary_min,
          l.salary_max AS listing_salary_max,
          l.salary_period AS listing_salary_period,
          l.salary_currency AS listing_salary_currency,
          l.applicant_count AS listing_applicant_count,
          l.applicants_last_day AS listing_applicants_last_day,
          l.apply_url AS listing_apply_url,
          l.source_url AS listing_source_url,
          l.verified AS listing_verified,
          l.parsed AS listing_parsed,
          (SELECT advisory FROM listing_advisories la WHERE la.listing_id=l.id ORDER BY la.generated_at DESC LIMIT 1) AS listing_advisory
        FROM scout_discoveries d
        LEFT JOIN claims c ON d.linked_claim_id = c.id
        LEFT JOIN listings l ON c.listing_id = l.id
        ${where}
      `)
    : db.prepare(`
        SELECT d.*,
          (SELECT COUNT(*) FROM scout_sightings s WHERE s.discovery_id=d.id) AS sighting_count
        FROM scout_discoveries d
        ${where}
      `);

  const rawRows = (isReview || isTop || isAnomalies || isAll)
    ? statement.all()
    : statement.all({ status });

  const profile = latestProfile(db);

  let processed = rawRows.map((row) => {
    const triage = computeTriage(row);
    let assessment = null;
    try {
      assessment = JSON.parse(row.assessment_json);
    } catch {
      assessment = { score: row.fit_score, label: row.fit_label, reasons: [], cautions: [] };
    }

    let verified_assessment = null;
    let verified = null;
    let provisional_claim_id = null;

    if (row.claim_id && row.listing_id) {
      let isBrowserCaptured = false;
      if (row.listing_verified === 1 || (row.listing_source && row.listing_source !== 'linkedin-alert')) {
        isBrowserCaptured = true;
      } else if (row.listing_parsed) {
        try {
          const parsedObj = typeof row.listing_parsed === 'string' ? JSON.parse(row.listing_parsed) : row.listing_parsed;
          if (parsedObj?.verification_status === 'browser-captured') {
            isBrowserCaptured = true;
          }
        } catch {}
      }

      if (isBrowserCaptured) {
        try {
          const verifiedRole = text(row.listing_role) || text(row.role);
          const verifiedLoc = text(row.listing_location) || text(row.location);
          const verifiedDesc = text(row.listing_description) || text(row.description);
          verified_assessment = scoreJob({
            role: verifiedRole,
            location: verifiedLoc,
            description: verifiedDesc,
          }, profile ? profile.profile : null);

          let advisory = null;
          if (row.listing_advisory) {
            try {
              advisory = typeof row.listing_advisory === 'string'
                ? JSON.parse(row.listing_advisory)
                : row.listing_advisory;
            } catch {
              advisory = null;
            }
          }

          verified = {
            claim_id: row.claim_id,
            listing_id: row.listing_id,
            role: row.listing_role,
            company: row.listing_company,
            location: row.listing_location,
            comp: row.listing_comp,
            description: row.listing_description,
            posted_at: row.listing_posted_at,
            employment_type: row.listing_employment_type,
            workplace_type: row.listing_workplace_type,
            seniority: row.listing_seniority,
            salary_min: row.listing_salary_min,
            salary_max: row.listing_salary_max,
            salary_period: row.listing_salary_period,
            salary_currency: row.listing_salary_currency,
            applicant_count: row.listing_applicant_count,
            applicants_last_day: row.listing_applicants_last_day,
            apply_url: row.listing_apply_url,
            source_url: row.listing_source_url,
            advisory,
            assessment: verified_assessment,
          };
        } catch {
          verified_assessment = null;
          verified = null;
        }
      } else {
        provisional_claim_id = row.claim_id;
      }
    }

    return {
      ...row,
      triage,
      import_anomalies: detectImportAnomalies(row),
      assessment,
      verified_assessment,
      verified,
      provisional_claim_id,
    };
  });

  if (isTop) {
    processed = processed.filter((d) => d.triage.tier === 'top');
  } else if (isAnomalies) {
    processed = processed.filter((d) => d.import_anomalies.length > 0);
  }

  processed.sort((a, b) => {
    if (b.triage.score !== a.triage.score) return b.triage.score - a.triage.score;
    if (b.fit_score !== a.fit_score) return b.fit_score - a.fit_score;
    const aDate = new Date(a.first_seen_at || 0).getTime();
    const bDate = new Date(b.first_seen_at || 0).getTime();
    if (bDate !== aDate) return bDate - aDate;
    return b.id - a.id;
  });

  const rawCounts = db.prepare(`
    SELECT status, COUNT(*) AS count FROM scout_discoveries GROUP BY status
  `).all();
  const countMap = Object.fromEntries(rawCounts.map((row) => [row.status, row.count]));

  const allActiveDiscoveries = db.prepare(`
    SELECT d.*,
      (SELECT COUNT(*) FROM scout_sightings s WHERE s.discovery_id=d.id) AS sighting_count
    FROM scout_discoveries d
    WHERE d.status IN ('new','shortlisted')
  `).all().map((r) => ({
    ...r,
    triage: computeTriage(r),
    import_anomalies: detectImportAnomalies(r),
  }));

  const topCount = allActiveDiscoveries.filter((d) => d.triage.tier === 'top').length;
  const strongCount = allActiveDiscoveries.filter((d) => d.fit_label === 'strong').length;
  const possibleCount = allActiveDiscoveries.filter((d) => d.fit_label === 'possible').length;
  const stretchCount = allActiveDiscoveries.filter((d) => d.fit_label === 'stretch').length;
  const anomalyCount = allActiveDiscoveries.filter((d) => d.import_anomalies.length > 0).length;
  const totalAll = db.prepare("SELECT COUNT(*) AS c FROM scout_discoveries").get()?.c || 0;

  const counts = {
    new: countMap.new || 0,
    shortlisted: countMap.shortlisted || 0,
    captured: countMap.captured || 0,
    dismissed: countMap.dismissed || 0,
    top: topCount,
    strong: strongCount,
    possible: possibleCount,
    stretch: stretchCount,
    anomalies: anomalyCount,
    review: (countMap.new || 0) + (countMap.shortlisted || 0),
    all: totalAll,
  };

  const hasGmailReceipts = db.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='scout_gmail_messages'"
  ).get()?.n > 0;
  const lastAccepted = hasGmailReceipts
    ? db.prepare("SELECT MAX(received_at) AS at FROM scout_gmail_messages WHERE status='imported'").get()?.at || null
    : null;
  const lastAcceptedMs = lastAccepted ? Date.parse(lastAccepted) : NaN;
  const daysStale = Number.isFinite(lastAcceptedMs)
    ? Math.max(0, Math.round(((Date.now() - lastAcceptedMs) / 86400000) * 10) / 10)
    : null;

  return {
    profile,
    ingestion: {
      last_accepted_at: lastAccepted,
      days_stale: daysStale,
      stale: daysStale != null ? daysStale >= 3 : null,
      cadence: 'About every 2 hours · :35 America/Chicago, plus up to 10 minutes jitter',
    },
    counts,
    discoveries: processed,
  };
}

export function setDiscoveryStatus(db, id, status) {
  if (!STATUSES.has(status)) return { ok: false, status: 400, error: 'invalid Scout status' };
  const info = db.prepare('UPDATE scout_discoveries SET status=? WHERE id=?').run(status, id);
  if (!info.changes) return { ok: false, status: 404, error: 'discovery not found' };
  return { ok: true, discovery: db.prepare('SELECT * FROM scout_discoveries WHERE id=?').get(id) };
}

export function linkCapturedDiscovery(db, { claimId, externalJobId, sourceUrl }) {
  const external = text(externalJobId);
  const url = canonicalUrl(sourceUrl);
  if (!external && !url) return 0;
  let changes = 0;
  if (external) {
    const info = db.prepare(`
      UPDATE scout_discoveries SET status='captured', linked_claim_id=?
      WHERE external_job_id=? AND linked_claim_id IS NULL
    `).run(claimId, external);
    changes = info.changes;
  }
  if (changes === 0 && url) {
    const info = db.prepare(`
      UPDATE scout_discoveries SET status='captured', linked_claim_id=?
      WHERE source_url=? AND linked_claim_id IS NULL
    `).run(claimId, url);
    changes = info.changes;
  }
  return changes;
}

export function stakeDiscovery(db, discoveryId) {
  const dId = Number(discoveryId);
  if (!dId || isNaN(dId)) return { ok: false, status: 400, error: 'invalid discovery id' };
  const hasClaims = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='claims'").get()?.n > 0;
  if (!hasClaims) return { ok: false, status: 503, error: 'claims table not present' };

  return db.transaction(() => {
    const discovery = db.prepare('SELECT * FROM scout_discoveries WHERE id=?').get(dId);
    if (!discovery) return { ok: false, status: 404, error: 'discovery not found' };

    if (discovery.linked_claim_id) {
      return { ok: true, status: 200, claimId: discovery.linked_claim_id, created: false };
    }

    let existingClaim = null;
    if (discovery.external_job_id) {
      existingClaim = db.prepare(`
        SELECT c.id FROM claims c
        JOIN listings l ON c.listing_id = l.id
        WHERE l.external_job_id = ?
        ORDER BY c.id ASC LIMIT 1
      `).get(discovery.external_job_id);
    }
    if (!existingClaim && discovery.source_url) {
      const cUrl = canonicalUrl(discovery.source_url);
      if (cUrl) {
        existingClaim = db.prepare(`
          SELECT c.id FROM claims c
          JOIN listings l ON c.listing_id = l.id
          WHERE l.source_url = ?
          ORDER BY c.id ASC LIMIT 1
        `).get(cUrl);
      }
    }

    if (existingClaim) {
      db.prepare("UPDATE scout_discoveries SET status='captured', linked_claim_id=? WHERE id=?").run(existingClaim.id, dId);
      return { ok: true, status: 200, claimId: existingClaim.id, created: false };
    }

    const sighting = db.prepare(`
      SELECT raw_payload FROM scout_sightings
      WHERE discovery_id=? ORDER BY id DESC LIMIT 1
    `).get(dId);
    const rawPayload = sighting?.raw_payload ?? null;
    const sUrl = canonicalUrl(discovery.source_url);
    const source = 'linkedin-alert';
    const descriptionHash = descHash(discovery.description);
    const snapHash = hash(`${source}\n${sUrl}\n${rawPayload || ''}`);

    let companyId = null;
    if (discovery.company && text(discovery.company)) {
      const canon = canonicalCompanyName(discovery.company);
      const companyRow = db.prepare(`
        INSERT INTO companies (name, canonical_name) VALUES (@name, @canon)
        ON CONFLICT(canonical_name) DO UPDATE SET name=excluded.name
        RETURNING id
      `).get({ name: discovery.company, canon });
      companyId = companyRow?.id ?? null;
    }

    const hasJobFamily = db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('listings') WHERE name='job_family'").get()?.n > 0;
    const jobFamily = classifyJobFamily(discovery.role);
    const parsedObj = {
      capture_source: 'scout-email',
      verification_status: 'pending-browser-capture',
      discovery_id: dId
    };

    const listingInfo = db.prepare(`
      INSERT INTO listings (
        source, source_url, raw_payload, company, role, location, description, posted_at,
        snapshot_hash, external_job_id, apply_url, company_id, verified,
        snapshot_generation, desc_hash, parsed${hasJobFamily ? ', job_family' : ''}
      ) VALUES (
        @source, @source_url, @raw_payload, @company, @role, @location, @description, @posted_at,
        @snapshot_hash, @external_job_id, @apply_url, @company_id, 0,
        1, @desc_hash, @parsed${hasJobFamily ? ', @job_family' : ''}
      )
    `).run({
      source,
      source_url: sUrl,
      raw_payload: rawPayload,
      company: discovery.company ?? null,
      role: discovery.role,
      location: discovery.location ?? null,
      description: discovery.description ?? null,
      posted_at: discovery.posted_at ?? null,
      snapshot_hash: snapHash,
      external_job_id: discovery.external_job_id ?? null,
      apply_url: discovery.apply_url ?? null,
      company_id: companyId,
      desc_hash: descriptionHash,
      parsed: JSON.stringify(parsedObj),
      ...(hasJobFamily ? { job_family: jobFamily } : {})
    });
    const listingId = listingInfo.lastInsertRowid;

    const claimInfo = db.prepare(`
      INSERT INTO claims (listing_id, stage_entered_at) VALUES (?, datetime('now'))
    `).run(listingId);
    const claimId = claimInfo.lastInsertRowid;

    db.prepare(`
      INSERT INTO stage_transitions (claim_id, from_stage, to_stage, note, transition_cause)
      VALUES (?, NULL, 'Showings', 'staked', 'stake')
    `).run(claimId);

    db.prepare("UPDATE scout_discoveries SET status='captured', linked_claim_id=? WHERE id=?").run(claimId, dId);

    // §5.4: Scout's fit score is a forecast, so it is logged append-only at the moment of staking.
    // scout_discoveries.fit_score can be recomputed by a later profile version, and a recomputed
    // score is not what was believed on the day the application actually went out.
    recordPrediction(db, claimId, {
      predictor: 'scout_fit',
      value: Number(discovery.fit_score) / 100,
      valueRaw: Number(discovery.fit_score),
      note: 'Scout fit score at stake time',
    });

    return { ok: true, status: 201, claimId, created: true };
  })();
}

function esc(value) {
  return text(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function humanizeFact(val) {
  if (!val) return '';
  const s = String(val).replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function discoveryCard(row, index) {
  const isEnriched = Boolean(row.verified && row.verified_assessment);
  const isProvisional = Boolean(!isEnriched && row.provisional_claim_id);
  const vAssessment = isEnriched ? row.verified_assessment : row.assessment;

  const reasons = vAssessment.reasons.length
    ? `<ul>${vAssessment.reasons.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`
    : '<p class="muted">No configured match signals were found.</p>';
  const cautions = vAssessment.cautions.length
    ? `<p class="caution">${esc(vAssessment.cautions.join(' · '))}</p>` : '';

  let scoreHtml;
  if (isEnriched) {
    scoreHtml = `
      <div class="score">
        <strong>${vAssessment.score}</strong>
        <span>${esc(vAssessment.label)}</span>
        <small class="score-tag">Verified score</small>
      </div>
      <div class="score score-sub">
        <strong>${row.fit_score}</strong>
        <span>${esc(row.fit_label)}</span>
        <small class="score-tag">Email score</small>
      </div>
    `;
  } else {
    scoreHtml = `
      <div class="score">
        <strong>${row.fit_score}</strong>
        <span>${esc(row.fit_label)}</span>
      </div>
    `;
  }

  let stateBadge = '';
  let claimLink = '';
  let factsHtml = '';
  let cueHtml = '';

  if (isEnriched) {
    stateBadge = '<span class="badge badge-verified">Verified capture</span>';
    claimLink = ` · <a href="/?claim=${row.verified.claim_id}" class="claim-link">Claim #${row.verified.claim_id}</a>`;

    const facts = [];
    if (row.verified.comp) facts.push(row.verified.comp);
    if (row.verified.workplace_type) facts.push(humanizeFact(row.verified.workplace_type));
    if (row.verified.employment_type) facts.push(humanizeFact(row.verified.employment_type));
    if (row.verified.seniority) facts.push(humanizeFact(row.verified.seniority));
    if (row.verified.applicant_count != null) {
      let appText = `${row.verified.applicant_count} applicants`;
      if (row.verified.applicants_last_day != null) {
        appText += ` (${row.verified.applicants_last_day} in last 24h)`;
      }
      facts.push(appText);
    }
    if (facts.length > 0) {
      factsHtml = `<div class="facts">${facts.map((f) => `<span class="pill">${esc(f)}</span>`).join(' ')}</div>`;
    }
  } else if (isProvisional) {
    stateBadge = '<span class="badge badge-staked">Staked from Scout</span>';
    claimLink = ` · <a href="/?claim=${row.provisional_claim_id}" class="claim-link">Claim #${row.provisional_claim_id}</a>`;
    cueHtml = '<p class="muted cue">Browser verification pending — open LinkedIn, then use Prospect Capture to verify/enrich.</p>';
  } else {
    cueHtml = '<p class="muted cue">Open LinkedIn, then use Prospect Capture to verify/enrich.</p>';
  }

  const roleTitle = isEnriched ? (row.verified.role || row.role) : row.role;
  const companyName = isEnriched ? (row.verified.company || row.company) : row.company;
  const locationName = isEnriched ? (row.verified.location || row.location) : row.location;
  const openUrl = isEnriched ? (row.verified.source_url || row.source_url) : row.source_url;

  const triageBreakdown = row.triage ? `
    <div class="triage-breakdown">
      <span class="pill tier-pill tier-${row.triage.tier}">${esc(row.triage.tier.toUpperCase())} TIER (${row.triage.score})</span>
      <span class="triage-factors">${row.triage.factors.map((f) => `${esc(f.label)}: ${f.delta >= 0 ? '+' : ''}${f.delta}`).join(' · ')}</span>
    </div>
  ` : '';
  const anomalyHtml = row.import_anomalies?.length ? `
    <div class="import-anomalies" aria-label="Import checks">
      ${row.import_anomalies.map((item) => `<span class="pill anomaly-${esc(item.severity)}">${esc(item.label)}</span>`).join('')}
    </div>
  ` : '';

  let actionsHtml = '';
  if (isEnriched) {
    actionsHtml = `
      <a href="${esc(openUrl)}" target="_blank" rel="noopener">Open on LinkedIn</a>
      <a href="/?claim=${row.verified.claim_id}" class="claim-link-btn">Claim #${row.verified.claim_id}</a>
    `;
  } else if (isProvisional) {
    actionsHtml = `
      <a href="${esc(openUrl)}" target="_blank" rel="noopener">Open on LinkedIn</a>
      <a href="/?claim=${row.provisional_claim_id}" class="claim-link-btn">Staked (Claim #${row.provisional_claim_id})</a>
    `;
  } else {
    actionsHtml = `
      <a href="${esc(openUrl)}" target="_blank" rel="noopener">Open on LinkedIn</a>
      <button class="stake-btn" data-id="${row.id}">Stake from Scout</button>
      <button data-id="${row.id}" data-status="shortlisted">Shortlist</button>
      <button data-id="${row.id}" data-status="dismissed">Dismiss</button>
    `;
  }

  return `
    <article class="card${index === 0 ? ' lead' : ''}">
      <div class="score-container">${scoreHtml}</div>
      <div class="job">
        ${stateBadge}
        <p class="meta">${esc(companyName || 'Company not provided')} · ${esc(locationName || 'Location not provided')}${claimLink}</p>
        <h2>${esc(roleTitle)}</h2>
        ${triageBreakdown}
        ${anomalyHtml}
        ${factsHtml}
        ${reasons}${cautions}
        <p class="muted">Seen ${row.sighting_count} time${row.sighting_count === 1 ? '' : 's'} · ${esc(row.last_seen_at)}</p>
        ${cueHtml}
        <div class="actions">${actionsHtml}</div>
      </div>
    </article>
  `;
}

export function renderScoutHtml(data, options = {}) {
  const activeStatus = options?.status || 'review';
  const cards = data.discoveries.length
    ? data.discoveries.map(discoveryCard).join('')
    : '<section class="empty"><h2>No leads waiting</h2><p>Daily LinkedIn alerts will land here after the importer runs.</p></section>';
  return `<!doctype html>
<html lang="en"><head>
${renderPwaHeadTags({ title: 'Scout — Prospect' })}
<script src="/scout-push.js" defer></script>
<style>
:root{--bg:#1B2327;--sunken:#10171A;--card:#212B2F;--raised:#283338;--line:#2E383C;--text:#E7E1D3;--strong:#F3EFE6;--muted:#9AA1A4;--verdigris:#4C8C78;--gold:#CDA349;--danger:#A14B33;--slate-850:#161E22;--surface-card:var(--card);--surface-raised:var(--raised);--text-strong:var(--strong);--text-body:var(--text);--text-faint:var(--muted);--font-sans:Inter,system-ui,sans-serif;--font-slab:"Zilla Slab",Georgia,serif;--font-mono:ui-monospace,monospace;font-family:Inter,system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}h1,h2{font-family:"Zilla Slab",Georgia,serif}
.report-main{max-width:980px;width:100%;padding:38px 30px 64px}.eyebrow{color:var(--muted);font:11px ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase}h1{font-size:30px;margin:8px 0 4px;color:var(--strong)}.sub{color:var(--muted);margin:0 0 28px}.summary{display:flex;gap:10px;margin-bottom:22px}.summary-link{flex:0 0 auto;text-decoration:none}.summary .pill{display:inline-flex;align-items:center;min-height:32px;white-space:nowrap;line-height:1}.summary-link.is-active .pill{border-color:var(--verdigris);background:rgba(76,140,120,.1);color:var(--strong)}.pill{border:1px solid var(--line);border-radius:999px;padding:5px 10px;color:var(--muted);font:11px ui-monospace,monospace}
.card{display:grid;grid-template-columns:90px 1fr;gap:18px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:16px}.score-container{display:flex;flex-direction:column;gap:10px;align-items:center}.score-sub{opacity:.85}.score-sub strong{font-size:18px;color:var(--muted)}.score-tag{font:9px ui-monospace,monospace;color:var(--muted);text-transform:uppercase;margin-top:2px;letter-spacing:.04em}.badge-verified{display:inline-block;background:var(--verdigris);color:white;font:10px ui-monospace,monospace;padding:3px 8px;border-radius:5px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;font-weight:600}.claim-link{color:var(--gold);text-decoration:none;font:12px ui-monospace,monospace;font-weight:600}.claim-link:hover{text-decoration:underline}.claim-link-btn{background:var(--raised) !important;color:var(--gold) !important;border-color:var(--line) !important}.facts{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.cue{margin-top:8px;font-style:italic}.card.lead{border-color:var(--gold)}.score{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding-top:4px}.score strong{font:700 26px ui-monospace,monospace;color:var(--strong)}.card.lead .score strong{color:var(--gold)}.score span{font:10px ui-monospace,monospace;text-transform:uppercase;color:var(--muted)}h2{font-size:21px;color:var(--strong);margin:3px 0 10px}.meta,.muted{color:var(--muted);font-size:12px;margin:0}.job ul{padding-left:18px;font-size:13px}.caution{font-size:12px;color:#d9947f}.actions{display:flex;gap:9px;margin-top:14px}.actions a,.actions button{border:1px solid var(--line);background:var(--raised);color:var(--text);border-radius:8px;padding:8px 11px;text-decoration:none;font:12px inherit;cursor:pointer}.actions a{background:var(--verdigris);color:white}.empty{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px}
.daily-brief{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 20px;margin-bottom:20px}
.brief-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.brief-header h2{margin:0;font-size:20px;color:var(--strong)}
.brief-metrics{display:flex;flex-wrap:wrap;gap:8px}
.scout-health{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-bottom:20px}.health-card{background:var(--sunken);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.health-label{font:10px ui-monospace,monospace;color:var(--muted);letter-spacing:.08em;text-transform:uppercase}.health-value{color:var(--strong);font-size:13px;margin-top:4px}.health-value.is-stale{color:#d9947f}
.gold-pill{border-color:var(--gold);color:var(--gold);font-weight:600}
.badge-staked{display:inline-block;background:var(--gold);color:var(--bg);font:10px ui-monospace,monospace;padding:3px 8px;border-radius:5px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;font-weight:700}
.triage-breakdown{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:6px 0 10px}
.triage-factors{font:11px ui-monospace,monospace;color:var(--muted)}
.tier-pill{font-weight:600}.tier-top{border-color:var(--gold);color:var(--gold)}.tier-review{border-color:var(--verdigris);color:var(--verdigris)}
.import-anomalies{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px}.anomaly-warning{border-color:#b89562;color:#d8bd8d}.anomaly-error{border-color:var(--danger);color:#d9947f}
.stake-btn{background:var(--gold) !important;color:var(--bg) !important;font-weight:600 !important;border:none !important}
.push-preferences{display:none;margin:16px 0 4px;padding:16px;border:1px solid var(--line);border-radius:10px;background:var(--sunken)}
.push-pref-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:10px 0;color:var(--text)}
.push-pref-row input[type="checkbox"]{width:20px;height:20px;accent-color:var(--verdigris)}
.quiet-times{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}
.quiet-times input{min-height:42px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);padding:8px;font:14px ui-monospace,monospace}
.push-timezone{font:11px ui-monospace,monospace;color:var(--muted);margin-top:8px}
@media(max-width:720px){.summary{flex-wrap:wrap;gap:8px;margin-bottom:20px}.summary .pill{min-height:36px;padding:7px 12px}.card{grid-template-columns:1fr}.score{align-items:flex-start}.actions{flex-wrap:wrap}}
${SHELL_STYLE}
</style></head><body>
${renderTopBar('/scout')}
<div class="report-shell">
${renderSidebarNav('/scout')}
<main class="report-main"><span class="eyebrow">Prospect</span><h1>Scout</h1>
<p class="sub">Daily LinkedIn leads ranked against ${esc(data.profile?.label || 'your current candidate profile')}. Open a posting, verify it, then use Prospect Capture to add it to the Claim Map.</p>
<section class="daily-brief" aria-label="Scout Daily Brief">
  <div class="brief-header">
    <h2>Daily Brief / Top Picks</h2>
    <span class="pill gold-pill">${data.counts.top || 0} Top Picks</span>
  </div>
  <div class="brief-metrics">
    <span class="pill">${data.counts.strong || 0} Strong</span>
    <span class="pill">${data.counts.possible || 0} Possible</span>
    <span class="pill">${data.counts.stretch || 0} Stretch</span>
    <span class="pill">${data.counts.review || 0} Review Queue</span>
    <span class="pill">${data.counts.anomalies || 0} Import Checks</span>
  </div>
</section>
<section class="scout-health" aria-label="Scout ingestion and targeting status">
  <div class="health-card">
    <div class="health-label">Last accepted alert</div>
    <div class="health-value${data.ingestion?.stale ? ' is-stale' : ''}">${data.ingestion?.last_accepted_at
      ? `${esc(data.ingestion.last_accepted_at)}${data.ingestion.days_stale != null ? ` · ${esc(data.ingestion.days_stale)}d ago` : ''}`
      : 'No accepted alert recorded'}</div>
  </div>
  <div class="health-card">
    <div class="health-label">Next mailbox check</div>
    <div class="health-value">${esc(data.ingestion?.cadence || 'Schedule unavailable')}</div>
  </div>
  <div class="health-card">
    <div class="health-label">Career profile</div>
    <div class="health-value">${esc(data.profile?.label || 'No profile configured')}${data.profile?.profile?.target_titles?.length ? ` · ${data.profile.profile.target_titles.length} target titles` : ''}${data.profile?.profile?.avoid_titles?.length ? ` · ${data.profile.profile.avoid_titles.length} exclusions` : ''}</div>
  </div>
</section>
<nav class="summary" aria-label="Scout lead filters">
<a class="summary-link${activeStatus === 'top' ? ' is-active' : ''}" href="/scout?status=top"${activeStatus === 'top' ? ' aria-current="page"' : ''}><span class="pill">${data.counts.top || 0} Top Picks</span></a>
<a class="summary-link${activeStatus === 'new' ? ' is-active' : ''}" href="/scout?status=new"${activeStatus === 'new' ? ' aria-current="page"' : ''}><span class="pill">${data.counts.new || 0} New</span></a>
<a class="summary-link${activeStatus === 'shortlisted' ? ' is-active' : ''}" href="/scout?status=shortlisted"${activeStatus === 'shortlisted' ? ' aria-current="page"' : ''}><span class="pill">${data.counts.shortlisted || 0} Shortlisted</span></a>
<a class="summary-link${activeStatus === 'captured' ? ' is-active' : ''}" href="/scout?status=captured"${activeStatus === 'captured' ? ' aria-current="page"' : ''}><span class="pill">${data.counts.captured || 0} Captured</span></a>
<a class="summary-link${activeStatus === 'anomalies' ? ' is-active' : ''}" href="/scout?status=anomalies"${activeStatus === 'anomalies' ? ' aria-current="page"' : ''}><span class="pill">${data.counts.anomalies || 0} Import Checks</span></a>
<a class="summary-link${activeStatus === 'review' ? ' is-active' : ''}" href="/scout?status=review"${activeStatus === 'review' ? ' aria-current="page"' : ''}><span class="pill">Review</span></a>
<a class="summary-link${activeStatus === 'all' ? ' is-active' : ''}" href="/scout?status=all"${activeStatus === 'all' ? ' aria-current="page"' : ''}><span class="pill">All</span></a>
</nav>
<section id="scout-push-card" class="card" style="display:none;" aria-label="Notification settings">
  <div style="grid-column:1 / -1;">
    <h2>Web Push Notifications</h2>
    <p class="muted" style="margin:0 0 10px;">Choose what reaches this device. Quiet-hour notifications are deferred, not discarded.</p>
    <div id="scout-push-status" class="muted" aria-live="polite" style="margin-bottom:12px;"></div>
    <div id="push-preferences" class="push-preferences">
      <label class="push-pref-row">
        <span>New Scout leads</span>
        <input type="checkbox" id="push-pref-scout" />
      </label>
      <label class="push-pref-row">
        <span>Today priorities and hard gates</span>
        <input type="checkbox" id="push-pref-today" />
      </label>
      <label class="push-pref-row">
        <span>Use quiet hours</span>
        <input type="checkbox" id="push-pref-quiet" />
      </label>
      <div class="quiet-times">
        <label>From <input type="time" id="push-pref-start" value="22:00" /></label>
        <label>to <input type="time" id="push-pref-end" value="07:00" /></label>
      </div>
      <div class="push-timezone">America/Chicago · queued notifications resume after quiet hours</div>
      <div class="actions">
        <button type="button" id="push-save-preferences">Save preferences</button>
      </div>
    </div>
    <div class="actions">
      <button type="button" id="push-enable-btn">Enable notifications</button>
      <button type="button" id="push-test-btn" style="display:none;">Send test</button>
      <button type="button" id="push-disable-btn" style="display:none;">Disable</button>
    </div>
  </div>
</section>
${cards}</main></div>
${renderTabBar('/scout')}
<script>document.addEventListener('click',async(e)=>{
  const s=e.target.closest('button.stake-btn');
  if(s){
    s.disabled=true;const orig=s.textContent;s.textContent='Staking...';
    try{
      const r=await fetch('/api/scout/discoveries/'+s.dataset.id+'/stake',{method:'POST',headers:{'content-type':'application/json'}});
      const d=await r.json();
      if(r.ok&&(d.claim_id||d.claimId)){
        window.location.href=d.navigate||('/?claim='+(d.claim_id||d.claimId));
      }else{
        alert(d.error||'Failed to stake discovery');s.disabled=false;s.textContent=orig;
      }
    }catch(err){
      alert('Network error');s.disabled=false;s.textContent=orig;
    }
    return;
  }
  const b=e.target.closest('button[data-status]');
  if(!b)return;
  b.disabled=true;
  const r=await fetch('/api/scout/discoveries/'+b.dataset.id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({status:b.dataset.status})});
  if(r.ok)location.reload();else b.disabled=false;
});</script>
</body></html>`;
}
