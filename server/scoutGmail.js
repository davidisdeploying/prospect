import { notifyScoutNewLeads, notifyScoutIngestionStale } from './push.js';
import fs from 'node:fs';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { importDiscoveries } from './scout.js';

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
// Accepts both delivery paths: legacy Apple Mail forwards from owner@example.com, and
// LinkedIn alerts delivered straight to the Gmail account (David moved his LinkedIn contact
// email to Gmail on 2026-08-07). The outer sender is transport only -- parseLinkedInAlert
// still independently requires the LinkedIn alert sender before anything is imported.
export const DEFAULT_GMAIL_QUERY =
  'from:(owner@example.com OR jobalerts-noreply@linkedin.com) newer_than:30d';
export const LINKEDIN_ALERT_SENDER = 'jobalerts-noreply@linkedin.com';

function text(value) {
  return value == null ? '' : String(value).trim();
}

function decodeBase64Url(value) {
  if (!value) return '';
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function decodeEntities(value) {
  return text(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    // Native LinkedIn alerts separate company from location with a raw &middot; entity.
    // Apple Mail normalized it to a literal '·' when forwarding, which is why the
    // forward-only era never exercised this. contextAfterAnchor splits on '·', so an
    // undecoded entity here silently fuses company and location into one field.
    .replace(/&middot;/gi, '·')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&rsquo;/gi, '’')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&hellip;/gi, '…')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripHtml(value) {
  return decodeEntities(String(value || '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function collectMime(part, output = { html: [], plain: [] }) {
  if (!part) return output;
  const body = decodeBase64Url(part.body?.data);
  if (body) {
    if (part.mimeType === 'text/html') output.html.push(body);
    if (part.mimeType === 'text/plain') output.plain.push(body);
  }
  for (const child of part.parts || []) collectMime(child, output);
  return output;
}

function cleanLinkedInUrl(raw, jobId) {
  const decoded = decodeEntities(raw);
  try {
    const url = new URL(decoded);
    url.hash = '';
    return `https://www.linkedin.com/jobs/view/${jobId}/`;
  } catch {
    return `https://www.linkedin.com/jobs/view/${jobId}/`;
  }
}

function roleQuality(value) {
  const role = text(value);
  if (!role || /^(view|see|apply|show)\b.*\b(job|jobs|details?)$/i.test(role)) return 0;
  if (/^(linkedin|jobs?|apply|view)$/i.test(role)) return 0;
  return Math.min(100, role.length);
}

function contextAfterAnchor(html, endIndex) {
  const following = stripHtml(html.slice(endIndex, endIndex + 1800))
    .split('\n').map(text).filter(Boolean)
    .filter((line) => !/^(view|apply|save|promoted|easy apply)\b/i.test(line));
  const companyLocation = following[0] || '';
  const combined = companyLocation.split(/\s+·\s+/).map(text).filter(Boolean);
  return {
    company: combined[0] || companyLocation,
    location: combined.length > 1 ? combined.slice(1).join(' · ') : (following[1] || ''),
    description: following.slice(0, 5).join(' · '),
  };
}

export function parseLinkedInAlert(message) {
  const mime = collectMime(message?.payload);
  const html = mime.html.join('\n');
  const plain = [mime.plain.join('\n'), stripHtml(html)].filter(Boolean).join('\n');
  const headers = Object.fromEntries(
    (message?.payload?.headers || []).map((header) => [header.name.toLocaleLowerCase('en-US'), header.value])
  );
  const senderEvidence = [headers.from, headers.subject, plain, html].filter(Boolean).join('\n');
  if (!senderEvidence.toLocaleLowerCase('en-US').includes(LINKEDIN_ALERT_SENDER)) {
    return { accepted: false, reason: 'embedded LinkedIn alert sender not found', jobs: [] };
  }

  const candidates = new Map();
  const anchorPattern = /<a\b[^>]*href=(["'])([^"']*linkedin\.com[^"']*\/jobs\/view\/(\d+)[^"']*)\1[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const jobId = match[3];
    const role = stripHtml(match[4]).replace(/\s+/g, ' ').trim();
    const existing = candidates.get(jobId);
    if (!existing || roleQuality(role) > roleQuality(existing.role)) {
      candidates.set(jobId, {
        jobId,
        role,
        sourceUrl: cleanLinkedInUrl(match[2], jobId),
        context: contextAfterAnchor(html, match.index + match[0].length),
      });
    }
  }

  const urlPattern = /https?:\/\/(?:[a-z0-9-]+\.)?linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)[^\s"'<>]*/gi;
  for (const match of [html, plain].join('\n').matchAll(urlPattern)) {
    if (!candidates.has(match[1])) {
      candidates.set(match[1], {
        jobId: match[1],
        role: '',
        sourceUrl: cleanLinkedInUrl(match[0], match[1]),
      });
    }
  }

  const jobs = [...candidates.values()]
    .filter((candidate) => roleQuality(candidate.role) > 0)
    .map((candidate) => {
      const context = candidate.context || { company: '', location: '', description: '' };
      return {
        external_job_id: candidate.jobId,
        source_url: candidate.sourceUrl,
        role: candidate.role,
        company: context.company,
        location: context.location,
        description: context.description,
        raw_payload: JSON.stringify({
          gmail_message_id: message.id,
          linkedin_job_id: candidate.jobId,
          role: candidate.role,
          company: context.company,
          location: context.location,
        }),
      };
    });
  return {
    accepted: true,
    reason: jobs.length ? 'LinkedIn job links parsed' : 'LinkedIn sender verified but no titled job links parsed',
    jobs,
  };
}

function installedCredentials(document) {
  const credentials = document.installed || document.web;
  if (!credentials?.client_id || !credentials?.client_secret) {
    throw new Error('OAuth client JSON must contain installed.client_id and installed.client_secret');
  }
  return credentials;
}

export async function authorizeGmail({ credentialsPath, tokenPath }) {
  if (!credentialsPath || !tokenPath) throw new Error('credentialsPath and tokenPath are required');
  const document = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  const credentials = installedCredentials(document);
  const state = crypto.randomBytes(24).toString('hex');
  let resolveCallback;
  let rejectCallback;
  const callback = new Promise((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  const server = http.createServer((request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname !== '/oauth2callback') {
        response.writeHead(404).end('Not found');
        return;
      }
      if (url.searchParams.get('state') !== state) throw new Error('OAuth state mismatch');
      const error = url.searchParams.get('error');
      if (error) throw new Error(`Google authorization failed: ${error}`);
      const code = url.searchParams.get('code');
      if (!code) throw new Error('Google did not return an authorization code');
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Prospect Scout Gmail access is authorized. You may close this tab.');
      resolveCallback(code);
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(`Authorization failed: ${error.message}`);
      rejectCallback(error);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizationUrl.search = new URLSearchParams({
    client_id: credentials.client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_READONLY_SCOPE,
    access_type: 'offline',
    include_granted_scopes: 'false',
    prompt: 'consent',
    state,
  }).toString();
  console.log(`AUTHORIZATION_URL=${authorizationUrl}`);

  let code;
  try {
    code = await callback;
  } finally {
    server.close();
  }
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const token = await tokenResponse.json();
  if (!tokenResponse.ok) throw new Error(`OAuth token exchange failed: ${token.error || tokenResponse.status}`);
  token.expiry_date = Date.now() + (Number(token.expires_in || 3600) * 1000);
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(tokenPath, JSON.stringify(token, null, 2), { mode: 0o600 });
  fs.chmodSync(tokenPath, 0o600);
  return { tokenPath, scope: GMAIL_READONLY_SCOPE };
}

export function loadGmailAuth({ credentialsPath, tokenPath }) {
  const document = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  const credentials = installedCredentials(document);
  const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  return { credentials, token, tokenPath };
}

async function accessToken(auth) {
  const stillValid = auth.token.access_token
    && Number(auth.token.expiry_date || 0) > Date.now() + 60_000;
  if (stillValid) return auth.token.access_token;
  if (!auth.token.refresh_token) throw new Error('OAuth token has no refresh_token; run authorize again');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: auth.credentials.client_id,
      client_secret: auth.credentials.client_secret,
      refresh_token: auth.token.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const refreshed = await response.json();
  if (!response.ok) throw new Error(`OAuth refresh failed: ${refreshed.error || response.status}`);
  auth.token = {
    ...auth.token,
    ...refreshed,
    expiry_date: Date.now() + (Number(refreshed.expires_in || 3600) * 1000),
  };
  fs.writeFileSync(auth.tokenPath, JSON.stringify(auth.token, null, 2), { mode: 0o600 });
  return auth.token.access_token;
}

async function gmailRequest(auth, endpoint, parameters = {}) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${endpoint}`);
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${await accessToken(auth)}` },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Gmail API ${response.status}: ${body.error?.message || 'request failed'}`);
  return body;
}

function receipt(db, message, status, jobCount, detail) {
  db.prepare(`
    INSERT INTO scout_gmail_messages (
      gmail_message_id, gmail_thread_id, received_at, status, job_count, detail
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(gmail_message_id) DO UPDATE SET
      processed_at=datetime('now'), status=excluded.status,
      job_count=excluded.job_count, detail=excluded.detail
  `).run(
    message.id,
    message.threadId || null,
    message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
    status,
    jobCount,
    text(detail).slice(0, 500) || null,
  );
}

// Scout ingestion staleness (H24).
//
// The 2026-08-07 outage ran eight days behind a daily `ok: true` because the importer's summary
// cannot distinguish "the query matches nothing" from "the job market is quiet". Both look like
// listed>0, imported_messages:0. The one signal that separates them is whether ACCEPTED alert mail
// is still arriving, so staleness is measured from the newest received_at among imported receipts
// -- not from discoveries (repeat alerts legitimately create none) and not from the exit code.
export const DEFAULT_STALE_THRESHOLD_DAYS = 3;

export function staleThresholdDays(env = process.env) {
  const raw = Number(env.PROSPECT_SCOUT_STALE_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STALE_THRESHOLD_DAYS;
}

export function scoutIngestionStaleness(db, { now = new Date(), thresholdDays = staleThresholdDays() } = {}) {
  const row = db.prepare(
    "SELECT MAX(received_at) AS last_at FROM scout_gmail_messages WHERE status = 'imported'"
  ).get();
  const lastAt = row?.last_at || null;

  // No accepted mail has EVER been ingested: a fresh install has no baseline to be stale against.
  // Staying silent here is deliberate -- alerting on an empty table would fire on day one forever.
  if (!lastAt) return { stale: false, lastIngestAt: null, daysStale: null, thresholdDays, reason: 'no ingestion baseline' };

  const lastMs = Date.parse(lastAt);
  if (!Number.isFinite(lastMs)) {
    return { stale: false, lastIngestAt: lastAt, daysStale: null, thresholdDays, reason: 'unparseable received_at' };
  }

  const daysStale = (now.getTime() - lastMs) / 86_400_000;
  return {
    stale: daysStale >= thresholdDays,
    lastIngestAt: lastAt,
    daysStale,
    thresholdDays,
    reason: daysStale >= thresholdDays ? 'no accepted alert mail within threshold' : 'fresh',
  };
}

export async function runGmailScout(db, {
  auth,
  query = DEFAULT_GMAIL_QUERY,
  dryRun = false,
  maxResults = 100,
  pushTransport = null,
} = {}) {
  if (!auth) throw new Error('Gmail auth is required');
  const known = new Set(db.prepare('SELECT gmail_message_id FROM scout_gmail_messages').all()
    .map((row) => row.gmail_message_id));
  const listed = await gmailRequest(auth, 'messages', { q: query, maxResults });
  const candidates = listed.messages || [];
  const summary = { query, listed: candidates.length, skipped: 0, imported_messages: 0, jobs: 0, new_jobs: 0, ignored: 0, parse_empty: 0, errors: [] };

  for (const candidate of candidates.reverse()) {
    if (known.has(candidate.id)) {
      summary.skipped += 1;
      continue;
    }
    try {
      const message = await gmailRequest(auth, `messages/${encodeURIComponent(candidate.id)}`, { format: 'full' });
      const parsed = parseLinkedInAlert(message);
      if (!parsed.accepted) {
        summary.ignored += 1;
        if (!dryRun) receipt(db, message, 'ignored', 0, parsed.reason);
        continue;
      }
      if (parsed.jobs.length === 0) {
        summary.parse_empty += 1;
        if (!dryRun) receipt(db, message, 'parse_empty', 0, parsed.reason);
        continue;
      }
      if (!dryRun) {
        const result = importDiscoveries(db, {
          source: 'linkedin-alert',
          message_id: message.id,
          jobs: parsed.jobs,
        });
        if (!result.ok) throw new Error(result.error);
        const createdCount = (result.imported || []).filter((item) => item.created === true).length;
        summary.new_jobs += createdCount;
        receipt(db, message, 'imported', parsed.jobs.length, parsed.reason);
      }
      summary.imported_messages += 1;
      summary.jobs += parsed.jobs.length;
    } catch (error) {
      summary.errors.push({ gmail_message_id: candidate.id, error: error.message });
      if (!dryRun) {
        receipt(db, candidate, 'error', 0, error.message);
      }
    }
  }
  if (!dryRun && summary.new_jobs > 0) {
    try {
      const totalNew = db.prepare("SELECT COUNT(*) AS n FROM scout_discoveries WHERE status='new'").get()?.n || summary.new_jobs;
      const bestNewRow = db.prepare("SELECT role, company FROM scout_discoveries WHERE status='new' ORDER BY id DESC LIMIT 1").get();
      const pushRes = await notifyScoutNewLeads(db, {
        newJobsCount: summary.new_jobs,
        totalNewCount: totalNew,
        bestJob: bestNewRow,
        transport: pushTransport,
      });
      summary.push = pushRes;
    } catch (pushErr) {
      summary.push = { ok: false, error: pushErr.message };
    }
  }

  // Staleness check runs on EVERY completed run, including runs that imported nothing -- a run that
  // imports nothing is precisely the case this is here to interpret.
  const staleness = scoutIngestionStaleness(db, { now: new Date() });
  summary.ingestion = {
    last_accepted_at: staleness.lastIngestAt,
    days_stale: staleness.daysStale === null ? null : Number(staleness.daysStale.toFixed(2)),
    threshold_days: staleness.thresholdDays,
    stale: staleness.stale,
  };
  if (!dryRun && staleness.stale) {
    try {
      summary.stale_alert = await notifyScoutIngestionStale(db, {
        daysStale: staleness.daysStale,
        lastIngestAt: staleness.lastIngestAt,
        thresholdDays: staleness.thresholdDays,
        transport: pushTransport,
      });
    } catch (staleErr) {
      summary.stale_alert = { ok: false, error: staleErr.message };
    }
  }
  return summary;
}
