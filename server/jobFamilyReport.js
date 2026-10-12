import { ALL_STAGES } from '../app/src/stages.js';
import { computeReconciliation } from './roleFamilyReconciliation.js';

// §4.7 Ore Types — read-only distribution + per-family funnel over listings.job_family
// (populated by §5.2.4's classifyJobFamily, server/jobFamily.js — untouched here). Every
// query below is a SELECT; nothing here mutates a row.

function computeDistribution(db) {
  return db.prepare(`
    SELECT COALESCE(l.job_family, 'uncategorized') AS job_family, COUNT(*) AS n
    FROM claims c
    JOIN listings l ON l.id = c.listing_id
    GROUP BY 1
    ORDER BY n DESC, job_family
  `).all().map((r) => ({ job_family: r.job_family, count: r.n }));
}

// Ever-reached counts per family, derived from the append-only stage_transitions log (mirrors
// huntReport.js's computeFunnel — never claims.stage, which only holds the current stage).
function computeFunnel(db, families) {
  const rows = db.prepare(`
    SELECT COALESCE(l.job_family, 'uncategorized') AS job_family, st.to_stage, COUNT(DISTINCT st.claim_id) AS n
    FROM stage_transitions st
    JOIN claims c ON c.id = st.claim_id
    JOIN listings l ON l.id = c.listing_id
    GROUP BY 1, st.to_stage
  `).all();

  const byFamily = new Map();
  for (const row of rows) {
    if (!byFamily.has(row.job_family)) byFamily.set(row.job_family, new Map());
    byFamily.get(row.job_family).set(row.to_stage, row.n);
  }

  const stages = ALL_STAGES.map(({ key, gloss }) => ({ key, gloss }));
  const rowsOut = families.map((job_family) => {
    const byStage = byFamily.get(job_family) || new Map();
    const counts = {};
    for (const { key } of stages) counts[key] = byStage.get(key) || 0;
    return { job_family, counts };
  });

  return { stages, rows: rowsOut };
}

function hasJobFamilyColumn(db) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM pragma_table_info('listings') WHERE name='job_family'
  `).get().n > 0;
}

export function computeJobFamilyReport(db) {
  if (!hasJobFamilyColumn(db)) {
    const stages = ALL_STAGES.map(({ key, gloss }) => ({ key, gloss }));
    return { distribution: [], funnel: { stages, rows: [] }, reconciliation: computeReconciliation(db) };
  }
  const distribution = computeDistribution(db);
  const funnel = computeFunnel(db, distribution.map((d) => d.job_family));
  return { distribution, funnel, reconciliation: computeReconciliation(db) };
}
