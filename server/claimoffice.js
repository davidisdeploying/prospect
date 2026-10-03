import { renderPwaHeadTags } from './pwaHead.js';
import { computeSelectionIntel } from './selection.js';
import { renderSidebarNav, renderTopBar, renderTabBar, SHELL_STYLE } from './shell.js';
import { ALL_STAGES } from '../app/src/stages.js';

// Read-only: every query below is a SELECT (or a read-only CTE built on SELECTs) — nothing here
// mutates a row. Companies are derived from `listings.company_id`; claims are derived from
// `claims.listing_id`; contacts have no company_id (per the §2.2 lock) so the company<->contact
// relationship is joined transitively through claims/listings.

function stageBreakdown(rows) {
  const byStage = new Map(rows.map((r) => [r.stage, r.n]));
  return ALL_STAGES.map(({ key, gloss }) => ({ stage: key, gloss, count: byStage.get(key) || 0 }));
}

// Any claim at this company whose stage_transitions log ever recorded a move to Strike — read
// from the append-only log (never claims.stage), same "ever reached" discipline as computeFunnel
// in huntReport.js, so a claim that struck and later moved on still counts.
function computeReachedStrike(db) {
  const rows = db.prepare(`
    SELECT DISTINCT l.company_id AS company_id
    FROM stage_transitions st
    JOIN claims c ON c.id = st.claim_id
    JOIN listings l ON l.id = c.listing_id
    WHERE st.to_stage = 'Strike' AND l.company_id IS NOT NULL
  `).all();
  return new Set(rows.map((r) => r.company_id));
}

function computeCompanies(db) {
  const companies = db.prepare(`SELECT id, name, canonical_name, page_url FROM companies ORDER BY name`).all();

  const claimStageRows = db.prepare(`
    SELECT l.company_id AS company_id, c.stage AS stage, COUNT(*) AS n
    FROM claims c JOIN listings l ON l.id = c.listing_id
    WHERE l.company_id IS NOT NULL
    GROUP BY l.company_id, c.stage
  `).all();
  const stageRowsByCompany = new Map();
  for (const row of claimStageRows) {
    if (!stageRowsByCompany.has(row.company_id)) stageRowsByCompany.set(row.company_id, []);
    stageRowsByCompany.get(row.company_id).push(row);
  }

  const compRows = db.prepare(`
    SELECT l.company_id AS company_id,
           MIN(l.annual_comp_min) AS min, MAX(l.annual_comp_max) AS max, AVG(l.annual_comp_mid) AS mid
    FROM listings l
    WHERE l.company_id IS NOT NULL AND l.comp_disclosed = 1
    GROUP BY l.company_id
  `).all();
  const compByCompany = new Map(compRows.map((r) => [r.company_id, r]));

  const contactRows = db.prepare(`
    SELECT l.company_id AS company_id, ct.claim_id AS claim_id, ct.name AS name, ct.role AS role,
           ct.email AS email, ct.profile_url AS profile_url, ct.is_job_poster AS is_job_poster
    FROM contacts ct
    JOIN claims c ON c.id = ct.claim_id
    JOIN listings l ON l.id = c.listing_id
    WHERE l.company_id IS NOT NULL
  `).all();
  const contactsByCompany = new Map();
  for (const row of contactRows) {
    if (!contactsByCompany.has(row.company_id)) contactsByCompany.set(row.company_id, []);
    contactsByCompany.get(row.company_id).push({
      claim_id: row.claim_id, name: row.name, role: row.role,
      email: row.email, profile_url: row.profile_url, is_job_poster: !!row.is_job_poster,
    });
  }

  const activityRows = db.prepare(`
    SELECT l.company_id AS company_id, MAX(COALESCE(c.stage_entered_at, c.applied_at)) AS latest_activity
    FROM claims c JOIN listings l ON l.id = c.listing_id
    WHERE l.company_id IS NOT NULL
    GROUP BY l.company_id
  `).all();
  const activityByCompany = new Map(activityRows.map((r) => [r.company_id, r.latest_activity]));

  const claimCountRows = db.prepare(`
    SELECT l.company_id AS company_id, COUNT(*) AS n
    FROM claims c JOIN listings l ON l.id = c.listing_id
    WHERE l.company_id IS NOT NULL
    GROUP BY l.company_id
  `).all();
  const claimCountByCompany = new Map(claimCountRows.map((r) => [r.company_id, r.n]));

  const reachedStrike = computeReachedStrike(db);

  return companies.map((company) => {
    const comp = compByCompany.get(company.id);
    return {
      id: company.id,
      name: company.name,
      canonical_name: company.canonical_name,
      page_url: company.page_url,
      claim_count: claimCountByCompany.get(company.id) || 0,
      stage_breakdown: stageBreakdown(stageRowsByCompany.get(company.id) || []),
      comp: comp
        ? { min: comp.min, max: comp.max, mid: comp.mid == null ? null : Math.round(comp.mid) }
        : null,
      contacts: contactsByCompany.get(company.id) || [],
      reached_strike: reachedStrike.has(company.id),
      latest_activity: activityByCompany.get(company.id) || null,
    };
  });
}

