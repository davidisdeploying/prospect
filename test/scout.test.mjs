import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadVecExtension } from '../server/vecExtension.js';
import {
  saveProfile,
  latestProfile,
  importDiscoveries,
  getScout,
  setDiscoveryStatus,
  renderScoutHtml,
  linkCapturedDiscovery,
  computeTriage,
  detectImportAnomalies,
  stakeDiscovery,
} from '../server/scout.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
const profileDocument = JSON.parse(fs.readFileSync(path.join(root, 'config', 'scout-profile.json'), 'utf8'));

let db;
let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-scout-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  db = new Database(dbPath);
  loadVecExtension(db);
  db.exec(schema);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('saveProfile validates input, computes hash, and stays idempotent across updates', () => {
  const invalid = saveProfile(db, 'Invalid profile', { target_titles: [] });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, 'profile.target_titles must contain at least one title');

  const valid = saveProfile(db, profileDocument.label, profileDocument.profile);
  assert.equal(valid.ok, true);
  assert.equal(valid.profile.label, profileDocument.label);
  assert.ok(valid.profile.profile_hash);

  const duplicate = saveProfile(db, 'Same content profile', profileDocument.profile);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.profile.id, valid.profile.id);

  const count = db.prepare('SELECT COUNT(*) AS c FROM scout_profile_versions').get().c;
  assert.equal(count, 1);
});

