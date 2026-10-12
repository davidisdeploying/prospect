// v3a: SDUI extraction hardening. Covers the pieces not already exercised by
// v2-fields-loggedin.test.mjs's fixture assertions: parseCompFromProse() as
// a standalone unit (positive + negative), cleanDescriptionHtml() as a
// standalone unit, and the faithful-tracker guarantee that raw_payload stays
// byte-verbatim while fields.description is cleaned. Exits non-zero on any
// failure.
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

console.log("=== parseCompFromProse: positive ===");
const p1 = adapter.parseCompFromProse("23.00 - 37.00 USD hourly");
console.log(JSON.stringify(p1));
assert(p1 && p1.salary_min === 23 && p1.salary_max === 37 && p1.salary_period === "hourly" && p1.salary_currency === "USD", "'23.00 - 37.00 USD hourly' -> {min:23, max:37, period:hourly, currency:USD}");
assert(p1.salary_min * 2080 === 47840 && p1.salary_max * 2080 === 76960, "annualization math: 23*2080=47840, 37*2080=76960");

const p2 = adapter.parseCompFromProse("$23.00–$37.00/hour");
console.log(JSON.stringify(p2));
assert(p2 && p2.salary_min === 23 && p2.salary_max === 37 && p2.salary_period === "hourly" && p2.salary_currency === "USD", "'$23.00–$37.00/hour' -> {min:23, max:37, period:hourly, currency:USD}");

const p3 = adapter.parseCompFromProse("$120,000 - $150,000 per year");
console.log(JSON.stringify(p3));
assert(p3 && p3.salary_min === 120000 && p3.salary_max === 150000 && p3.salary_period === "yearly" && p3.salary_currency === "USD", "'$120,000 - $150,000 per year' -> {min:120000, max:150000, period:yearly, currency:USD}");

const p4 = adapter.parseCompFromProse("$45/hr");
console.log(JSON.stringify(p4));
assert(p4 && p4.salary_min === 45 && p4.salary_max === 45 && p4.salary_period === "hourly" && p4.salary_currency === "USD", "'$45/hr' (single value) -> min===max===45, period:hourly");

const p5 = adapter.parseCompFromProse("USD 90000 annually");
console.log(JSON.stringify(p5));
assert(p5 && p5.salary_min === 90000 && p5.salary_max === 90000 && p5.salary_period === "yearly" && p5.salary_currency === "USD", "'USD 90000 annually' (single value) -> min===max===90000, period:yearly");

const p6 = adapter.parseCompFromProse("$31/hr - $36/hr");
console.log(JSON.stringify(p6));
assert(p6 && p6.salary_min === 31 && p6.salary_max === 36 && p6.salary_period === "hourly" && p6.salary_currency === "USD", "'$31/hr - $36/hr' -> {min:31, max:36, period:hourly, currency:USD}");

const unstatedRangeText = "The base salary range for this role is between $50,000 and $59,000 depending on skills and qualifications.";
const p7 = adapter.parseCompFromProse(unstatedRangeText);
console.log(JSON.stringify(p7));
assert(p7 && p7.salary_min === 50000 && p7.salary_max === 59000 && p7.salary_currency === "USD", "base salary 'between $50,000 and $59,000' preserves the disclosed range");
assert(p7 && p7.salary_period == null, "base salary range with no pay period does not guess or annualize");

console.log("\n=== parseCompFromProse: negative (ambiguous/no-comp -> omit, never guess) ===");
const n1 = adapter.parseCompFromProse("Competitive salary based on experience");
assert(n1 === null, "'Competitive salary based on experience' -> null");
const n2 = adapter.parseCompFromProse("We work 40 hours per week and offer great benefits");
assert(n2 === null, "'We work 40 hours per week...' (no currency anchor) -> null");
const n3 = adapter.parseCompFromProse("5-10 years of experience required");
assert(n3 === null, "'5-10 years of experience required' (range but no currency/period) -> null");
const n4 = adapter.parseCompFromProse("");
assert(n4 === null, "empty string -> null");
const n5 = adapter.parseCompFromProse("£50,000 per year");
assert(n5 === null, "'£50,000 per year' (unrecognized symbol, only $/USD supported) -> null");

console.log("\n=== cleanDescriptionHtml ===");
const dirty =
  '<div class="jobs-abc123 build-hash-xyz" data-testid="foo" style="color:red"><p class="txt-99">Hello <strong data-x="1">world</strong></p>' +
  '<script>alert(1)</script><style>.a{color:red}</style>' +
  '<a href="https://example.com/job" class="link-hash" onclick="evil()">Apply here</a>' +
  '<a href="javascript:alert(1)">bad link</a>' +
  '<a>no href</a>' +
  '<ul><li onmouseover="evil()">Item one</li></ul>' +
  "<h3>Section</h3><h4>Sub</h4><em>emph</em><b>bold</b><i>ital</i><br></div>";
const clean = adapter.cleanDescriptionHtml(dirty);
console.log(clean);

