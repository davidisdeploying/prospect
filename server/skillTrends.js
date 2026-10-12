// §4.4 — deterministic skill trends and profile-gap candidates.
//
// This module reads the provenance-tagged listing_skills corpus and the latest Scout profile.
// It never infers equivalence between differently named skills: "Azure" and "cloud" remain
// distinct unless the profile explicitly names both. A reported gap therefore means only
// "not represented in the configured profile", never "David does not have this skill".

function normalizeSkill(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function latestProfile(db) {
  const hasProfiles = db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = 'scout_profile_versions'
  `).get();
  if (!hasProfiles) return { label: null, skills: [] };

  const row = db.prepare(`
    SELECT label, profile_json
    FROM scout_profile_versions
    ORDER BY id DESC
    LIMIT 1
  `).get();
  if (!row) return { label: null, skills: [] };

  try {
    const parsed = JSON.parse(row.profile_json);
    return {
      label: row.label,
      skills: Array.isArray(parsed?.skills)
        ? parsed.skills.map(normalizeSkill).filter(Boolean)
        : [],
    };
  } catch {
    return { label: row.label, skills: [] };
  }
}

export function computeSkillTrends(db) {
  const rows = db.prepare(`
    SELECT ls.listing_id, ls.skill, ls.tier
    FROM listing_skills ls
    JOIN claims c ON c.listing_id = ls.listing_id
    WHERE trim(ls.skill) <> ''
    ORDER BY ls.listing_id, ls.id
  `).all();

  const profile = latestProfile(db);
  const profileSkills = new Set(profile.skills);
  const analyzedListings = new Set(rows.map((row) => row.listing_id)).size;
  const bySkill = new Map();

  for (const row of rows) {
    const normalized = normalizeSkill(row.skill);
    if (!normalized) continue;
    if (!bySkill.has(normalized)) {
      bySkill.set(normalized, {
        skill: String(row.skill).trim(),
        listingIds: new Set(),
        requiredIds: new Set(),
        preferredIds: new Set(),
      });
    }
    const item = bySkill.get(normalized);
    item.listingIds.add(row.listing_id);
    if (row.tier === 'required') item.requiredIds.add(row.listing_id);
    if (row.tier === 'preferred') item.preferredIds.add(row.listing_id);
  }

  const trends = [...bySkill.entries()].map(([normalized, item]) => ({
    skill: item.skill,
    listing_count: item.listingIds.size,
    required_count: item.requiredIds.size,
    preferred_count: item.preferredIds.size,
    prevalence: analyzedListings === 0 ? 0 : item.listingIds.size / analyzedListings,
    represented_in_profile: profileSkills.has(normalized),
  })).sort((a, b) =>
    b.listing_count - a.listing_count
    || b.required_count - a.required_count
    || a.skill.localeCompare(b.skill)
  );

  return {
    analyzed_listings: analyzedListings,
    skill_rows: rows.length,
    profile_label: profile.label,
    profile_skill_count: profileSkills.size,
    trends,
    profile_gaps: trends
      .filter((item) => item.required_count > 0 && !item.represented_in_profile)
      .sort((a, b) =>
        b.required_count - a.required_count
        || b.listing_count - a.listing_count
        || a.skill.localeCompare(b.skill)
      ),
    comparison_method: 'case-insensitive exact match against the latest Scout profile skills',
  };
}
