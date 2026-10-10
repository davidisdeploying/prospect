// Dev-only validation script (not shipped). Asserts the §2.1b SDUI (logged-in)
// selector corrections against two real logged-in fixtures: validated
// positives (promoted, easy_apply both polarities, applicant_count,
// applicants_last_day, job-poster contact) AND the anti-false-positive
// negatives (similarJobs-card badges must not leak onto the main posting).
// Also asserts the SDUI CORE fields (role/company/location/posted_at/
// description; comp omitted when undisclosed) added to close the bug where
// readDom() only ever read those six fields via guest/JSON-LD selectors —
// none of which exist on the logged-in SDUI render, so every logged-in
// capture showed all six as "(not found)". NOTE: these fixtures carry a
// synthetic <title> (not the real "<role> | <company> | LinkedIn" shape)
// and have every href stripped, so these assertions exercise the metric-
// line/structural-fallback path, not the title-split or /company/-link
// path — those need live verification (see response.md).
// Also regression-checks that the SDUI path doesn't fire on the logged-out
// guest fixture. Exits non-zero on any failure.
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

global.self = global;
await import("../src/adapters/linkedin.js");

const adapter = global.ProspectAdapters.linkedin;

let failures = 0;
function assert(cond, label) {
  console.log((cond ? "PASS" : "FAIL") + " — " + label);
  if (!cond) failures++;
}

function parseFixture(filename, jobUrl) {
  const html = readFileSync(new URL("./fixtures/" + filename, import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: jobUrl });
  return adapter.parse(dom.window.document, jobUrl);
}

console.log("=== fixture 4420934683 (Amazon, external apply, Premium applicant insights) ===");
const JOB_URL_A = "https://www.linkedin.com/jobs/view/4420934683/";
const resultA = parseFixture("linkedin-loggedin-4420934683.html", JOB_URL_A);
const fA = resultA.fields;
console.log(JSON.stringify(fA, null, 2));

assert(fA.role === "IT Support Associate II, OTS", "fixture A: role extracted");
assert(fA.company === "Amazon", "fixture A: company extracted");
assert(fA.location === "Richardson, TX", "fixture A: location extracted");
assert(typeof fA.posted_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fA.posted_at), "fixture A: posted_at normalized to an ISO date");
assert(typeof fA.description === "string" && fA.description.length > 0, "fixture A: description non-empty");
// v3a: comp is folded into the description prose on this posting ("USA, TX,
// Richardson - 23.00 - 37.00 USD hourly", with no dedicated comp badge) --
// parseCompFromProse() picks it up, so comp is no longer undisclosed here.
assert(fA.comp === "$23/hr - $37/hr", "fixture A: comp derived from description prose");
assert(fA.comp_disclosed === true, "fixture A: comp_disclosed === true (prose-derived)");
assert(fA.salary_min === 23 && fA.salary_max === 37, "fixture A: salary_min/max === 23/37");
assert(fA.salary_period === "hourly" && fA.salary_currency === "USD", "fixture A: salary_period/currency === hourly/USD");
assert(resultA.missing.indexOf("comp") === -1, "fixture A: missing[] no longer includes comp");
["role", "company", "location", "comp", "posted_at", "description"].forEach(function (key) {
  assert(resultA.missing.indexOf(key) === -1, "fixture A: missing[] does NOT include " + key);
});
assert(fA.employment_type === "full_time", "fixture A: employment_type === full_time (SDUI badge)");
assert(fA.workplace_type === undefined, "fixture A: workplace_type omitted (no workplace badge on this posting)");
assert(fA.parsed && Array.isArray(fA.parsed.benefits) && fA.parsed.benefits.indexOf("401(k)") !== -1, "fixture A: parsed.benefits includes 401(k)");
assert(fA.parsed && fA.parsed.candidate_pool && fA.parsed.candidate_pool.total === 907, "fixture A: parsed.candidate_pool.total === 907");
assert(fA.parsed && fA.parsed.candidate_pool && fA.parsed.candidate_pool.past_day === 31, "fixture A: parsed.candidate_pool.past_day === 31");
assert(fA.parsed && fA.parsed.candidate_pool && fA.parsed.candidate_pool.seniority_mix && fA.parsed.candidate_pool.seniority_mix.entry_level === 65, "fixture A: parsed.candidate_pool.seniority_mix.entry_level === 65");
assert(fA.parsed && fA.parsed.apply_nuance === "Responses managed off LinkedIn", "fixture A: parsed.apply_nuance captured");
assert(fA.parsed && fA.parsed.company_legal_name === "Amazon.com Services LLC", "fixture A: parsed.company_legal_name captured");
assert(fA.parsed && fA.parsed.parsed_by === "adapter", "fixture A: parsed.parsed_by === adapter");

