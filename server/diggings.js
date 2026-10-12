import { renderPwaHeadTags } from './pwaHead.js';
import { renderSidebarNav, renderTopBar, renderTabBar, SHELL_STYLE } from './shell.js';
import { getResolvedDeadlineIds } from './claimEvents.js';

const CLAIM_EVENT_KIND_GLOSS = {
  assessment_requested: 'Assessment requested',
  assessment_completed: 'Assessment completed',
  recruiter_contact: 'Recruiter contact',
  employer_email: 'Employer email',
  status_check: 'Status check',
  deadline_resolved: 'Deadline resolved',
};

const STAGE_NUGGET_WEIGHT = {
  Showings: 8,
  Staked: 16,
  'Working the Vein': 34,
  Strike: 40,
};

function dayDistance(fromDate, toDate) {
  if (!fromDate || !toDate) return null;
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

function urgencyWeight(bucket, dateStr, todayStr) {
  const distance = dayDistance(todayStr, dateStr);
  if (bucket === 'overdue') {
    const daysOverdue = distance == null ? 0 : Math.max(0, -distance);
    return { delta: 30 + Math.min(daysOverdue, 10), label: `Overdue${daysOverdue ? ` ${daysOverdue}d` : ''}` };
  }
  if (bucket === 'today') return { delta: 28, label: 'Due today' };
  if (bucket === 'upcoming') {
    const daysUntil = distance == null ? 7 : Math.max(1, distance);
    return { delta: Math.max(8, 24 - ((daysUntil - 1) * 2)), label: `Due in ${daysUntil}d` };
  }
  return { delta: 4, label: 'Unscheduled' };
}

function investedTimeWeight(minutes) {
  if (minutes == null || minutes === '' || !Number.isFinite(Number(minutes)) || Number(minutes) < 0) {
    return { delta: 0, label: 'Time invested unknown' };
  }
  const value = Number(minutes);
  if (value <= 30) return { delta: 0, label: `Time invested · ${value}m` };
  if (value <= 60) return { delta: -1, label: `Time invested · ${value}m` };
  if (value <= 120) return { delta: -2, label: `High time cost · ${value}m` };
  return { delta: -4, label: `Heavy time cost · ${value}m` };
}

export function calculateNuggetWeight(item, todayStr) {
  const urgency = urgencyWeight(item.bucket, item.date, todayStr);
  const stageDelta = STAGE_NUGGET_WEIGHT[item.stage] || 0;
  const effort = investedTimeWeight(item.application_minutes);
  const factors = [
    { key: 'urgency', label: urgency.label, delta: urgency.delta },
    { key: 'stage', label: item.stage || 'Unknown stage', delta: stageDelta },
    { key: 'effort', label: effort.label, delta: effort.delta },
  ];

  const gut = Number(item.gut_prediction);
  if (item.gut_prediction != null && Number.isFinite(gut)) {
    const clampedGut = Math.max(0, Math.min(1, gut));
    factors.push({
      key: 'gut',
      label: `Gut odds ${Math.round(clampedGut * 100)}%`,
      delta: Math.round(clampedGut * 20),
    });
  }
  if (Number(item.referral) === 1) factors.push({ key: 'referral', label: 'Referral', delta: 8 });
  if (Number(item.top_applicant_match) === 1) factors.push({ key: 'top_match', label: 'Top-applicant match', delta: 8 });
  if (Number(item.actively_reviewing) === 1) factors.push({ key: 'active', label: 'Actively reviewing', delta: 6 });

  const rawWeight = factors.reduce((sum, factor) => sum + factor.delta, 0);
  return {
    weight: Math.max(0, Math.min(100, rawWeight)),
    raw_weight: rawWeight,
    factors,
  };
}

function payloadNoteText(payload) {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    if (parsed && typeof parsed === 'object' && typeof parsed.note === 'string') return parsed.note;
  } catch { /* not JSON */ }
  return String(payload);
}

