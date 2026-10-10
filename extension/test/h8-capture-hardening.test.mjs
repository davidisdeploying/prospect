// H8 — LinkedIn adapter capture-hardening follow-ups.
//
// H8(a) — applicant-count phrasing variant. The original report was that the Premium
//   premiumApplicantInsights slot says "N total ... in the past day" on some postings (Amazon) but
//   "N Applicants ... Applicants in the past day" on others (Crystal), and that the parser matched
//   only the "total" phrasing, so Crystal's counts were silently omitted.
//
//   That is FIXED, but by a better route than broadening a phrase list: parseSduiApplicantStats was
//   made STRUCTURAL. It finds the header, walks the sibling stat divs, takes the leading number, and
//   routes on "past day" versus everything-else — so the trailing label wording is irrelevant. This
//   test pins that down against BOTH phrasings, because a structural reader is exactly the kind of
//   thing a later "cleanup" turns back into a phrase match. The claim was verified here rather than
//   taken from the code comment that asserts it.
//
// H8(b) — verified-badge positive case. The badge reader is exercised below against markup carrying
//   a "Verified" badge, which proves the READER works. It is deliberately NOT a claim that H8(b) is
//   closed: both live fixtures are unverified-hirer postings, so nothing here proves LinkedIn's real
//   verified-hirer markup matches this shape. That validation still needs a genuine verified posting
//   captured at the Mac, and the test says so rather than quietly standing in for it.
//
// Run: node --experimental-vm-modules test/h8-capture-hardening.test.mjs   (from extension/)

import { JSDOM } from "jsdom";

global.self = global;
await import("../src/adapters/linkedin.js");
const adapter = global.ProspectAdapters.linkedin;

let failures = 0;
function assert(cond, label) {
  console.log((cond ? "PASS" : "FAIL") + " — " + label);
  if (!cond) failures++;
}

function docFrom(html) {
  return new JSDOM(html).window.document;
}

// The real slot shape: a header, then each stat as its own sibling <div> flattening to
// "<number><label>" with no separating whitespace.
function insightsSlot(totalLabel, pastDayLabel) {
  return `
  <div data-sdui-component="premiumApplicantInsightsForJobDetails">
    <h3>Applicants for this job</h3>
    <div>907${totalLabel}</div>
    <div>31${pastDayLabel}</div>
  </div>`;
}

console.log("=== H8(a): applicant stats are phrasing-independent ===");

const amazon = adapter.parseSduiApplicantStats(docFrom(insightsSlot("total", "in the past day")));
console.log(JSON.stringify(amazon));
assert(amazon && amazon.total === 907 && amazon.past_day === 31,
  'Amazon phrasing ("907total" / "31in the past day") -> {total:907, past_day:31}');

const crystal = adapter.parseSduiApplicantStats(docFrom(insightsSlot("Applicants", "Applicants in the past day")));
console.log(JSON.stringify(crystal));
assert(crystal && crystal.total === 907 && crystal.past_day === 31,
  'Crystal phrasing ("907Applicants" / "31Applicants in the past day") -> {total:907, past_day:31} — the H8(a) regression');

const invented = adapter.parseSduiApplicantStats(docFrom(insightsSlot("candidates so far", "seen within the last day")));
console.log(JSON.stringify(invented));
assert(invented && invented.total === 907 && invented.past_day === 31,
  "a wording neither fixture uses still parses — proof the reader is structural, not a phrase list");

console.log("=== H8(a): thousands separators and absent slot ===");
const comma = adapter.parseSduiApplicantStats(docFrom(insightsSlot("total", "in the past day").replace("907", "1,204")));
assert(comma && comma.total === 1204, '"1,204total" -> 1204 (separator stripped)');

assert(adapter.parseSduiApplicantStats(docFrom("<div><h3>Applicants for this job</h3></div>")) === null,
  "no premium slot -> null, never a fabricated zero");

console.log("=== H8(b): verified badge reader (synthetic — NOT a live-fixture validation) ===");

const verifiedDoc = docFrom(`
  <div class="job-details-jobs-unified-top-card__job-insight"><span>Verified</span></div>
  <button>Easy Apply</button>`);
assert(adapter.hasBadge(verifiedDoc, /^verified$/i) === true,
  "a Verified badge in a top-card insight is detected");

const unverifiedDoc = docFrom(`
  <div class="job-details-jobs-unified-top-card__job-insight"><span>Promoted by hirer</span></div>`);
assert(adapter.hasBadge(unverifiedDoc, /^verified$/i) === false,
  "an unverified posting reports false, not null-as-truthy");

assert(adapter.hasBadge(docFrom("<div><span>Verified profile of the recruiter</span></div>"), /^verified$/i) === false,
  "the match is exact — prose merely containing the word does not count as a badge");

console.log(
  "\nNOTE: H8(b) remains OPEN. The reader is proven; LinkedIn's real verified-hirer markup is not.\n"
  + "      Closing it needs one genuine verified-hirer posting captured live at the Mac.\n"
  + "      H8(c) (skills behind the Premium 'Show match details' modal) stays out of scope for\n"
  + "      passive one-click capture, per its original ruling."
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