// v3b: external_job_id extracted from the "Job ID: A10433923" text already
// flowing into fields.description via findSduiAboutBody().
assert(fA.external_job_id === "A10433923", "fixture A: external_job_id === 'A10433923'");
// v3b: this fixture's Apply anchor carries no target=_blank/href (captured
// without it, per response.md) -- apply_url stays omitted (omit-not-guess).
assert(fA.apply_url === undefined, "fixture A: apply_url omitted (fixture Apply anchor has no href)");

assert(fA.promoted === true, "fixture A: promoted === true");
assert(fA.applicant_count === 907, "fixture A: applicant_count === 907");
assert(fA.applicants_last_day === 31, "fixture A: applicants_last_day === 31");
assert(fA.easy_apply === undefined, "fixture A: easy_apply omitted (external — 'Responses managed off LinkedIn')");
assert(fA.actively_reviewing === undefined, "fixture A: actively_reviewing omitted");
assert(fA.top_applicant_match === undefined, "fixture A: top_applicant_match omitted (anti-false-positive despite similarJobs text)");
assert(fA.verified === undefined, "fixture A: verified omitted");
assert(fA.skills === undefined, "fixture A: skills omitted (not extractable from static SDUI DOM)");
assert(typeof fA.raw === "object" || (resultA.raw && resultA.raw.jobDetailHtml && resultA.raw.jobDetailHtml.length > 0), "fixture A: raw present/non-empty");

console.log("\n=== fixture 4423256427 (Crystal Equation, Easy Apply, job-poster contact) ===");
const JOB_URL_B = "https://www.linkedin.com/jobs/view/4423256427/";
const resultB = parseFixture("linkedin-loggedin-4423256427.html", JOB_URL_B);
const fB = resultB.fields;
console.log(JSON.stringify(fB, null, 2));

assert(fB.role === "Network Technician", "fixture B: role extracted");
assert(fB.company === "Crystal Equation Corporation", "fixture B: company extracted");
assert(fB.location === "Dallas-Fort Worth Metroplex", "fixture B: location extracted");
assert(typeof fB.posted_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fB.posted_at), "fixture B: posted_at normalized to an ISO date");
assert(typeof fB.description === "string" && fB.description.length > 0, "fixture B: description non-empty");
["role", "company", "location", "posted_at", "description"].forEach(function (key) {
  assert(resultB.missing.indexOf(key) === -1, "fixture B: missing[] does NOT include " + key);
});

assert(fB.promoted === true, "fixture B: promoted === true");
assert(fB.easy_apply === true, "fixture B: easy_apply === true");
assert(fB.applicant_count === 268, "fixture B: applicant_count === 268 (Applicants wording)");
assert(fB.applicants_last_day === 3, "fixture B: applicants_last_day === 3 (Applicants in the past day wording)");
assert(fB.contacts && fB.contacts.length === 1, "fixture B: contacts has exactly one entry");
assert(fB.contacts && fB.contacts[0].is_job_poster === true, "fixture B: contacts[0].is_job_poster === true");
assert(fB.contacts && fB.contacts[0].name === "Jordan Poster", "fixture B: contacts[0].name === 'Jordan Poster'");
assert(fB.contacts && !!fB.contacts[0].role, "fixture B: contacts[0].role non-empty");
assert(fB.actively_reviewing === undefined, "fixture B: actively_reviewing omitted");
assert(fB.top_applicant_match === undefined, "fixture B: top_applicant_match omitted (anti-false-positive despite similarJobs text)");
assert(fB.verified === undefined, "fixture B: verified omitted");
assert(fB.skills === undefined, "fixture B: skills omitted (not extractable from static SDUI DOM)");

// v3a: comp badge ("$31/hr - $36/hr") + employment/workplace badges
// ("Contract" / "On-site") sit right in the top-card badge row.
assert(fB.comp === "$31/hr - $36/hr", "fixture B: comp derived from top-card badge");
assert(fB.salary_min === 31 && fB.salary_max === 36, "fixture B: salary_min/max === 31/36");
assert(fB.employment_type === "contract", "fixture B: employment_type === contract (SDUI badge)");
assert(fB.workplace_type === "on_site", "fixture B: workplace_type === on_site (SDUI badge)");
assert(fB.seniority === undefined, "fixture B: seniority omitted (no seniority badge on this posting, never guessed as 'other')");
assert(fB.parsed && Array.isArray(fB.parsed.benefits) && fB.parsed.benefits.length === 4, "fixture B: parsed.benefits has 4 comma-split items");
assert(fB.parsed && fB.parsed.candidate_pool && fB.parsed.candidate_pool.total === 268, "fixture B: parsed.candidate_pool.total === 268");
assert(fB.parsed && fB.parsed.company_review_time === "1 week", "fixture B: parsed.company_review_time === '1 week'");

console.log("\n" + (failures === 0 ? "ALL ASSERTIONS PASSED" : failures + " ASSERTION(S) FAILED"));
process.exitCode = failures === 0 ? 0 : 1;