// Recurrence key = first-non-blank of TRIM(profile_url) then TRIM(email). Name is display-only,
// never a merge key (free text, collision-prone — per design lock). NULL/blank keys are excluded.
function computeRecurringContacts(db) {
  const rows = db.prepare(`
    SELECT ct.name AS name, ct.claim_id AS claim_id, ct.profile_url AS profile_url, ct.email AS email,
           l.company_id AS company_id, comp.name AS company_name
    FROM contacts ct
    JOIN claims c ON c.id = ct.claim_id
    JOIN listings l ON l.id = c.listing_id
    LEFT JOIN companies comp ON comp.id = l.company_id
  `).all();

  const byKey = new Map();
  for (const row of rows) {
    const profileUrl = row.profile_url == null ? '' : row.profile_url.trim();
    const email = row.email == null ? '' : row.email.trim();
    const key = profileUrl || email;
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, { key, names: new Set(), claims: [] });
    const entry = byKey.get(key);
    if (row.name) entry.names.add(row.name);
    entry.claims.push({ claim_id: row.claim_id, company_id: row.company_id, company_name: row.company_name });
  }

  const recurring = [];
  for (const entry of byKey.values()) {
    const distinctClaims = new Set(entry.claims.map((c) => c.claim_id));
    if (distinctClaims.size < 2) continue;
    recurring.push({ key: entry.key, names: [...entry.names], claims: entry.claims });
  }
  return recurring;
}

export function getClaimOffice(db) {
  return {
    companies: computeCompanies(db),
    recurring_contacts: computeRecurringContacts(db),
    selection: computeSelectionIntel(db),
  };
}

// ---------------------------------------------------------------------------------------------
// Server-rendered, JS-free-legible HTML for GET /claim-office. Every value is emitted directly
// into the markup — no <canvas>, no client chart lib, no client JS required to see any value.
// Palette mirrors huntReport.js's STYLE (design-system/tokens/colors.css); the one scarce gold accent
// (--placer-gold) is reserved for a Strike/paydirt marker, and only shown where reached_strike is
// true — none of the live corpus has reached Strike yet, so no gold renders today (correct).
// ---------------------------------------------------------------------------------------------

