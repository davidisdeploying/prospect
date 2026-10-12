import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { computeSkillTrends } from '../server/skillTrends.js';
import { loadVecExtension } from '../server/vecExtension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function addClaim(db, company, role) {
  const listingId = db.prepare(`
    INSERT INTO listings (source, company, role) VALUES ('Manual', ?, ?)
  `).run(company, role).lastInsertRowid;
  db.prepare(`INSERT INTO claims (listing_id) VALUES (?)`).run(listingId);
  return Number(listingId);
}

function addSkill(db, listingId, skill, tier = null) {
  db.prepare(`
    INSERT INTO listing_skills (listing_id, skill, tier, parsed_by)
    VALUES (?, ?, ?, 'llm')
  `).run(listingId, skill, tier);
}

function addProfile(db, label, skills) {
  const profileJson = JSON.stringify({ skills });
  db.prepare(`
    INSERT INTO scout_profile_versions (label, profile_json, profile_hash)
    VALUES (?, ?, ?)
  `).run(label, profileJson, `${label}-${skills.join('-')}`);
}

test('skill trends: empty corpus is explicit and stable', () => {
  const db = freshDb();
  assert.deepEqual(computeSkillTrends(db), {
    analyzed_listings: 0,
    skill_rows: 0,
    profile_label: null,
    profile_skill_count: 0,
    trends: [],
    profile_gaps: [],
    comparison_method: 'case-insensitive exact match against the latest Scout profile skills',
  });
});

test('skill trends: aggregates distinct listings, tiers, prevalence, and exact profile coverage', () => {
  const db = freshDb();
  const first = addClaim(db, 'Acme', 'Support');
  const second = addClaim(db, 'Quartz', 'Infrastructure');

  addSkill(db, first, 'Active Directory', 'required');
  addSkill(db, first, 'active   directory', 'required'); // duplicate mention, same listing
  addSkill(db, second, 'ACTIVE DIRECTORY', 'preferred');
  addSkill(db, first, 'PowerShell', 'required');
  addSkill(db, second, 'Terraform', 'required');
  addProfile(db, 'Older profile', ['terraform']);
  addProfile(db, 'Current profile', ['Active Directory']);

  const report = computeSkillTrends(db);
  assert.equal(report.analyzed_listings, 2);
  assert.equal(report.skill_rows, 5);
  assert.equal(report.profile_label, 'Current profile');
  assert.equal(report.profile_skill_count, 1);

  const activeDirectory = report.trends.find((item) => item.skill.toLowerCase() === 'active directory');
  assert.deepEqual(activeDirectory, {
    skill: 'Active Directory',
    listing_count: 2,
    required_count: 1,
    preferred_count: 1,
    prevalence: 1,
    represented_in_profile: true,
  });

  assert.deepEqual(
    report.profile_gaps.map((item) => item.skill),
    ['PowerShell', 'Terraform'],
  );
});

test('skill trends: reads only claims-backed listings and performs zero writes', () => {
  const db = freshDb();
  const tracked = addClaim(db, 'Tracked', 'Technician');
  addSkill(db, tracked, 'Windows', 'required');
  const orphan = db.prepare(`
    INSERT INTO listings (source, company, role) VALUES ('Manual', 'Orphan', 'Engineer')
  `).run().lastInsertRowid;
  addSkill(db, orphan, 'Kubernetes', 'required');

  const before = {
    claims: db.prepare('SELECT count(*) n FROM claims').get().n,
    skills: db.prepare('SELECT count(*) n FROM listing_skills').get().n,
  };
  const report = computeSkillTrends(db);
  const after = {
    claims: db.prepare('SELECT count(*) n FROM claims').get().n,
    skills: db.prepare('SELECT count(*) n FROM listing_skills').get().n,
  };

  assert.deepEqual(after, before);
  assert.deepEqual(report.trends.map((item) => item.skill), ['Windows']);
});
