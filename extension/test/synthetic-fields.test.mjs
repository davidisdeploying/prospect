// Field extraction against hand-authored fixtures.
//
// These replace an earlier set that parsed verbatim captures of real LinkedIn
// pages. The captures carried a real posting, a real search, and the search
// terms behind them, none of which belongs in a public repository. Everything
// here is invented; the DOM structure is what the adapter actually reads.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

global.self = global;
await import("../src/adapters/linkedin.js");
await import("../src/lib/capture.js");

const adapter = global.ProspectAdapters.linkedin;

// Mirrors server/validate.js ENUMS.
const VOCAB = {
  employment_type: ["full_time", "part_time", "contract", "temporary", "internship", "volunteer", "other"],
  workplace_type: ["on_site", "hybrid", "remote"],
  seniority: ["internship", "entry", "associate", "mid_senior", "director", "executive"],
  role_family: ["engineering", "data", "design", "product", "marketing", "sales", "operations", "finance", "hr", "legal", "support", "research", "other"],
  salary_period: ["hourly", "daily", "weekly", "biweekly", "monthly", "yearly"],
};

function parse(fixture, url) {
  const html = readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8");
  return adapter.parse(new JSDOM(html, { url }).window.document, url).fields;
}

const FULL_URL = "https://www.linkedin.com/jobs/view/1000000001/";
const SPARSE_URL = "https://www.linkedin.com/jobs/view/1000000002/";

test("a fully specified posting yields the wide-capture field set", () => {
  const f = parse("linkedin-synthetic-posting.html", FULL_URL);
  assert.equal(f.job_id, "1000000001", "job_id from the canonical URL");
  assert.equal(f.role, "Platform Engineer");
  assert.equal(f.company, "Northwind Systems");
  assert.equal(f.company_url, "https://www.linkedin.com/company/northwind-systems");
  assert.equal(f.location_city, "Austin");
  assert.equal(f.location_state, "TX");
  assert.equal(f.employment_type, "full_time", "mapped from 'Full-time'");
  assert.equal(f.seniority, "entry", "mapped from 'Entry level'");
  assert.equal(f.role_family, "engineering", "mapped from the job function");
});

test("a disclosed salary range is parsed into bounds, period and currency", () => {
  const f = parse("linkedin-synthetic-posting.html", FULL_URL);
  assert.equal(f.comp_disclosed, true);
  assert.equal(f.salary_min, 120000);
  assert.equal(f.salary_max, 150000);
  assert.equal(f.salary_period, "yearly");
  assert.equal(f.salary_currency, "USD");
  assert.ok(f.salary_min <= f.salary_max, "range is ordered");
});

test("every enum value stays inside the server vocabulary", () => {
  const f = parse("linkedin-synthetic-posting.html", FULL_URL);
  for (const [field, allowed] of Object.entries(VOCAB)) {
    if (f[field] === undefined) continue;
    assert.ok(allowed.includes(f[field]), `${field}=${f[field]} is in vocab`);
  }
});

test("an applicant count is read as a number, not a caption", () => {
  const f = parse("linkedin-synthetic-posting.html", FULL_URL);
  assert.equal(typeof f.applicant_count, "number");
  assert.equal(f.applicant_count, 200, "'Over 200 applicants' reads as 200");
});

test("a sparse posting omits what it cannot find rather than storing empties", () => {
  const f = parse("linkedin-synthetic-minimal.html", SPARSE_URL);
  assert.equal(f.role, "Support Analyst", "what is present is still captured");
  assert.equal(f.job_id, "1000000002");
  for (const field of ["employment_type", "seniority", "salary_min", "salary_max",
                       "location_city", "location_state", "applicant_count"]) {
    assert.ok(!(field in f) || f[field] === undefined || f[field] === null,
      `${field} is omitted, never an empty string`);
    assert.notEqual(f[field], "", `${field} is never ""`);
  }
});

test("provenance tagging stays in parsed and never rewrites captured fields", () => {
  const f = parse("linkedin-synthetic-posting.html", FULL_URL);
  assert.ok(f.parsed && typeof f.parsed === "object", "parsed block present");
  assert.equal(f.parsed.parsed_by, "adapter");
  assert.ok(!("parsed_by" in f), "provenance does not leak into the field set");
});