// §6.4 -- how each company actually selects, and what it has asked before. Company-scoped rather
// than claim-scoped because assessment formats and interview questions recur per company and
// outlive any single application.
function selectionSection(selection) {
  if (!selection || !selection.available) {
    return section('Selection process', 'interviews, questions, and assessment formats per company', empty('Not available on this database.'));
  }
  const { totals } = selection;
  if (totals.interviews === 0 && totals.questions === 0 && totals.artifacts === 0) {
    return section('Selection process', 'interviews, questions, and assessment formats per company',
      empty('Nothing recorded yet — this fills in as interviews happen and questions are banked.'));
  }
  const rows = selection.companies.map((entry) => {
    const stages = entry.stages.length
      ? entry.stages.map((stage) => `${esc(stage.gloss)}${stage.count > 1 ? ` &times;${esc(stage.count)}` : ''}`).join(', ')
      : '&mdash;';
    const artifacts = entry.artifacts.length
      ? entry.artifacts.map((a) => esc(a.title)).join(', ')
      : '&mdash;';
    return `
    <tr>
      <td>${esc(entry.company)}</td>
      <td>${stages}</td>
      <td class="num">${esc(entry.questions)}</td>
      <td>${artifacts}</td>
    </tr>`;
  }).join('');

  const recurring = selection.question_bank.recurring.length
    ? `
    <h3 class="office-subhead">Questions asked more than once</h3>
    <table class="office-table">
      <thead><tr><th>Question</th><th class="num">Times</th><th>Companies</th></tr></thead>
      <tbody>${selection.question_bank.recurring.map((q) => `
        <tr>
          <td>${esc(q.question)}</td>
          <td class="num">${esc(q.times_asked)}</td>
          <td>${esc(q.companies.join(', '))}</td>
        </tr>`).join('')}</tbody>
    </table>`
    : `<p class="empty">No question has been asked twice yet — ${esc(selection.question_bank.total)} banked so far.</p>`;

  const unheld = totals.scheduled_not_held
    ? `<p class="empty">${esc(totals.scheduled_not_held)} interview${totals.scheduled_not_held === 1 ? ' was' : 's were'} scheduled but never recorded as held.</p>`
    : '';

  return section('Selection process', 'interviews, questions, and assessment formats per company', `
    <table class="office-table">
      <thead><tr><th>Company</th><th>Stages seen</th><th class="num">Questions</th><th>Artifacts</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${unheld}
    ${recurring}
  `);
}