function esc(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function getTodayString(todayOpt) {
  if (todayOpt) {
    if (typeof todayOpt === 'string') {
      const match = todayOpt.match(/^\d{4}-\d{2}-\d{2}/);
      if (match) return match[0];
    }
    if (todayOpt instanceof Date && !isNaN(todayOpt)) {
      return todayOpt.toISOString().slice(0, 10);
    }
  }
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

function extractDateStr(val) {
  if (!val) return null;
  const str = String(val).trim();
  if (!str) return null;
  const match = str.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function formatUrgency(bucket, dateStr) {
  if (bucket === 'overdue') return dateStr ? `Overdue (${dateStr})` : 'Overdue';
  if (bucket === 'today') return 'Due today';
  if (bucket === 'upcoming') return dateStr ? `Upcoming (${dateStr})` : 'Upcoming';
  return 'Unscheduled';
}

export function getDailyDiggings(db, options = {}) {
  const todayStr = getTodayString(options.today);

  // 1. Event Deadlines (Group 1 - Highest Priority)
  const eventRows = db.prepare(`
    SELECT
      ce.id AS id,
      ce.id AS event_id,
      ce.claim_id AS claim_id,
      ce.kind AS kind,
      ce.occurred_at AS occurred_at,
      ce.due_at AS due_at,
      ce.payload AS payload,
      c.stage AS stage,
      COALESCE(comp.name, l.company, 'Unknown Company') AS company,
      COALESCE(l.role, 'Unknown Role') AS role
    FROM claim_events ce
    JOIN claims c ON c.id = ce.claim_id
    JOIN listings l ON l.id = c.listing_id
    LEFT JOIN companies comp ON comp.id = l.company_id
    WHERE LOWER(c.stage) != 'tailings'
      AND (
        (ce.due_at IS NOT NULL AND TRIM(ce.due_at) != '')
        OR ce.kind = 'deadline_resolved'
      )
  `).all();
  const resolvedEventIds = getResolvedDeadlineIds(eventRows);

  const eventDeadlines = { overdue: [], today: [], upcoming: [] };
  let eventsCount = 0;

  for (const r of eventRows) {
    if (r.kind === 'deadline_resolved' || resolvedEventIds.has(Number(r.event_id))) continue;
    const dateStr = extractDateStr(r.due_at);
    let bucket = 'upcoming';
    if (dateStr < todayStr) bucket = 'overdue';
    else if (dateStr === todayStr) bucket = 'today';

    const item = {
      type: 'event',
      id: r.event_id,
      event_id: r.event_id,
      claim_id: r.claim_id,
      company: r.company,
      role: r.role,
      stage: r.stage,
      kind: r.kind,
      kind_gloss: CLAIM_EVENT_KIND_GLOSS[r.kind] || r.kind,
      occurred_at: r.occurred_at,
      due_at: r.due_at,
      date: dateStr,
      payload: r.payload,
      note: payloadNoteText(r.payload),
      bucket,
      urgency: formatUrgency(bucket, dateStr),
    };
    eventDeadlines[bucket].push(item);
    eventsCount++;
  }

  const sortEvents = (list) => {
    list.sort((a, b) => {
      const cmpDate = (a.date || '').localeCompare(b.date || '');
      if (cmpDate !== 0) return cmpDate;
      if (a.claim_id !== b.claim_id) return a.claim_id - b.claim_id;
      return a.event_id - b.event_id;
    });
  };
  sortEvents(eventDeadlines.overdue);
  sortEvents(eventDeadlines.today);
  sortEvents(eventDeadlines.upcoming);

  // 2. Self-Authored Next Actions (Group 2)
  const actionRows = db.prepare(`
    SELECT
      c.id AS claim_id,
      c.stage AS stage,
      c.next_action AS next_action,
      c.next_action_date AS next_action_date,
      c.application_minutes AS application_minutes,
      c.gut_prediction AS gut_prediction,
      c.referral AS referral,
      l.top_applicant_match AS top_applicant_match,
      l.actively_reviewing AS actively_reviewing,
      COALESCE(comp.name, l.company, 'Unknown Company') AS company,
      COALESCE(l.role, 'Unknown Role') AS role
    FROM claims c
    JOIN listings l ON l.id = c.listing_id
    LEFT JOIN companies comp ON comp.id = l.company_id
    WHERE LOWER(c.stage) != 'tailings'
      AND (
        (c.next_action IS NOT NULL AND TRIM(c.next_action) != '')
        OR
        (c.next_action_date IS NOT NULL AND TRIM(c.next_action_date) != '')
      )
  `).all();

  const nextActions = { overdue: [], today: [], upcoming: [], unscheduled: [] };
  let actionsCount = 0;

  for (const r of actionRows) {
    const actionText = (r.next_action && r.next_action.trim()) ? r.next_action.trim() : 'Review next action';
    const dateStr = extractDateStr(r.next_action_date);
    let bucket = 'unscheduled';
    if (dateStr) {
      if (dateStr < todayStr) bucket = 'overdue';
      else if (dateStr === todayStr) bucket = 'today';
      else bucket = 'upcoming';
    }

    const item = {
      type: 'action',
      id: r.claim_id,
      claim_id: r.claim_id,
      company: r.company,
      role: r.role,
      stage: r.stage,
      action: actionText,
      action_date: r.next_action_date,
      application_minutes: r.application_minutes,
      gut_prediction: r.gut_prediction,
      referral: r.referral,
      top_applicant_match: r.top_applicant_match,
      actively_reviewing: r.actively_reviewing,
      date: dateStr,
      bucket,
      urgency: formatUrgency(bucket, dateStr),
    };
    const nugget = calculateNuggetWeight(item, todayStr);
    item.nugget_weight = nugget.weight;
    item.nugget_raw_weight = nugget.raw_weight;
    item.nugget_factors = nugget.factors;
    nextActions[bucket].push(item);
    actionsCount++;
  }

  const sortActions = (list) => {
    list.sort((a, b) => {
      if (a.nugget_weight !== b.nugget_weight) return b.nugget_weight - a.nugget_weight;
      const cmpDate = (a.date || '').localeCompare(b.date || '');
      if (cmpDate !== 0) return cmpDate;
      return a.claim_id - b.claim_id;
    });
  };
  sortActions(nextActions.overdue);
  sortActions(nextActions.today);
  sortActions(nextActions.upcoming);
  sortActions(nextActions.unscheduled);

  const overdueTotal = eventDeadlines.overdue.length + nextActions.overdue.length;
  const todayTotal = eventDeadlines.today.length + nextActions.today.length;
  const upcomingTotal = eventDeadlines.upcoming.length + nextActions.upcoming.length;
  const unscheduledTotal = nextActions.unscheduled.length;
  const urgentAttention = [
    ...eventDeadlines.overdue,
    ...eventDeadlines.today,
    ...nextActions.overdue,
    ...nextActions.today,
  ];
  const nextUp = urgentAttention.length === 0
    ? [
        ...eventDeadlines.upcoming.slice(0, 1),
        ...nextActions.upcoming.slice(0, 2),
        ...nextActions.unscheduled.slice(0, 1),
      ].slice(0, 3)
    : urgentAttention.slice(0, 5);

  return {
    today: todayStr,
    eventDeadlines,
    nextActions,
    attention: nextUp,
    counts: {
      eventDeadlinesCount: eventsCount,
      nextActionsCount: actionsCount,
      overdueCount: overdueTotal,
      todayCount: todayTotal,
      upcomingCount: upcomingTotal,
      unscheduledCount: unscheduledTotal,
      totalCount: eventsCount + actionsCount,
    },
  };
}

const STYLE = `
  :root {
    --wet-slate: #1B2327; --placer-gold: #CDA349; --verdigris: #4C8C78; --iron-oxide: #A14B33;
    --slate-900: #10171A; --slate-850: #161E22; --slate-800: #1B2327; --slate-750: #212B2F; --slate-700: #283338;
    --line: #2E383C; --galena: #6E767B;
    --quartz-100: #F3EFE6; --quartz-200: #E7E1D3; --quartz-400: #9AA1A4;
    --bg-base: var(--slate-800); --surface-card: var(--slate-750); --surface-raised: var(--slate-700);
    --text-strong: var(--quartz-100); --text-body: var(--quartz-200); --text-muted: var(--galena); --text-faint: var(--quartz-400);
    --font-slab: 'Zilla Slab', Georgia, serif;
    --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
    --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg-base); color: var(--text-body); font-family: var(--font-sans); font-size: 16px; line-height: 1.55; }

  @view-transition { navigation: auto; }

  .report-main { min-width: 0; padding: 40px 28px 60px; max-width: 900px; margin: 0 auto; width: 100%; }
  ${SHELL_STYLE}

  h1 { font-family: var(--font-slab); font-weight: 700; font-size: 30px; color: var(--text-strong); margin: 0 0 6px; }
  .eyebrow { font-family: var(--font-mono); font-size: 11px; letter-spacing: .22em; text-transform: uppercase; color: var(--text-muted); display: block; margin-bottom: 10px; }
  .page-sub { color: var(--text-muted); font-size: 13.5px; margin: 0 0 28px; }

  .summary-chips { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 24px; }
  .chip-stat { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px; font-family: var(--font-mono); font-size: 11.5px; color: var(--text-muted); background: var(--surface-card); }
  .chip-stat strong { color: var(--text-strong); }

  .diggings-section { background: var(--surface-card); border: 1px solid var(--line); border-radius: 14px; padding: 22px 24px; margin-bottom: 24px; }
  .attention-section { border-color: rgba(205,163,73,.45); }
  .attention-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
  .attention-card { display: block; border: 1px solid var(--line); border-radius: 10px; padding: 13px 14px; background: var(--surface-raised); color: inherit; text-decoration: none; }
  .attention-card:hover, .attention-card:focus-visible { border-color: var(--verdigris); outline: none; }
  .attention-kicker { font-family: var(--font-mono); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--placer-gold); }
  .attention-title { color: var(--text-strong); font-weight: 600; font-size: 13.5px; margin-top: 4px; }
  .attention-meta { color: var(--text-muted); font-size: 12px; margin-top: 3px; }
  .diggings-section h2 { font-family: var(--font-slab); font-size: 20px; color: var(--text-strong); margin: 0 0 4px; }
  .gloss { color: var(--text-muted); font-size: 12.5px; margin: 0 0 18px; }
  .empty { color: var(--text-muted); font-size: 13px; font-style: italic; margin: 8px 0; }

  .bucket-header { font-family: var(--font-mono); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--text-muted); margin: 18px 0 10px; padding-bottom: 4px; border-bottom: 1px dashed var(--line); }
  .bucket-header:first-of-type { margin-top: 8px; }

  .diggings-list { display: flex; flex-direction: column; gap: 10px; }
  .diggings-item {
    background: var(--surface-raised); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px;
    display: flex; flex-direction: column; gap: 6px;
  }
  .item-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .item-title { font-size: 14.5px; font-weight: 600; color: var(--text-strong); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .claim-link { color: var(--placer-gold); text-decoration: none; font-family: var(--font-mono); font-size: 12px; font-weight: 600; }
  .claim-link:hover { text-decoration: underline; }

  .urgency-tag { font-family: var(--font-mono); font-size: 11px; padding: 2px 7px; border-radius: 4px; font-weight: 500; }
  .urgency-overdue { background: rgba(161,75,51,.25); color: #f28b74; border: 1px solid rgba(161,75,51,.4); }
  .urgency-today { background: rgba(205,163,73,.2); color: var(--placer-gold); border: 1px solid rgba(205,163,73,.4); }
  .urgency-upcoming { background: rgba(76,140,120,.2); color: #7cc9b2; border: 1px solid rgba(76,140,120,.4); }
  .urgency-unscheduled { background: rgba(110,118,123,.2); color: var(--text-muted); border: 1px solid var(--line); }

  .stage-tag { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .05em; }
  .priority-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
  .hard-gate {
    font-family: var(--font-mono); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase;
    border: 1px solid rgba(205,163,73,.55); color: var(--placer-gold); border-radius: 999px; padding: 2px 8px;
  }
  .nugget-weight {
    font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: .05em;
    border: 1px solid rgba(205,163,73,.55); color: var(--placer-gold); border-radius: 999px; padding: 3px 9px;
  }
  .nugget-factor {
    font-family: var(--font-mono); font-size: 10px; color: var(--text-faint);
    border: 1px solid var(--line); background: var(--bg-base); border-radius: 999px; padding: 2px 7px;
  }
  .nugget-factor.negative { color: #f28b74; }

  .item-meta { font-size: 13px; color: var(--text-body); }
  .item-note { font-size: 12px; color: var(--text-muted); font-style: italic; }

  .item-controls { display: flex; align-items: center; gap: 12px; margin-top: 6px; padding-top: 8px; border-top: 1px solid var(--line); flex-wrap: wrap; }
  .btn-mark-done {
    background: var(--verdigris); color: white; border: none; border-radius: 6px; padding: 5px 12px;
    font-family: var(--font-sans); font-size: 12px; font-weight: 500; cursor: pointer; transition: opacity .15s;
  }
  .btn-mark-done:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-resolve-gate {
    background: transparent; color: var(--placer-gold); border: 1px solid rgba(205,163,73,.55);
    border-radius: 6px; padding: 6px 12px; font-family: var(--font-sans); font-size: 12px;
    font-weight: 600; cursor: pointer;
  }
  .btn-resolve-gate:disabled { opacity: .5; cursor: not-allowed; }
  .select-resolution {
    min-height: 32px; background: var(--bg-base); color: var(--text-strong); border: 1px solid var(--line);
    border-radius: 6px; padding: 4px 8px; font-family: var(--font-sans); font-size: 12px;
  }
  .input-reschedule {
    background: var(--bg-base); color: var(--text-strong); border: 1px solid var(--line); border-radius: 6px;
    padding: 4px 8px; font-family: var(--font-mono); font-size: 11.5px; color-scheme: dark;
  }
`;

function renderEventItem(item) {
  return `
    <div class="diggings-item" data-event-id="${item.event_id}">
      <div class="item-top">
        <div class="item-title">
          <span>${esc(item.kind_gloss)}</span>
          <a href="/?claim=${item.claim_id}" class="claim-link">Claim #${item.claim_id}</a>
        </div>
        <span class="urgency-tag urgency-${item.bucket}">${esc(item.urgency)}</span>
      </div>
      <div class="item-meta">
        <strong>${esc(item.company)}</strong> · ${esc(item.role)} <span class="stage-tag">(${esc(item.stage)})</span>
      </div>
      <div class="priority-row" aria-label="Employer deadline priority">
        <span class="hard-gate">Hard gate</span>
        <span class="nugget-factor">Employer-imposed deadline</span>
      </div>
      ${item.note ? `<div class="item-note">${esc(item.note)}</div>` : ''}
      <div class="item-controls">
        <select class="select-resolution" data-event-id="${item.event_id}" aria-label="Resolution reason">
          <option value="completed">Completed</option>
          <option value="no_longer_required">No longer required</option>
          <option value="superseded">Superseded</option>
        </select>
        <button type="button" class="btn-resolve-gate" data-event-id="${item.event_id}" data-claim-id="${item.claim_id}">
          Resolve gate
        </button>
      </div>
    </div>
  `;
}

function renderActionItem(item) {
  return `
    <div class="diggings-item" data-claim-id="${item.claim_id}">
      <div class="item-top">
        <div class="item-title">
          <span>${esc(item.action)}</span>
          <a href="/?claim=${item.claim_id}" class="claim-link">Claim #${item.claim_id}</a>
        </div>
        <span class="urgency-tag urgency-${item.bucket}">${esc(item.urgency)}</span>
      </div>
      <div class="item-meta">
        <strong>${esc(item.company)}</strong> · ${esc(item.role)} <span class="stage-tag">(${esc(item.stage)})</span>
      </div>
      <div class="priority-row" aria-label="Nugget weight ${item.nugget_weight}">
        <span class="nugget-weight">Nugget ${item.nugget_weight}</span>
        ${(item.nugget_factors || []).map((factor) => `<span class="nugget-factor${factor.delta < 0 ? ' negative' : ''}">${esc(factor.label)} ${factor.delta >= 0 ? '+' : ''}${factor.delta}</span>`).join('')}
      </div>
      <div class="item-controls">
        <button type="button" class="btn-mark-done" data-claim-id="${item.claim_id}">Mark done</button>
        <label style="font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); display: inline-flex; align-items: center; gap: 6px;">
          Reschedule:
          <input type="date" class="input-reschedule" data-claim-id="${item.claim_id}" value="${esc(item.action_date || '')}">
        </label>
      </div>
    </div>
  `;
}

function renderBucketSection(title, items, renderFn) {
  if (!items || items.length === 0) return '';
  return `
    <div class="bucket-group">
      <div class="bucket-header">${esc(title)}</div>
      <div class="diggings-list">
        ${items.map(renderFn).join('')}
      </div>
    </div>
  `;
}

function renderAttentionItem(item) {
  const label = item.type === 'event'
    ? (item.kind_gloss || 'Employer deadline')
    : (item.action || 'Review next action');
  return `
    <a class="attention-card" href="/?claim=${item.claim_id}">
      <div class="attention-kicker">${esc(item.urgency)} · Claim #${item.claim_id}</div>
      <div class="attention-title">${esc(label)}</div>
      <div class="attention-meta">${esc(item.company)} · ${esc(item.role)}</div>
    </a>`;
}

export function renderDailyDiggingsHtml(data) {
  const { eventDeadlines, nextActions, attention = [], counts, today } = data;

  const eventOverdue = renderBucketSection('Overdue', eventDeadlines.overdue, renderEventItem);
  const eventToday = renderBucketSection('Due today', eventDeadlines.today, renderEventItem);
  const eventUpcoming = renderBucketSection('Upcoming', eventDeadlines.upcoming, renderEventItem);
  const hasEvents = eventOverdue || eventToday || eventUpcoming;

  const actionOverdue = renderBucketSection('Overdue', nextActions.overdue, renderActionItem);
  const actionToday = renderBucketSection('Due today', nextActions.today, renderActionItem);
  const actionUpcoming = renderBucketSection('Upcoming', nextActions.upcoming, renderActionItem);
  const actionUnscheduled = renderBucketSection('Unscheduled', nextActions.unscheduled, renderActionItem);
  const hasActions = actionOverdue || actionToday || actionUpcoming || actionUnscheduled;

  return `<!DOCTYPE html>
<html lang="en">
<head>
${renderPwaHeadTags({ title: "The Day's Diggings — Prospect" })}
<style>${STYLE}</style>
</head>
<body>
${renderTopBar('/diggings')}
<div class="report-shell">
  ${renderSidebarNav('/diggings')}
  <main class="report-main">
    <span class="eyebrow">Prospect</span>
    <h1>The Day's Diggings</h1>
    <p class="page-sub">Hard deadlines first, then transparent Nugget-weight priorities (as of ${esc(today)}).</p>

    <div class="summary-chips">
      <span class="chip-stat">Queue total: <strong>${counts.totalCount}</strong></span>
      <span class="chip-stat">Overdue: <strong>${counts.overdueCount}</strong></span>
      <span class="chip-stat">Due today: <strong>${counts.todayCount}</strong></span>
      <span class="chip-stat">Upcoming: <strong>${counts.upcomingCount}</strong></span>
      <span class="chip-stat">Unscheduled: <strong>${counts.unscheduledCount}</strong></span>
    </div>

    <section class="diggings-section attention-section">
      <h2>Needs attention</h2>
      <p class="gloss">A derived focus queue only — Prospect never moves a claim or invents an action</p>
      ${attention.length
        ? `<div class="attention-grid">${attention.map(renderAttentionItem).join('')}</div>`
        : '<p class="empty">Nothing needs attention right now. New employer gates and your next actions will appear here.</p>'}
    </section>

    <section class="diggings-section">
      <h2>Event Deadlines</h2>
      <p class="gloss">Employer deadlines stay immutable; resolving one appends a separate timeline event</p>
      ${hasEvents ? `${eventOverdue}${eventToday}${eventUpcoming}` : '<p class="empty">No event deadlines pending.</p>'}
    </section>

    <section class="diggings-section">
      <h2>Next Actions</h2>
      <p class="gloss">Self-authored actions ranked within each urgency bucket by visible Nugget factors</p>
      ${hasActions ? `${actionOverdue}${actionToday}${actionUpcoming}${actionUnscheduled}` : '<p class="empty">No next actions scheduled.</p>'}
    </section>
  </main>
</div>
${renderTabBar('/diggings')}
<script>
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-resolve-gate');
  if (!btn) return;
  const claimId = btn.dataset.claimId;
  const eventId = btn.dataset.eventId;
  const select = document.querySelector('.select-resolution[data-event-id="' + eventId + '"]');
  const reason = select ? select.value : 'completed';
  btn.disabled = true;
  if (select) select.disabled = true;
  try {
    const res = await fetch('/api/claims/' + claimId + '/events/' + eventId + '/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    if (res.ok) location.reload();
    else {
      btn.disabled = false;
      if (select) select.disabled = false;
    }
  } catch (err) {
    btn.disabled = false;
    if (select) select.disabled = false;
  }
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-mark-done');
  if (!btn) return;
  const claimId = btn.dataset.claimId;
  btn.disabled = true;
  try {
    const res = await fetch('/api/claims/' + claimId, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ next_action: null, next_action_date: null })
    });
    if (res.ok) {
      location.reload();
    } else {
      btn.disabled = false;
    }
  } catch (err) {
    btn.disabled = false;
  }
});

document.addEventListener('change', async (e) => {
  const input = e.target.closest('.input-reschedule');
  if (!input) return;
  const claimId = input.dataset.claimId;
  const newDate = input.value || null;
  input.disabled = true;
  try {
    const res = await fetch('/api/claims/' + claimId, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ next_action_date: newDate })
    });
    if (res.ok) {
      location.reload();
    } else {
      input.disabled = false;
    }
  } catch (err) {
    input.disabled = false;
  }
});
</script>
</body>
</html>
`;
}
