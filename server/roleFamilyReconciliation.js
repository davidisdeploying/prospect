// §5.3 role_family/job_family × role_hint reconciliation (menu item C). Read-only: cross-checks
// three independent "what kind of role is this" signals without writing to any of them —
//   * job_family    — deterministic, title-only classifier (jobFamily.js), populated at capture.
//   * role_family   — locked §1.2 enum, LinkedIn-source-supplied or NULL (H8(e): NULL is the
//                      honest value on SDUI captures, never guessed/derived into this column).
//   * role_hint     — free-text, LLM-derived from description prose (listings.parsed.llm_parse.
//                      role_hint, server/llmParse.js).
// Reconciliation runs role_hint through the SAME deterministic classifyJobFamily() rules used
// for job_family — no new LLM judgment is introduced, keeping jobFamily.js's own "no LLM" scope
// intact (the LLM already ran once, upstream, to produce the role_hint string; classifying that
// string is pattern-matching, same as classifying a title). Nothing here is persisted: it is
// computed fresh on every report read, so there is no new column, no migration, and no way for
// this to drift out of sync with the rows it describes.
import { classifyJobFamily, UNCATEGORIZED } from './jobFamily.js';

function hasColumn(db, table, name) {
  return db.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info(?) WHERE name = ?`).get(table, name).n > 0;
}

function extractRoleHint(parsedJson) {
  if (!parsedJson) return null;
  let parsed;
  try {
    parsed = JSON.parse(parsedJson);
  } catch {
    return null;
  }
  return parsed?.llm_parse?.role_hint ?? null;
}

export function computeReconciliation(db) {
  if (!hasColumn(db, 'listings', 'job_family')) {
    return { items: [], summary: { total: 0, comparable: 0, agree: 0, disagree: 0, role_family_supplied: 0 } };
  }

  const rows = db.prepare(`SELECT id, role, job_family, role_family, parsed FROM listings ORDER BY id`).all();

  const items = rows.map((row) => {
    const roleHint = extractRoleHint(row.parsed);
    const roleHintFamily = roleHint ? classifyJobFamily(roleHint) : null;
    const jobFamily = row.job_family ?? UNCATEGORIZED;
    // null = nothing to compare (no role_hint yet); otherwise a straight string match against
    // the title-derived family, agreement included when both independently land on uncategorized.
    const agrees = roleHintFamily == null ? null : roleHintFamily === jobFamily;
    return {
      id: row.id,
      role: row.role,
      job_family: jobFamily,
      role_family: row.role_family ?? null,
      role_hint: roleHint,
      role_hint_family: roleHintFamily,
      agrees,
    };
  });

  const comparable = items.filter((i) => i.agrees !== null);
  const agree = comparable.filter((i) => i.agrees).length;

  return {
    items,
    summary: {
      total: items.length,
      comparable: comparable.length,
      agree,
      disagree: comparable.length - agree,
      role_family_supplied: items.filter((i) => i.role_family != null).length,
    },
  };
}