function esc(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtComp(v) {
  return v == null ? '—' : `$${Math.round(v).toLocaleString('en-US')}`;
}

function section(title, gloss, body) {
  return `
    <section class="office-section">
      <h2>${esc(title)}</h2>
      <p class="gloss">${esc(gloss)}</p>
      ${body}
    </section>
  `;
}

function empty(message) {
  return `<p class="empty">${esc(message)}</p>`;
}

function odo(n) {
  return `<span class="odo-real">${n}</span><span class="odo-anim" aria-hidden="true" style="--odo-final:${n}"></span>`;
}

function fadeSpan(text) {
  return `<span class="fade-in">${text}</span>`;
}

function humanActivity(value) {
  if (!value) return 'No activity recorded';
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return String(value);
  const days = Math.max(0, Math.floor((Date.now() - ms) / 86400000));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

function stageBreakdownRow(stage) {
  return `<span class="chip-stage">${esc(stage.stage)} <span class="bar-sub">${esc(stage.gloss)}</span>: ${odo(stage.count)}</span>`;
}

function compRow(comp) {
  if (!comp || (comp.min == null && comp.max == null)) return empty('No disclosed comp yet.');
  const parts = [];
  if (comp.min != null) parts.push(`${fadeSpan(fmtComp(comp.min))}`);
  if (comp.max != null && comp.max !== comp.min) parts.push(`${fadeSpan(fmtComp(comp.max))}`);
  const range = parts.length === 2 ? `${parts[0]} &ndash; ${parts[1]}` : parts[0] || '—';
  const mid = comp.mid != null ? ` <span class="bar-sub">(avg mid ${fmtComp(comp.mid)})</span>` : '';
  return `<p class="metric-sub">${range}${mid}</p>`;
}

function contactsTable(contacts) {
  if (contacts.length === 0) return empty('No contacts captured yet.');
  const rows = contacts.map((c) => `
    <tr>
      <td>${esc(c.name) || '—'}</td>
      <td>${esc(c.role) || '—'}</td>
      <td>${esc(c.email) || '—'}</td>
      <td>${c.profile_url ? `<a href="${esc(c.profile_url)}">profile</a>` : '—'}</td>
      <td>${c.is_job_poster ? 'Job poster' : ''}</td>
      <td class="num">#${esc(c.claim_id)}</td>
    </tr>
  `).join('');
  return `
    <table class="office-table">
      <thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Profile</th><th></th><th class="num">Claim</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function companySection(company) {
  const strikeMark = company.reached_strike
    ? '<span class="chip-strike" title="A claim at this company reached Strike (offer)">&#9733; Paydirt</span>'
    : '';
  const pageLink = company.page_url
    ? `<p class="metric-sub"><a href="${esc(company.page_url)}">Open company page</a></p>`
    : '';
  const activity = `<span class="company-activity">${esc(humanActivity(company.latest_activity))}</span>`;
  return `
    <details class="company-card">
      <summary>
        <span class="company-name">${esc(company.name)} ${strikeMark}</span>
        <span class="company-summary">${odo(company.claim_count)} claim${company.claim_count === 1 ? '' : 's'} · ${company.contacts.length} contact${company.contacts.length === 1 ? '' : 's'} · ${activity}</span>
      </summary>
      <div class="company-detail">
        <div class="chips">${company.stage_breakdown.map(stageBreakdownRow).join('')}</div>
        ${compRow(company.comp)}
        ${pageLink}
        <h3>Contacts</h3>
        ${contactsTable(company.contacts)}
      </div>
    </details>
  `;
}

function companiesSection(companies) {
  if (companies.length === 0) return section('Companies', 'every company with a claim on file', empty('No companies yet.'));
  return `
    <section class="office-section company-index">
      <h2>Companies</h2>
      <p class="gloss">A compact index — open a company for stages, compensation, and contacts</p>
      ${companies.map(companySection).join('')}
    </section>
  `;
}

function recurringContactsSection(recurringContacts) {
  if (recurringContacts.length === 0) {
    return section(
      'Recurring contacts',
      'contacts (matched by profile URL, then email) who appear on 2+ claims',
      empty('No contacts captured yet — the Claim Office fills in as you stake claims.')
    );
  }
  const rows = recurringContacts.map((rc) => {
    const claimList = rc.claims
      .map((c) => `#${esc(c.claim_id)} (${esc(c.company_name) || 'unknown company'})`)
      .join(', ');
    return `
      <tr>
        <td>${esc(rc.names.join(' / ')) || '—'}</td>
        <td class="num">${odo(new Set(rc.claims.map((c) => c.claim_id)).size)}</td>
        <td>${esc(claimList)}</td>
      </tr>
    `;
  }).join('');
  return section(
    'Recurring contacts',
    'contacts (matched by profile URL, then email) who appear on 2+ claims',
    `
      <table class="office-table">
        <thead><tr><th>Name(s)</th><th class="num">Claims</th><th>Appears on</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `
  );
}