test('importDiscoveries scores jobs against active profile and records sightings', () => {
  saveProfile(db, profileDocument.label, profileDocument.profile);
  const result = importDiscoveries(db, {
    source: 'linkedin-alert',
    message_id: 'msg-101',
    jobs: [
      {
        source_url: 'https://www.linkedin.com/jobs/view/1001/?trk=email',
        external_job_id: '1001',
        company: 'Contoso',
        role: 'Desktop Support Specialist',
        location: 'Dallas, TX',
        description: 'Windows 11, SCCM, Active Directory, end user troubleshooting.',
      },
      {
        source_url: 'https://www.linkedin.com/jobs/view/1002/',
        external_job_id: '1002',
        company: 'Fabrikam',
        role: 'Marketing Director',
        location: 'New York, NY',
        description: 'Lead brand strategy and social media management.',
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.imported.length, 2);

  const firstLead = db.prepare("SELECT * FROM scout_discoveries WHERE external_job_id='1001'").get();
  assert.ok(firstLead);
  assert.ok(firstLead.fit_score >= 55, 'Desktop Support Specialist gets positive match score');

  const secondLead = db.prepare("SELECT * FROM scout_discoveries WHERE external_job_id='1002'").get();
  assert.ok(secondLead);
  assert.ok(secondLead.fit_score < firstLead.fit_score, 'Marketing Director scores lower');

  const sightingCount = db.prepare('SELECT COUNT(*) AS c FROM scout_sightings').get().c;
  assert.equal(sightingCount, 2);

  const repeatImport = importDiscoveries(db, {
    source: 'linkedin-alert',
    message_id: 'msg-102',
    jobs: [
      {
        source_url: 'https://www.linkedin.com/jobs/view/1001/',
        external_job_id: '1001',
        company: 'Contoso',
        role: 'Desktop Support Specialist',
        location: 'Dallas, TX',
        description: 'Updated payload text',
      },
    ],
  });

  assert.equal(repeatImport.ok, true);
  assert.equal(repeatImport.imported[0].created, false);
  assert.equal(repeatImport.imported[0].new_sighting, true);

  const discoveryCount = db.prepare('SELECT COUNT(*) AS c FROM scout_discoveries').get().c;
  assert.equal(discoveryCount, 2, 'discovery deduplicated by source_key');

  const totalSightings = db.prepare('SELECT COUNT(*) AS c FROM scout_sightings').get().c;
  assert.equal(totalSightings, 3, 'new raw payload appends a new sighting row');
});

test('getScout filters by review, status, and formats summary html', () => {
  saveProfile(db, profileDocument.label, profileDocument.profile);
  importDiscoveries(db, {
    jobs: [{
      source_url: 'https://www.linkedin.com/jobs/view/111/',
      external_job_id: '111',
      company: 'Contoso',
      role: 'Desktop Support Technician',
      location: 'Dallas, Texas',
      description: 'SCCM, Windows imaging, Active Directory and end user troubleshooting.',
    }, {
      source_url: 'https://www.linkedin.com/jobs/view/222/',
      external_job_id: '222',
      company: 'Tailspin',
      role: 'Marketing Director',
      location: 'New York, New York',
    }],
  });
  const data = getScout(db);
  assert.equal(data.discoveries[0].external_job_id, '111');
  const html = renderScoutHtml(data);
  assert.match(html, /<article class="card lead">/);
  assert.match(html, /Open on LinkedIn/);
  assert.match(html, /Prospect Capture/);
});

test('Scout mobile filters wrap as intact one-line capsules with one accessible active state', () => {
  const html = renderScoutHtml({
    discoveries: [],
    counts: { new: 2, shortlisted: 1, captured: 3, top: 1, strong: 2, possible: 0, stretch: 1, review: 3, all: 6 },
    profile: null,
  }, { status: 'review' });

  assert.match(html, /<nav class="summary" aria-label="Scout lead filters">/);
  assert.equal((html.match(/class="summary-link/g) || []).length, 7);
  const filterNav = html.slice(
    html.indexOf('<nav class="summary"'),
    html.indexOf('</nav>', html.indexOf('<nav class="summary"')) + 6,
  );
  assert.equal((filterNav.match(/aria-current="page"/g) || []).length, 1);
  assert.match(filterNav, /class="summary-link is-active" href="\/scout\?status=review" aria-current="page"/);
  assert.match(html, /\.summary-link\{flex:0 0 auto;text-decoration:none\}/);
  assert.match(html, /\.summary \.pill\{display:inline-flex;align-items:center;min-height:32px;white-space:nowrap;line-height:1\}/);
  assert.match(html, /@media\(max-width:720px\)\{\.summary\{flex-wrap:wrap;gap:8px;/);
  assert.doesNotMatch(html, /<span class="pill" style=/, 'active styling is class-based, not fragmented inline borders');
});

test('import anomaly flags are deterministic observations and never rewrite source fields', () => {
  const discovery = {
    source_key: 'fallback:abc123',
    external_job_id: null,
    company: 'CyrusOne &middot; Richardson, TX',
    role: 'View job',
    location: '',
  };
  const before = structuredClone(discovery);
  const anomalies = detectImportAnomalies(discovery);

  assert.deepEqual(discovery, before, 'anomaly detection is read-only');
  assert.deepEqual(anomalies.map((item) => item.code), [
    'missing_location',
    'generic_role',
    'html_entity',
    'weak_identity',
  ]);
  assert.ok(anomalies.every((item) => ['warning', 'error'].includes(item.severity)));
});

test('getScout derives import-check counts and filters active anomalous discoveries', () => {
  saveProfile(db, profileDocument.label, profileDocument.profile);
  importDiscoveries(db, {
    jobs: [{
      source_url: 'https://www.linkedin.com/jobs/view/anomaly-1/',
      external_job_id: 'anomaly-1',
      company: 'Contoso',
      role: 'Desktop Support Technician',
      location: '',
    }, {
      source_url: 'https://www.linkedin.com/jobs/view/clean-1/',
      external_job_id: 'clean-1',
      company: 'Fabrikam',
      role: 'Systems Administrator',
      location: 'Dallas, Texas',
    }],
  });

  const data = getScout(db, { status: 'anomalies' });
  assert.equal(data.counts.anomalies, 1);
  assert.equal(data.discoveries.length, 1);
  assert.equal(data.discoveries[0].external_job_id, 'anomaly-1');
  assert.deepEqual(data.discoveries[0].import_anomalies.map((item) => item.code), ['missing_location']);

  const html = renderScoutHtml(data, { status: 'anomalies' });
  assert.match(html, /aria-label="Import checks"/);
  assert.match(html, /Location missing/);
  assert.match(html, /href="\/scout\?status=anomalies" aria-current="page"/);
});

test('linkCapturedDiscovery supports external ID matching, canonical URL fallback, and no overwrite', () => {
  saveProfile(db, profileDocument.label, profileDocument.profile);
  importDiscoveries(db, {
    jobs: [
      {
        external_job_id: 'ext-100',
        source_url: 'https://www.linkedin.com/jobs/view/100/?trk=email',
        company: 'Alpha Co',
        role: 'Cloud Engineer',
      },
      {
        external_job_id: 'ext-200',
        source_url: 'https://www.linkedin.com/jobs/view/200/?utm_source=alert',
        company: 'Beta Co',
        role: 'DevOps Engineer',
      },
    ],
  });

  const listingA = db.prepare(
    "INSERT INTO listings (source, source_url, external_job_id, snapshot_hash) VALUES ('linkedin', 'https://www.linkedin.com/jobs/view/100/', 'ext-100', 'hashA')"
  ).run().lastInsertRowid;
  const claimA = db.prepare("INSERT INTO claims (listing_id) VALUES (?)").run(listingA).lastInsertRowid;

  const changesExt = linkCapturedDiscovery(db, { claimId: claimA, externalJobId: 'ext-100', sourceUrl: 'https://www.linkedin.com/jobs/view/100/' });
  assert.equal(changesExt, 1);
  const rowA = db.prepare("SELECT status, linked_claim_id FROM scout_discoveries WHERE external_job_id='ext-100'").get();
  assert.deepEqual(rowA, { status: 'captured', linked_claim_id: claimA });

  const listingA2 = db.prepare(
    "INSERT INTO listings (source, source_url, external_job_id, snapshot_hash) VALUES ('linkedin', 'https://www.linkedin.com/jobs/view/100/', 'ext-100', 'hashA2')"
  ).run().lastInsertRowid;
  const claimA2 = db.prepare("INSERT INTO claims (listing_id) VALUES (?)").run(listingA2).lastInsertRowid;
  const changesOverwrite = linkCapturedDiscovery(db, { claimId: claimA2, externalJobId: 'ext-100', sourceUrl: 'https://www.linkedin.com/jobs/view/100/' });
  assert.equal(changesOverwrite, 0);
  const rowAStill = db.prepare("SELECT linked_claim_id FROM scout_discoveries WHERE external_job_id='ext-100'").get();
  assert.equal(rowAStill.linked_claim_id, claimA);

  const listingB = db.prepare(
    "INSERT INTO listings (source, source_url, snapshot_hash) VALUES ('linkedin', 'https://www.linkedin.com/jobs/view/200/', 'hashB')"
  ).run().lastInsertRowid;
  const claimB = db.prepare("INSERT INTO claims (listing_id) VALUES (?)").run(listingB).lastInsertRowid;
  const changesFallback = linkCapturedDiscovery(db, { claimId: claimB, externalJobId: 'wrong-id', sourceUrl: 'https://www.linkedin.com/jobs/view/200/' });
  assert.equal(changesFallback, 1);
  const rowB = db.prepare("SELECT status, linked_claim_id FROM scout_discoveries WHERE source_url LIKE '%200%'").get();
  assert.deepEqual(rowB, { status: 'captured', linked_claim_id: claimB });
});

test('getScout returns original assessment unchanged plus separate richer verified assessment without DB writes', () => {
  saveProfile(db, profileDocument.label, profileDocument.profile);
  importDiscoveries(db, {
    jobs: [{
      external_job_id: 'enrich-1',
      source_url: 'https://www.linkedin.com/jobs/view/enrich-1/',
      company: 'Enrich Tech',
      role: 'Desktop Support Technician',
      location: 'Dallas, Texas',
      description: 'Desktop support basic',
    }],
  });

  const listingId = db.prepare(`
    INSERT INTO listings (
      source, source_url, external_job_id, company, role, location, comp, description,
      employment_type, workplace_type, seniority, applicant_count, applicants_last_day, snapshot_hash
    ) VALUES (
      'linkedin', 'https://www.linkedin.com/jobs/view/enrich-1/', 'enrich-1',
      'Enrich Tech <Corp>', 'Desktop Support Technician', 'Dallas, Texas', '$90,000/yr',
      'Windows imaging, SCCM deployment, Active Directory, PowerShell scripting, end user support.',
      'full_time', 'hybrid', 'mid_level', 42, 5, 'rich-hash'
    )
  `).run().lastInsertRowid;
  const claimId = db.prepare("INSERT INTO claims (listing_id) VALUES (?)").run(listingId).lastInsertRowid;
  linkCapturedDiscovery(db, { claimId, externalJobId: 'enrich-1' });

  const countBefore = db.prepare("SELECT COUNT(*) AS c FROM scout_discoveries").get().c;

  const data = getScout(db, { status: 'all' });
  const countAfter = db.prepare("SELECT COUNT(*) AS c FROM scout_discoveries").get().c;
  assert.equal(countBefore, countAfter, 'getScout performs no DB writes');

  const lead = data.discoveries.find((d) => d.external_job_id === 'enrich-1');
  assert.ok(lead);
  assert.ok(lead.assessment, 'original assessment retained');
  assert.ok(lead.verified_assessment, 'separate verified assessment present');
  assert.ok(lead.verified_assessment.score >= lead.assessment.score, 'richer description yields equal or higher score');
  assert.equal(lead.verified.claim_id, claimId);
  assert.equal(lead.verified.comp, '$90,000/yr');

  const html = renderScoutHtml(data, { status: 'all' });
  assert.match(html, /Verified capture/);
  assert.match(html, /Verified score/);
  assert.match(html, /Email score/);
  assert.match(html, /Claim #/);
  assert.match(html, /Hybrid/);
  assert.match(html, /42 applicants/);
  assert.match(html, /Enrich Tech &lt;Corp&gt;/, 'escaping enforced');
});

test('unlinked Scout leads retain verify-with-Prospect-Capture cue', () => {
  saveProfile(db, profileDocument.label, profileDocument.profile);
  importDiscoveries(db, {
    jobs: [{
      external_job_id: 'unlinked-1',
      source_url: 'https://www.linkedin.com/jobs/view/unlinked-1/',
      company: 'Unlinked Co',
      role: 'System Administrator',
      location: 'Austin, Texas',
    }],
  });
  const data = getScout(db, { status: 'review' });
  const html = renderScoutHtml(data, { status: 'review' });
  assert.match(html, /Open LinkedIn, then use Prospect Capture to verify\/enrich/);
  assert.match(html, /Open on LinkedIn/);
});

test('computeTriage calculates explainable additive factors, clamps score, and assigns tiers', () => {
  const now = new Date('2026-07-30T12:00:00Z').getTime();
  const discovery = {
    fit_score: 70,
    status: 'shortlisted',
    sighting_count: 3,
    first_seen_at: '2026-07-30T10:00:00Z',
    last_seen_at: '2026-07-30T10:00:00Z',
  };
  const triage = computeTriage(discovery, { now });
  assert.equal(triage.score, 100);
  assert.equal(triage.tier, 'top');
  assert.ok(triage.factors.some((f) => f.label === 'Base fit score' && f.delta === 70));
  assert.ok(triage.factors.some((f) => f.label === 'Shortlisted boost' && f.delta === 20));
  assert.ok(triage.factors.some((f) => f.label.includes('Re-sighting') && f.delta === 10));
  assert.ok(triage.factors.some((f) => f.label.includes('Freshness') && f.delta === 15));

  const oldDiscovery = {
    fit_score: 30,
    status: 'new',
    sighting_count: 1,
    first_seen_at: '2026-07-01T10:00:00Z',
    last_seen_at: '2026-07-01T10:00:00Z',
  };
  const oldTriage = computeTriage(oldDiscovery, { now });
  assert.equal(oldTriage.score, 30);
  assert.equal(oldTriage.tier, 'low');
});

test('getScout supports status=top filter, derived counts, and triage score sorting', () => {
  saveProfile(db, profileDocument.label, profileDocument.profile);
  importDiscoveries(db, {
    jobs: [
      {
        source_url: 'https://www.linkedin.com/jobs/view/top-1/',
        external_job_id: 'top-1',
        company: 'Alpha Inc',
        role: 'Desktop Support Technician',
        location: 'Dallas, Texas',
        description: 'SCCM, Windows imaging, Active Directory.',
      },
      {
        source_url: 'https://www.linkedin.com/jobs/view/low-1/',
        external_job_id: 'low-1',
        company: 'Beta Corp',
        role: 'Sales Associate',
        location: 'Remote',
      },
    ],
  });

  const reviewData = getScout(db, { status: 'review' });
  assert.ok(reviewData.counts.top >= 1);
  assert.ok(reviewData.counts.strong >= 1);
  assert.equal(reviewData.counts.review, 2);

  const topData = getScout(db, { status: 'top' });
  assert.equal(topData.discoveries.length, 1);
  assert.equal(topData.discoveries[0].external_job_id, 'top-1');

  const html = renderScoutHtml(topData, { status: 'top' });
  assert.match(html, /Daily Brief \/ Top Picks/);
  assert.match(html, /Top Picks/);
  assert.match(html, /TOP TIER \(100\)/);
});

test('stakeDiscovery creates a provisional claim and is idempotent', () => {
  saveProfile(db, profileDocument.label, profileDocument.profile);
  importDiscoveries(db, {
    jobs: [{
      source_url: 'https://www.linkedin.com/jobs/view/stake-1/',
      external_job_id: 'stake-1',
      company: 'Stake Co',
      role: 'Desktop Support Specialist',
      location: 'Austin, Texas',
      raw_payload: JSON.stringify({ raw_bytes: 'verbatim-sighting-data' }),
    }],
  });

  const discovery = db.prepare("SELECT id FROM scout_discoveries WHERE external_job_id='stake-1'").get();
  const res1 = stakeDiscovery(db, discovery.id);
  assert.equal(res1.ok, true);
  assert.equal(res1.status, 201);
  assert.equal(res1.created, true);
  const claimId = res1.claimId;

  const claimCount = db.prepare('SELECT COUNT(*) AS c FROM claims').get().c;
  assert.equal(claimCount, 1);

  const listing = db.prepare('SELECT * FROM listings WHERE id = (SELECT listing_id FROM claims WHERE id=?)').get(claimId);
  assert.equal(listing.source, 'linkedin-alert');
  assert.equal(listing.snapshot_generation, 1);
  assert.equal(listing.verified, 0);
  assert.match(listing.raw_payload, /verbatim-sighting-data/);

  const parsed = JSON.parse(listing.parsed);
  assert.equal(parsed.verification_status, 'pending-browser-capture');
  assert.equal(parsed.capture_source, 'scout-email');
  assert.equal(parsed.discovery_id, discovery.id);

  const transitions = db.prepare('SELECT * FROM stage_transitions WHERE claim_id=?').all(claimId);
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].to_stage, 'Showings');

  const res2 = stakeDiscovery(db, discovery.id);
  assert.equal(res2.ok, true);
  assert.equal(res2.status, 200);
  assert.equal(res2.claimId, claimId);
  assert.equal(res2.created, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM claims').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM listings').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM stage_transitions').get().c, 1);
});

test('stakeDiscovery links pre-existing matching listing/claim without creating duplicates', () => {
  saveProfile(db, profileDocument.label, profileDocument.profile);
  importDiscoveries(db, {
    jobs: [{
      source_url: 'https://www.linkedin.com/jobs/view/pre-1/',
      external_job_id: 'pre-1',
      company: 'Existing Co',
      role: 'Network Engineer',
    }],
  });

  const discovery = db.prepare("SELECT id FROM scout_discoveries WHERE external_job_id='pre-1'").get();

  const listingId = db.prepare(`
    INSERT INTO listings (source, source_url, external_job_id, company, role, snapshot_hash)
    VALUES ('linkedin', 'https://www.linkedin.com/jobs/view/pre-1/', 'pre-1', 'Existing Co', 'Network Engineer', 'prehash')
  `).run().lastInsertRowid;
  const preClaimId = db.prepare('INSERT INTO claims (listing_id) VALUES (?)').run(listingId).lastInsertRowid;

  const res = stakeDiscovery(db, discovery.id);
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.claimId, preClaimId);
  assert.equal(res.created, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM claims').get().c, 1);
});

test('getScout renders provisional Staked card with pending notice and genuine capture with Verified badge', () => {
  saveProfile(db, profileDocument.label, profileDocument.profile);
  importDiscoveries(db, {
    jobs: [{
      source_url: 'https://www.linkedin.com/jobs/view/badge-1/',
      external_job_id: 'badge-1',
      company: 'Badge Co',
      role: 'Desktop Support Technician',
    }],
  });

  const discovery = db.prepare("SELECT id FROM scout_discoveries WHERE external_job_id='badge-1'").get();
  stakeDiscovery(db, discovery.id);

  const provisionalData = getScout(db, { status: 'captured' });
  const provLead = provisionalData.discoveries[0];
  assert.equal(provLead.verified, null, 'provisional stake is not verified yet');
  assert.ok(provLead.provisional_claim_id > 0);

  const provHtml = renderScoutHtml(provisionalData, { status: 'captured' });
  assert.match(provHtml, /Staked from Scout/);
  assert.match(provHtml, /Browser verification pending/);
  assert.doesNotMatch(provHtml, /class="badge badge-verified"/);
});