assert(!/class=/.test(clean), "no class= attributes survive");
assert(!/data-[a-z]/i.test(clean), "no data-* attributes survive");
assert(!/style=/.test(clean), "no style= attributes survive");
assert(!/<script/i.test(clean) && !/alert\(1\)/.test(clean), "<script> content is stripped entirely");
assert(!/<style/i.test(clean), "<style> tag is stripped entirely");
assert(!/on\w+\s*=/i.test(clean), "no on*-handler attributes survive (onclick/onmouseover)");
assert(!/javascript:/i.test(clean), "javascript: scheme href is stripped");
assert(/<p>Hello <strong>world<\/strong><\/p>/.test(clean), "allowlisted p/strong tags survive, bare (no attrs)");
assert(/<a href="https:\/\/example\.com\/job">Apply here<\/a>/.test(clean), "http(s) <a href> survives with href kept");
assert(/no href/.test(clean) && !/<a>no href/.test(clean), "an <a> with no href is unwrapped (text kept, tag dropped)");
assert(/bad link/.test(clean) && !/<a[^>]*javascript/i.test(clean), "javascript: <a> is unwrapped (text kept, tag dropped)");
assert(/<li>Item one<\/li>/.test(clean), "li survives bare, onmouseover stripped");
assert(/<h3>Section<\/h3>/.test(clean) && /<h4>Sub<\/h4>/.test(clean), "h3/h4 survive");
assert(/<em>emph<\/em>/.test(clean) && /<b>bold<\/b>/.test(clean) && /<i>ital<\/i>/.test(clean), "em/b/i survive");
assert(/<br>/.test(clean), "br survives");
assert(adapter.cleanDescriptionHtml("") === "", "empty input -> empty output");
assert(adapter.cleanDescriptionHtml(null) === "", "null input -> empty output (no throw)");

console.log("\n=== faithful-tracker: raw_payload stays byte-verbatim while fields.description is cleaned ===");
function parseFixture(filename, jobUrl) {
  const html = readFileSync(new URL("./fixtures/" + filename, import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: jobUrl });
  return adapter.parse(dom.window.document, jobUrl);
}
const JOB_URL_B = "https://www.linkedin.com/jobs/view/4423256427/";
const resultB = parseFixture("linkedin-loggedin-4423256427.html", JOB_URL_B);
const rawPayloadStr = JSON.stringify(resultB.raw);
// The raw jobDetailHtml capture wraps the space before the pay-range figure
// in a bare "<span> </span>" (no class/attrs in this fixture, but a real
// non-allowlisted element regardless) -- cleanDescriptionHtml() unwraps that
// span (drops the tag, keeps its text), so this exact fragment survives in
// raw verbatim but never appears in the cleaned fields.description.
const originalMarkupNeedle = "this position is<span> </span><strong>$31";
assert(rawPayloadStr.indexOf(originalMarkupNeedle) !== -1, "raw_payload (serialized raw) STILL contains the original markup verbatim: " + JSON.stringify(originalMarkupNeedle));
assert(resultB.fields.description.indexOf(originalMarkupNeedle) === -1, "fields.description does NOT contain that exact original-markup fragment (cleanup touched only the typed column)");
assert(resultB.fields.description.indexOf("this position is <strong>$31") !== -1, "fields.description carries the same sentence with the <span> unwrapped to plain text");
assert(/The pay range for this position is.*\$31.*\$36.*per hour/.test(resultB.fields.description), "fields.description still carries the same visible pay-range sentence, just cleaned");
assert(resultB.raw.jobDetailHtml.indexOf(originalMarkupNeedle) !== -1, "raw.jobDetailHtml (pre-serialization) also contains the original markup verbatim");

console.log("\n=== period-unstated base salary integration ===");
const fixtureB = readFileSync(new URL("./fixtures/linkedin-loggedin-4423256427.html", import.meta.url), "utf8");
const edgeHtml = fixtureB
  .replace("$31/hr - $36/hr", "Compensation disclosed in description")
  .replace(
    /The pay range for this position is<span> <\/span><strong>\$31 – \$36 per hour<\/strong>, depending on experience, skills, and location\./,
    unstatedRangeText
  )
  .replace("Pay range is $31 - $36 per hour with full benefits available", "Full benefits are available");
const edgeDom = new JSDOM(edgeHtml, { url: JOB_URL_B });
const edgeResult = adapter.parse(edgeDom.window.document, JOB_URL_B);
assert(edgeResult.fields.comp === "$50,000 - $59,000 (period not stated)", "popup comp text identifies the disclosed range and unstated period");
assert(edgeResult.fields.comp_disclosed === true, "period-unstated range remains disclosed compensation");
assert(edgeResult.fields.salary_min === 50000 && edgeResult.fields.salary_max === 59000, "period-unstated range keeps structured amounts");
assert(edgeResult.fields.salary_currency === "USD" && edgeResult.fields.salary_period == null, "period remains absent, preventing annualization");
assert(edgeResult.missing.indexOf("comp") === -1, "period-unstated range no longer reports Missing: comp");

console.log("\n" + (failures === 0 ? "ALL ASSERTIONS PASSED" : failures + " ASSERTION(S) FAILED"));
process.exitCode = failures === 0 ? 0 : 1;
