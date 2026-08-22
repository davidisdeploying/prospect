// v3b: wide-capture external_job_id + apply_url. Covers extractApplyUrl()
// as a standalone unit -- the fixture lacks the safety-go href (captured
// without it), so these inputs are synthetic, built from the live-DOM-
// confirmed shape (2026-07-16, logged-in Amazon posting): the primary Apply
// anchor's href is `https://www.linkedin.com/safety/go/?url=<encoded>&...`,
// decoding to the genuine external ATS target. Exits non-zero on any failure.
global.self = global;
await import("../src/adapters/linkedin.js");

const adapter = global.ProspectAdapters.linkedin;

let failures = 0;
function assert(cond, label) {
  console.log((cond ? "PASS" : "FAIL") + " — " + label);
  if (!cond) failures++;
}

console.log("=== extractApplyUrl ===");

const target = "https://www.amazon.jobs/jobs/10433923/it-support-associate-ii-ots-";
const wrapped = "https://www.linkedin.com/safety/go/?url=" + encodeURIComponent(target) + "&trk=x";
const r1 = adapter.extractApplyUrl(wrapped);
console.log(r1);
assert(r1 === target, "safety-go wrap -> unwrapped to the real external target");

const r2 = adapter.extractApplyUrl(target);
console.log(r2);
assert(r2 === target, "already-external href -> returned unchanged");

const r3 = adapter.extractApplyUrl("https://www.linkedin.com/signup/cold-join?session_redirect=%2Fjobs%2Fview%2F4420934683");
assert(r3 === null, "sign-in gate (internal LinkedIn, not /safety/go/) -> null");

assert(adapter.extractApplyUrl(null) === null, "null -> null");
assert(adapter.extractApplyUrl("") === null, "empty string -> null");
assert(adapter.extractApplyUrl("https://www.linkedin.com/jobs/view/4420934683/") === null, "internal LinkedIn link (not /safety/go/) -> null");
assert(adapter.extractApplyUrl("not a url") === null, "unparseable href -> null (no throw)");
assert(adapter.extractApplyUrl("https://www.linkedin.com/safety/go/?trk=x") === null, "/safety/go/ with no url= param -> null");
assert(adapter.extractApplyUrl("https://www.linkedin.com/safety/go/?url=not-a-url") === null, "/safety/go/ wrapping an unparseable url= -> null");

console.log("\n" + (failures === 0 ? "ALL ASSERTIONS PASSED" : failures + " ASSERTION(S) FAILED"));
process.exitCode = failures === 0 ? 0 : 1;
