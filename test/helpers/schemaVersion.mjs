// Shared test helper: the schema head version, DERIVED rather than hand-pinned.
//
// Three tests used to hardcode "user_version = 17", then 18, then 19. Every migration meant editing
// three literals in three files that had nothing to do with the change, and a missed one failed
// with a bare "18 !== 17" that said nothing about the actual cause. Worse, a hand-pinned literal
// only ever proves someone remembered to update it.
//
// Deriving the expected head from migrations/ is strictly stronger: it fails when schema.sql and
// the migration chain disagree, which is the drift these assertions exist to catch (and which
// really happened -- see the H16 note at the top of schema.sql, where the file sat two versions
// behind for two migrations without anything failing).

import fs from 'node:fs';
import path from 'node:path';

export function migrationHeadVersion(repoRoot = process.cwd()) {
  const files = fs.readdirSync(path.join(repoRoot, 'migrations')).filter((f) => f.endsWith('.sql'));
  const versions = files.map((f) => Number(f.slice(0, 3))).filter(Number.isFinite);
  if (versions.length === 0) throw new Error('no migrations found');
  return Math.max(...versions);
}

export function schemaHeadVersion(repoRoot = process.cwd()) {
  const schemaSql = fs.readFileSync(path.join(repoRoot, 'schema.sql'), 'utf8');
  const match = schemaSql.match(/PRAGMA user_version = (\d+);/);
  if (!match) throw new Error('schema.sql has no PRAGMA user_version header');
  return Number(match[1]);
}