const STYLE = `
  :root {
    --wet-slate: #1B2327; --placer-gold: #CDA349; --verdigris: #4C8C78; --iron-oxide: #A14B33;
    --quartz: #E7E1D3; --galena: #6E767B;
    --slate-900: #10171A; --slate-850: #161E22; --slate-800: #1B2327; --slate-750: #212B2F; --slate-700: #283338;
    --line: #2E383C; --galena-dim: #3A4448;
    --quartz-100: #F3EFE6; --quartz-200: #E7E1D3; --quartz-300: #CFD4D0; --quartz-400: #9AA1A4;
    --bg-base: var(--slate-800); --bg-sunken: var(--slate-900); --surface-card: var(--slate-750); --surface-raised: var(--slate-700);
    --text-strong: var(--quartz-100); --text-body: var(--quartz-200); --text-muted: var(--galena);
    --text-faint: var(--quartz-400); --text-on-gold: #1C1A12;
    --danger: var(--iron-oxide); --danger-wash: rgba(161,75,51,.14);
    --font-slab: 'Zilla Slab', Georgia, serif;
    --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
    --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
    --dur-state: 180ms; --dur-move: 280ms; --dur-scene: 480ms; --rise: 8px; --stagger: 32ms;
    --ease-pan: cubic-bezier(0.45, 0, 0.15, 1);
    --ease-settle: linear(0, 0.3 12%, 0.55 24%, 0.73 37%, 0.85 50%, 0.93 64%, 0.975 80%, 1);
  }
  @property --odo {
    syntax: '<integer>';
    inherits: false;
    initial-value: 0;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    background: var(--bg-base); color: var(--text-body); font-family: var(--font-sans);
    font-size: 16px; line-height: 1.55;
  }

  /* Cross-document View Transitions opt-in, mirroring /report. Deliberate amendment from the
     M5 2-page direction-aware descend/ascend drift: with a 3rd page the direction implied by
     "/claim-office" alone is ambiguous (could be reached from / or /report), so this document
     uses a neutral root crossfade rather than a directional slide — the shared-element nav
     indicator (below) still carries the cross-page continuity. */
  @view-transition {
    navigation: auto;
  }
  @media (prefers-reduced-motion: no-preference) {
    ::view-transition-old(root) {
      animation: vt-root-fade-out var(--dur-move) var(--ease-pan) both;
    }
    ::view-transition-new(root) {
      animation: vt-root-fade-in var(--dur-move) var(--ease-pan) both;
    }
  }
  @keyframes vt-root-fade-out { to { opacity: 0; } }
  @keyframes vt-root-fade-in { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    ::view-transition-group(*),
    ::view-transition-old(*),
    ::view-transition-new(*) {
      animation-duration: 0.01ms !important;
    }
  }

  .report-main { min-width: 0; padding-bottom: 60px; }
  ${SHELL_STYLE}

  body::before {
    content: '';
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background-image:
      repeating-linear-gradient(0deg, color-mix(in oklab, var(--galena) 20%, transparent) 0 1px, transparent 1px 96px),
      repeating-linear-gradient(90deg, color-mix(in oklab, var(--galena) 14%, transparent) 0 1px, transparent 1px 96px);
    opacity: .22;
  }
  @keyframes survey-texture-drift {
    from { transform: translateY(0); }
    to   { transform: translateY(-48px); }
  }
  @supports (animation-timeline: scroll()) {
    @media (prefers-reduced-motion: no-preference) {
      body::before {
        animation: survey-texture-drift linear both;
        animation-timeline: scroll(root block);
      }
    }
  }

  .odo-real { display: inline; }
  .odo-anim { display: none; }
  @keyframes odo-count {
    to { --odo: var(--odo-final); }
  }

  .fade-in { display: inline-block; opacity: 1; }
  @media (prefers-reduced-motion: no-preference) {
    .fade-in {
      animation: metric-fade-in var(--dur-scene) var(--ease-settle) both;
    }
  }
  @keyframes metric-fade-in {
    from { opacity: 0; transform: translateY(var(--rise)); }
  }

  @supports (animation-timeline: view()) {
    @media (prefers-reduced-motion: no-preference) {
      .office-section {
        animation: section-rise linear both;
        animation-timeline: view();
        animation-range: entry 0% entry 35%;
      }
    }
  }
  @keyframes section-rise {
    from { opacity: 0; transform: translateY(var(--rise)); }
  }

  main { max-width: 880px; margin: 0 auto; padding: 40px 28px; }
  h1 {
    font-family: var(--font-slab); font-weight: 700; font-size: 30px; color: var(--text-strong);
    margin: 0 0 6px; letter-spacing: -.01em;
  }
  .eyebrow {
    font-family: var(--font-mono); font-size: 11px; letter-spacing: .22em; text-transform: uppercase;
    color: var(--text-muted); display: block; margin-bottom: 10px;
  }
  .page-sub { color: var(--text-muted); font-size: 13.5px; margin: 0 0 36px; }
  .office-section {
    background: var(--surface-card); border: 1px solid var(--line); border-radius: 14px;
    padding: 22px 24px; margin-bottom: 22px;
    contain: content;
  }
  .office-section h2 {
    font-family: var(--font-slab); font-weight: 700; font-size: 20px; color: var(--text-strong);
    margin: 0 0 4px;
  }
  .office-section .gloss { color: var(--text-muted); font-size: 13px; margin: 0 0 18px; }
  .office-section h3 {
    font-family: var(--font-sans); font-weight: 600; font-size: 14px; color: var(--text-strong);
    margin: 18px 0 8px;
  }
  .empty { color: var(--text-faint); font-size: 13.5px; margin: 0; }
  .office-subhead { font-size: 12px; letter-spacing: .07em; text-transform: uppercase; color: var(--text-faint); margin: 20px 0 6px; font-weight: 600; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px 18px; margin: 4px 0 12px; }
  .chip-stage { font-size: 12.5px; color: var(--text-body); font-family: var(--font-mono); }
  .chip-strike {
    font-family: var(--font-mono); font-size: 12px; letter-spacing: .04em;
    color: var(--placer-gold); font-weight: 700;
  }
  .metric-sub { color: var(--text-muted); font-size: 12.5px; margin: 4px 0; }
  .office-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .office-table th {
    text-align: left; font-family: var(--font-mono); font-size: 10.5px; letter-spacing: .12em;
    text-transform: uppercase; color: var(--text-faint); font-weight: 500; padding: 0 10px 8px 0;
    border-bottom: 1px solid var(--line);
  }
  .office-table td { padding: 8px 10px 8px 0; border-bottom: 1px solid var(--line); color: var(--text-body); }
  .office-table td.num, .office-table th.num { text-align: right; font-family: var(--font-mono); }
  .office-table a { color: var(--verdigris); }
  .company-index { padding: 0; overflow: hidden; }
  .company-index > h2, .company-index > .gloss { margin-left: 24px; margin-right: 24px; }
  .company-index > h2 { margin-top: 22px; }
  .company-card { border-top: 1px solid var(--line); }
  .company-card > summary { cursor: pointer; list-style: none; padding: 15px 24px; display: flex; align-items: center; justify-content: space-between; gap: 18px; }
  .company-card > summary::-webkit-details-marker { display: none; }
  .company-card > summary::after { content: '+'; color: var(--verdigris); font-family: var(--font-mono); }
  .company-card[open] > summary::after { content: '−'; }
  .company-card > summary:focus-visible { outline: 2px solid var(--verdigris); outline-offset: -2px; }
  .company-name { color: var(--text-strong); font-family: var(--font-slab); font-size: 17px; font-weight: 700; }
  .company-summary { color: var(--text-muted); font-size: 12px; text-align: right; }
  .company-activity { white-space: nowrap; }
  .company-detail { padding: 0 24px 20px; }
  @media (max-width: 600px) { .company-card > summary { align-items: flex-start; } .company-summary { text-align: left; } }
`;

export function renderClaimOfficeHtml(data) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
${renderPwaHeadTags({ title: 'Claim Office — Prospect' })}
<style>${STYLE}</style>
</head>
<body>
${renderTopBar('/claim-office')}
<div class="report-shell">
  ${renderSidebarNav('/claim-office')}
  <main class="report-main">
    <span class="eyebrow">Prospect</span>
    <h1>Claim Office</h1>
    <p class="page-sub">A read-only survey of companies and the contacts on file — no interaction required, every value below is in the raw page.</p>
    ${companiesSection(data.companies)}
    ${recurringContactsSection(data.recurring_contacts)}
    ${selectionSection(data.selection)}
  </main>
</div>
${renderTabBar('/claim-office')}
</body>
</html>
`;
}
