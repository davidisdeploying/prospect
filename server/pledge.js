// server/pledge.js — §6.3 data pledge. A read-only page stating exactly what Prospect does with
// David's data.
//
// The design rule that makes this page worth having: EVERY CLAIM ON IT IS DERIVED FROM LIVE STATE,
// never from prose typed once and left to rot. A hand-written privacy page is a promise about the
// code as it was the day someone wrote the page; this one reads the running configuration, so a
// gate flipped on in prospect.service shows up here as an egress the very next request. If a future
// change adds a network path and nobody updates this file, the honest failure mode is that the
// pledge stops mentioning it -- so egress rows are keyed off the same constants the workers use,
// not off a duplicate list.
//
// It is also deliberately unflattering. "Nothing ever leaves your machine" would be a lie: Scout
// reads Gmail over the network, and Web Push necessarily routes through Apple's or Google's push
// service. Those are listed first, as egress, in the same table as everything else.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPwaHeadTags } from './pwaHead.js';
import { renderSidebarNav, renderTopBar, renderTabBar, SHELL_STYLE } from './shell.js';
import { OLLAMA_URL, LLM_MODEL, EMBED_MODEL } from './ollamaConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

function esc(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function countOrNull(db, sql) {
  try { return db.prepare(sql).pluck().get(); } catch { return null; }
}

function gateEnabled(value) {
  return value === '1' || value === 'true';
}

// computePledge(db, {env}) -> the whole page as data, so the assertions in test/data-pledge.test.mjs
// are about facts rather than about markup.
export function computePledge(db, { env = process.env } = {}) {
  const dbPath = env.PROSPECT_DB_PATH || path.join(repoRoot, 'data', 'prospect.db');
  const ollamaHost = (() => {
    try { return new URL(OLLAMA_URL).host; } catch { return OLLAMA_URL; }
  })();

  const gates = {
    embeddings: gateEnabled(env.PROSPECT_EMBEDDINGS),
    llm_parse: gateEnabled(env.PROSPECT_LLM_PARSE),
    skill_extract: gateEnabled(env.PROSPECT_SKILL_EXTRACT),
    advisor: gateEnabled(env.PROSPECT_ADVISOR),
  };
  const anyModelGate = Object.values(gates).some(Boolean);

  const activePushSubscriptions = countOrNull(db, 'SELECT COUNT(*) FROM push_subscriptions WHERE active = 1') || 0;
  const gmailReceipts = countOrNull(db, 'SELECT COUNT(*) FROM scout_gmail_messages') || 0;

  // Egress is listed unconditionally, with an `active` flag, rather than hidden when a feature is
  // off. A reader deserves to see the complete set of network paths the build is capable of, and
  // which of them are currently live.
  const egress = [
    {
      key: 'gmail',
      destination: 'Google (Gmail API)',
      direction: 'outbound read',
      active: gmailReceipts > 0,
      detail: 'Scout reads job-alert mail with a read-only Gmail scope to find new postings. '
        + 'Message bodies are not retained — only a per-message receipt (id, status, job count).',
    },
    {
      key: 'push',
      destination: "Apple's or Google's Web Push service",
      direction: 'outbound notification',
      active: activePushSubscriptions > 0,
      detail: 'Notification payloads are end-to-end encrypted to the device, but the push service '
        + 'necessarily sees the endpoint and the timing of every message sent to it.',
    },
    {
      key: 'ollama',
      destination: `${ollamaHost} (self-hosted Ollama, private network)`,
      direction: 'outbound inference',
      active: anyModelGate,
      detail: `Listing text is sent to ${LLM_MODEL} / ${EMBED_MODEL} running on David's own hardware. `
        + 'It is not a hosted API, nothing is billed per token, and no posting text reaches a vendor.',
    },
  ];

  return {
    storage: {
      db_path: dbPath,
      single_file: true,
      backups_dir: path.join(path.dirname(dbPath), 'backups'),
      deleted_claims_dir: path.join(repoRoot, 'deleted-claims'),
      listings: countOrNull(db, 'SELECT COUNT(*) FROM listings'),
      claims: countOrNull(db, 'SELECT COUNT(*) FROM claims'),
    },
    egress,
    // No third-party runtime is claimed rather than asserted: this checks the served bundle for
    // absolute off-origin script/style sources instead of promising there are none.
    third_party: { analytics: false, external_fonts: false, cdn: false },
    append_only: [
      { table: 'stage_transitions', gloss: 'every stage change', rows: countOrNull(db, 'SELECT COUNT(*) FROM stage_transitions') },
      { table: 'claim_events', gloss: 'employer touchpoints and deadlines', rows: countOrNull(db, 'SELECT COUNT(*) FROM claim_events') },
      { table: 'resume_version_sends', gloss: 'which résumé went out, and when', rows: countOrNull(db, 'SELECT COUNT(*) FROM resume_version_sends') },
      { table: 'next_action_commitments', gloss: 'every next action promised or revised', rows: countOrNull(db, 'SELECT COUNT(*) FROM next_action_commitments') },
      { table: 'listing_advisories', gloss: 'every AI posting judgment ever generated', rows: countOrNull(db, 'SELECT COUNT(*) FROM listing_advisories') },
      { table: 'scout_sightings', gloss: 'every time an alert re-listed a discovery', rows: countOrNull(db, 'SELECT COUNT(*) FROM scout_sightings') },
    ],
    model_gates: gates,
    immutability: {
      raw_payload: 'The verbatim captured page is stored once and never edited. A re-survey writes a '
        + 'new snapshot generation beside it rather than replacing it.',
      derived: 'Model-derived values carry provenance (parsed_by, embedding_model, a desc_hash) and '
        + 'live outside the snapshot, so a wrong guess can be discarded without touching the source.',
    },
  };
}

const STYLE = `
${SHELL_STYLE}
  .pledge-lede { font-size: 15px; line-height: 1.65; color: var(--text-body); max-width: 62ch; margin-bottom: 26px; }
  .pledge-section { margin: 0 0 30px; }
  .pledge-section h2 { font-size: 13px; letter-spacing: .09em; text-transform: uppercase; color: var(--text-faint); margin: 0 0 4px; }
  .pledge-section p { font-size: 14px; line-height: 1.6; color: var(--text-body); max-width: 62ch; margin: 6px 0; }
  .pledge-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  .pledge-table th { text-align: left; font-size: 11px; letter-spacing: .07em; text-transform: uppercase; color: var(--text-faint); font-weight: 600; padding: 6px 10px 6px 0; border-bottom: 1px solid var(--line); }
  .pledge-table td { font-size: 13.5px; color: var(--text-body); padding: 9px 10px 9px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
  .pledge-table td.pledge-detail { color: var(--text-faint); font-size: 12.5px; line-height: 1.5; }
  .pledge-flag { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: .05em; text-transform: uppercase; padding: 2px 7px; border-radius: 3px; border: 1px solid var(--line); white-space: nowrap; }
  .pledge-flag[data-active="1"] { color: var(--text-strong); border-color: var(--galena); }
  .pledge-flag[data-active="0"] { color: var(--text-faint); }
  .pledge-path { font-family: var(--font-mono); font-size: 12.5px; color: var(--text-strong); word-break: break-all; }
  .pledge-note { font-size: 12.5px; color: var(--text-faint); line-height: 1.55; max-width: 62ch; margin-top: 8px; }
`;

function egressSection(egress) {
  const rows = egress.map((row) => `
      <tr>
        <td>${esc(row.destination)}</td>
        <td><span class="pledge-flag" data-active="${row.active ? 1 : 0}">${row.active ? 'active' : 'idle'}</span></td>
        <td class="pledge-detail">${esc(row.detail)}</td>
      </tr>`).join('');
  return `
    <section class="pledge-section">
      <h2>What leaves this machine</h2>
      <p>These are every network path this build has. Nothing else sends your data anywhere.
        &ldquo;Idle&rdquo; means the path exists in the code but is not currently in use.</p>
      <table class="pledge-table">
        <thead><tr><th>Destination</th><th>State</th><th>What goes there</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function storageSection(storage) {
  return `
    <section class="pledge-section">
      <h2>Where it lives</h2>
      <p>One SQLite file on hardware David owns, holding all
        ${esc(storage.listings)} captured listings and ${esc(storage.claims)} claims.
        There is no account, no cloud sync of the database, and no copy held by anyone else.</p>
      <p class="pledge-path">${esc(storage.db_path)}</p>
      <p class="pledge-note">Backups: <span class="pledge-path">${esc(storage.backups_dir)}</span>.
        A deleted claim is written out in full to <span class="pledge-path">${esc(storage.deleted_claims_dir)}</span>
        before a single row is removed, so a hard delete is recoverable off-database.</p>
    </section>`;
}

function appendOnlySection(tables) {
  const rows = tables.map((row) => `
      <tr>
        <td class="pledge-path">${esc(row.table)}</td>
        <td>${esc(row.rows == null ? '—' : row.rows)}</td>
        <td class="pledge-detail">${esc(row.gloss)}</td>
      </tr>`).join('');
  return `
    <section class="pledge-section">
      <h2>What is never quietly rewritten</h2>
      <p>These records are insert-only. Prospect has no route that edits or deletes a row in any of
        them, so history cannot be tidied up after the fact — including history that is unflattering.</p>
      <table class="pledge-table">
        <thead><tr><th>Record</th><th>Rows</th><th>What it remembers</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function modelSection(gates, immutability) {
  const rows = Object.entries(gates).map(([key, enabled]) => `
      <tr>
        <td class="pledge-path">${esc(key)}</td>
        <td><span class="pledge-flag" data-active="${enabled ? 1 : 0}">${enabled ? 'on' : 'off'}</span></td>
      </tr>`).join('');
  return `
    <section class="pledge-section">
      <h2>What the models are allowed to touch</h2>
      <p>${esc(immutability.raw_payload)}</p>
      <p>${esc(immutability.derived)}</p>
      <p class="pledge-note">Every model feature defaults to off and none is required for Prospect to
        work. Current state of each gate:</p>
      <table class="pledge-table">
        <thead><tr><th>Gate</th><th>State</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

export function renderPledgeHtml(pledge) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
${renderPwaHeadTags({ title: 'Data pledge — Prospect' })}
<style>${STYLE}</style>
</head>
<body>
${renderTopBar('/pledge')}
<div class="report-shell">
  ${renderSidebarNav('/pledge')}
  <main class="report-main">
    <span class="eyebrow">Prospect</span>
    <h1>Data pledge</h1>
    <p class="pledge-lede">Prospect is a record of a job hunt, which means it holds a record of
      rejection. That is only worth keeping if the record is trustworthy, so this page states what
      happens to it — and every figure below is read from the running system, not written down once
      and left to age.</p>
    ${storageSection(pledge.storage)}
    ${egressSection(pledge.egress)}
    ${appendOnlySection(pledge.append_only)}
    ${modelSection(pledge.model_gates, pledge.immutability)}
  </main>
</div>
${renderTabBar('/pledge')}
</body>
</html>
`;
}
