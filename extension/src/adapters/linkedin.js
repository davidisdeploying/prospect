/*
 * LinkedIn adapter. The ONLY module that knows LinkedIn's DOM/JSON-LD shape.
 * Loaded as a plain script (no bundler, no third-party deps) so it works
 * unmodified both as an injected content script and under Node+jsdom in tests.
 *
 * Field policy (faithful-tracker): prefer JSON-LD, fall back to DOM, and if
 * neither yields a value the field is OMITTED from `fields` — never "" or a
 * guessed placeholder. Enum fields are mapped against the backend's exact
 * vocab (server/validate.js ENUMS, read on delta 2026-07-16); a value that
 * doesn't map is sent as "other" only for fields whose vocab actually
 * includes "other" — otherwise it is omitted (an off-vocab string is a 400).
 */
(function (global) {
  "use strict";

  var URL_RE = /^https:\/\/(?:www\.)?linkedin\.com\/jobs\/view\//i;
  var ADAPTER_SOURCE = "LinkedIn";

  var EMPLOYMENT_TYPE_MAP = {
    "full-time": "full_time",
    "part-time": "part_time",
    "contract": "contract",
    "temporary": "temporary",
    "internship": "internship",
    "volunteer": "volunteer",
  };
  var EMPLOYMENT_TYPE_HAS_OTHER = true; // server vocab includes 'other'

  var SENIORITY_MAP = {
    "internship": "internship",
    "entry level": "entry",
    "associate": "associate",
    "mid-senior level": "mid_senior",
    "director": "director",
    "executive": "executive",
    // "Not Applicable" has no vocab match and is intentionally omitted below.
  };

  var WORKPLACE_TYPE_MAP = {
    "remote": "remote",
    "hybrid": "hybrid",
    "on-site": "on_site",
    "onsite": "on_site",
  };

  var SALARY_PERIOD_MAP = {
    "yr": "yearly",
    "year": "yearly",
    "hr": "hourly",
    "hour": "hourly",
    "mo": "monthly",
    "month": "monthly",
    "wk": "weekly",
    "week": "weekly",
    "day": "daily",
    "biweekly": "biweekly",
    "bi-weekly": "biweekly",
  };

  var CURRENCY_SYMBOL_MAP = { "$": "USD", "£": "GBP", "€": "EUR" };

  var ROLE_FAMILY_KEYWORDS = [
    { family: "engineering", re: /engineer|information technology|\bit\b|software/i },
    { family: "data", re: /\bdata\b|analytics|machine learning|\bai\b/i },
    { family: "design", re: /design|user experience|\bux\b|\bui\b/i },
    { family: "product", re: /product management|product\b/i },
    { family: "marketing", re: /marketing|communications/i },
    { family: "sales", re: /sales|business development/i },
    { family: "operations", re: /operations|supply chain|logistics/i },
    { family: "finance", re: /finance|accounting/i },
    { family: "hr", re: /human resources|\bhr\b|people/i },
    { family: "legal", re: /legal/i },
    { family: "support", re: /customer service|support/i },
    { family: "research", re: /research|science/i },
  ];

  function isTwoPaneUrl(url) {
    if (!url || typeof url !== "string") return false;
    try {
      var u = new global.URL(url);
      var p = u.pathname.toLowerCase();
      return /^\/jobs\/(?:search-results|collections)\b/.test(p);
    } catch (e) {
      return false;
    }
  }

  function match(url) {
    if (!url || typeof url !== "string") return false;
    try {
      var parsed = new global.URL(url);
      var host = parsed.hostname.toLowerCase();
      if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return false;
      var path = parsed.pathname.toLowerCase();
      if (/^\/jobs\/view\//.test(path)) {
        return true;
      }
      if (/^\/jobs\/(?:search-results|collections)\b/.test(path)) {
        var currentJobId = parsed.searchParams.get("currentJobId");
        return !!(currentJobId && /^\d+$/.test(currentJobId));
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // LinkedIn job URLs come in three live forms: /jobs/view/<id>,
  // /jobs/view/<slug>-<id>, and /jobs/search-results or /jobs/collections
  // query routes with currentJobId=<numeric>.
  // Canonicalize to the numeric /jobs/view/<id>/ form and strip tracking query params.
  function canonicalUrl(url) {
    try {
      var parsed = new global.URL(url);
      var path = parsed.pathname.toLowerCase();
      if (/^\/jobs\/(?:search-results|collections)\b/.test(path)) {
        var currentJobId = parsed.searchParams.get("currentJobId");
        if (currentJobId && /^\d+$/.test(currentJobId)) {
          return parsed.origin + "/jobs/view/" + currentJobId + "/";
        }
      }
      var segments = parsed.pathname.split("/").filter(Boolean);
      var last = segments[segments.length - 1] || "";
      var idMatch = last.match(/(\d+)$/);
      if (idMatch) {
        return parsed.origin + "/jobs/view/" + idMatch[1] + "/";
      }
      return parsed.origin + parsed.pathname;
    } catch (e) {
      return url;
    }
  }

  function jobIdFromUrl(url) {
    if (!url || typeof url !== "string") return null;
    try {
      var parsed = new global.URL(url);
      var path = parsed.pathname.toLowerCase();
      if (/^\/jobs\/(?:search-results|collections)\b/.test(path)) {
        var currentJobId = parsed.searchParams.get("currentJobId");
        if (currentJobId && /^\d+$/.test(currentJobId)) {
          return currentJobId;
        }
      }
    } catch (e) {}
    var canon = canonicalUrl(url);
    var m = String(canon || "").match(/\/jobs\/view\/(\d+)\//);
    return m ? m[1] : null;
  }

  function absolutizeUrl(href, base) {
    if (!href) return null;
    try {
      var u = new global.URL(href, base);
      return u.origin + u.pathname;
    } catch (e) {
      return null;
    }
  }

  function textOf(el) {
    if (!el) return "";
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function findJobPosting(node) {
    if (!node || typeof node !== "object") return null;
    if (node["@type"] === "JobPosting") return node;
    if (Array.isArray(node["@graph"])) {
      for (var i = 0; i < node["@graph"].length; i++) {
        var found = findJobPosting(node["@graph"][i]);
        if (found) return found;
      }
    }
    return null;
  }

  function readJsonLd(doc) {
    var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      var raw = scripts[i].textContent || "";
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        continue;
      }
      var candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (var j = 0; j < candidates.length; j++) {
        var posting = findJobPosting(candidates[j]);
        if (posting) {
          return { raw: raw, data: posting };
        }
      }
    }
    return null;
  }

  function flattenLocation(jobLocation) {
    if (!jobLocation) return "";
    var place = Array.isArray(jobLocation) ? jobLocation[0] : jobLocation;
    var address = place && place.address ? place.address : place;
    if (!address) return "";
    if (typeof address === "string") return address;
    var parts = [address.addressLocality, address.addressRegion, address.addressCountry].filter(
      Boolean
    );
    return parts.join(", ");
  }

  // Splits a flattened "City, ST" / "X Metropolitan Area" label into discrete
  // parts. Anything that doesn't match a recognized shape is left as just the
  // flattened `location` string — never guessed.
  function splitLocation(text) {
    var out = {};
    if (!text) return out;
    var metroMatch = text.match(/^(.+?)\s+Metropolitan Area$/i);
    if (metroMatch) {
      out.location_metro = text.trim();
      return out;
    }
    var cityStateMatch = text.match(/^([^,]+),\s*([A-Z]{2})(?:,.*)?$/);
    if (cityStateMatch) {
      out.location_city = cityStateMatch[1].trim();
      out.location_state = cityStateMatch[2].trim();
    }
    return out;
  }

  function toISODate(d) {
    return d.toISOString().slice(0, 10);
  }

  function shiftUTC(base, field, amount) {
    var d = new Date(base.getTime());
    d["setUTC" + field](d["getUTC" + field]() + amount);
    return d;
  }

  // LinkedIn's DOM shows a relative label ("5 days ago", "yesterday") rather
  // than an absolute date. Anchor it to capture time so the stored value is
  // comparable across postings; unrecognized text resolves to null so we
  // never store the raw label as if it were a date.
  function normalizeRelativeDate(text, capturedAtIso) {
    if (!text) return null;
    var normalized = String(text).trim().toLowerCase();
    var captured = new Date(capturedAtIso);
    if (isNaN(captured.getTime())) return null;

    if (normalized === "today" || normalized === "just now") return toISODate(captured);
    if (normalized === "yesterday") return toISODate(shiftUTC(captured, "Date", -1));

    var match = normalized.match(/^(\d+)\s*(hour|hours|day|days|week|weeks|month|months|year|years)\s+ago$/);
    if (!match) return null;

    var amount = parseInt(match[1], 10);
    var unit = match[2];
    if (unit.indexOf("hour") === 0) return toISODate(captured);
    if (unit.indexOf("day") === 0) return toISODate(shiftUTC(captured, "Date", -amount));
    if (unit.indexOf("week") === 0) return toISODate(shiftUTC(captured, "Date", -amount * 7));
    if (unit.indexOf("month") === 0) return toISODate(shiftUTC(captured, "Month", -amount));
    if (unit.indexOf("year") === 0) return toISODate(shiftUTC(captured, "FullYear", -amount));
    return null;
  }

  function flattenSalary(baseSalary) {
    if (!baseSalary) return "";
    if (typeof baseSalary === "string") return baseSalary;
    var currency = baseSalary.currency || "";
    var value = baseSalary.value || {};
    if (value.minValue != null && value.maxValue != null) {
      return (
        currency +
        " " +
        value.minValue +
        "-" +
        value.maxValue +
        (value.unitText ? "/" + value.unitText : "")
      );
    }
    if (value.value != null) {
      return currency + " " + value.value + (value.unitText ? "/" + value.unitText : "");
    }
    return "";
  }

  // Parses a flattened comp string like "$150,000.00/yr - $220,000.00/yr" (or
  // a single-sided "$120,000.00/yr") into structured min/max/period/currency.
  // Anything that doesn't match this shape yields an empty result — the
  // human-readable `comp` string is still sent, just not structured.
  function parseSalaryStructured(text) {
    var out = {};
    if (!text) return out;
    var re = /([$£€])\s*([\d,]+(?:\.\d+)?)\s*\/\s*(yr|year|hr|hour|mo|month|wk|week|day|biweekly|bi-weekly)/gi;
    var matches = [];
    var m;
    while ((m = re.exec(text)) !== null) {
      matches.push({ symbol: m[1], amount: parseFloat(m[2].replace(/,/g, "")), period: m[3].toLowerCase() });
    }
    if (!matches.length) return out;
    var first = matches[0];
    var period = SALARY_PERIOD_MAP[first.period];
    if (period) out.salary_period = period;
    var currency = CURRENCY_SYMBOL_MAP[first.symbol];
    if (currency) out.salary_currency = currency;
    if (matches.length >= 2) {
      out.salary_min = matches[0].amount;
      out.salary_max = matches[matches.length - 1].amount;
    } else {
      out.salary_min = first.amount;
      out.salary_max = first.amount;
    }
    return out;
  }

  // Deterministic + conservative comp-from-prose parser (v3a item 1): looks
  // for an unambiguous currency + amount(+range) + period anchor anywhere in
  // a free-text string. Tried as an ordered set of forms (range-with-$,
  // range-with-USD-code, single-with-USD-code, single-with-$); the first
  // form that matches wins. Returns null -- never a guessed value -- when
  // nothing unambiguous is found. Currency is intentionally scoped to "$"/
  // "USD" (both resolve to USD); any other symbol is unrecognized and never
  // matches (omitted, not guessed).
  var PROSE_PERIOD_MAP = {
    "hourly": "hourly", "hour": "hourly", "hr": "hourly", "per hour": "hourly",
    "daily": "daily", "day": "daily", "per day": "daily",
    "weekly": "weekly", "week": "weekly", "wk": "weekly", "per week": "weekly",
    "biweekly": "biweekly", "bi-weekly": "biweekly",
    "monthly": "monthly", "month": "monthly", "mo": "monthly", "per month": "monthly",
    "yearly": "yearly", "year": "yearly", "yr": "yearly", "annually": "yearly",
    "annum": "yearly", "per year": "yearly", "per annum": "yearly",
  };
  var PROSE_PERIOD_ALT =
    "per\\s+annum|per\\s+year|per\\s+month|per\\s+week|per\\s+day|per\\s+hour|" +
    "bi-weekly|biweekly|annually|monthly|hourly|weekly|yearly|annum|month|week|hour|year|day|hr|wk|mo|yr";
  var PROSE_AMOUNT = "\\d[\\d,]*(?:\\.\\d+)?";
  var PROSE_SEP = "(?:-|\\u2013|\\u2014|to)";
  // Some employers disclose an exact base-salary range but omit the pay
  // period, e.g. "The base salary range for this role is between $50,000 and
  // $59,000". Preserve the disclosed amounts without guessing that they are
  // annual. The narrow base-salary + between/and anchors avoid mistaking an
  // unrelated pair of dollar figures in benefits prose for compensation.
  var PROSE_UNSTATED_BASE_RANGE = new RegExp(
    "\\bbase\\s+salary\\s+range\\b[^$]{0,120}\\bbetween\\s+\\$\\s*(" + PROSE_AMOUNT + ")" +
      "\\s+and\\s+\\$\\s*(" + PROSE_AMOUNT + ")\\b",
    "i"
  );
  var PROSE_FORMS = [
    // "$23.00–$37.00/hour", "$31/hr - $36/hr", "$120,000 - $150,000 per year"
    new RegExp(
      "\\$\\s*(" + PROSE_AMOUNT + ")(?:\\s*(?:\\/\\s*|per\\s+)(?:" + PROSE_PERIOD_ALT + "))?" +
        "\\s*" + PROSE_SEP + "\\s*\\$?\\s*(" + PROSE_AMOUNT + ")\\s*(?:\\/\\s*|per\\s+)(" + PROSE_PERIOD_ALT + ")\\b",
      "i"
    ),
    // "23.00 - 37.00 USD hourly"
    new RegExp(
      "(" + PROSE_AMOUNT + ")\\s*" + PROSE_SEP + "\\s*(" + PROSE_AMOUNT + ")\\s+USD\\s+(" + PROSE_PERIOD_ALT + ")\\b",
      "i"
    ),
    // "USD 90000 annually"
    new RegExp("USD\\s+(" + PROSE_AMOUNT + ")\\s+(" + PROSE_PERIOD_ALT + ")\\b", "i"),
    // "$45/hr"
    new RegExp("\\$\\s*(" + PROSE_AMOUNT + ")\\s*(?:\\/\\s*|per\\s+)(" + PROSE_PERIOD_ALT + ")\\b", "i"),
  ];

  function resolveProsePeriod(token) {
    if (!token) return null;
    var key = token.trim().toLowerCase().replace(/\s+/g, " ");
    return PROSE_PERIOD_MAP[key] || null;
  }

  function toProseAmount(text) {
    var n = parseFloat(String(text).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function parseCompFromProse(text) {
    if (!text) return null;
    var mRange = PROSE_FORMS[0].exec(text);
    if (mRange) {
      var minR = toProseAmount(mRange[1]), maxR = toProseAmount(mRange[2]), pR = resolveProsePeriod(mRange[3]);
      if (minR != null && maxR != null && pR) {
        return {
          salary_min: Math.min(minR, maxR), salary_max: Math.max(minR, maxR),
          salary_period: pR, salary_currency: "USD",
        };
      }
    }
    var mRangeCode = PROSE_FORMS[1].exec(text);
    if (mRangeCode) {
      var minC = toProseAmount(mRangeCode[1]), maxC = toProseAmount(mRangeCode[2]), pC = resolveProsePeriod(mRangeCode[3]);
      if (minC != null && maxC != null && pC) {
        return {
          salary_min: Math.min(minC, maxC), salary_max: Math.max(minC, maxC),
          salary_period: pC, salary_currency: "USD",
        };
      }
    }
    var mSingleCode = PROSE_FORMS[2].exec(text);
    if (mSingleCode) {
      var aSC = toProseAmount(mSingleCode[1]), pSC = resolveProsePeriod(mSingleCode[2]);
      if (aSC != null && pSC) {
        return { salary_min: aSC, salary_max: aSC, salary_period: pSC, salary_currency: "USD" };
      }
    }
    var mSingleSym = PROSE_FORMS[3].exec(text);
    if (mSingleSym) {
      var aSS = toProseAmount(mSingleSym[1]), pSS = resolveProsePeriod(mSingleSym[2]);
      if (aSS != null && pSS) {
        return { salary_min: aSS, salary_max: aSS, salary_period: pSS, salary_currency: "USD" };
      }
    }
    var mUnstatedBaseRange = PROSE_UNSTATED_BASE_RANGE.exec(text);
    if (mUnstatedBaseRange) {
      var minU = toProseAmount(mUnstatedBaseRange[1]), maxU = toProseAmount(mUnstatedBaseRange[2]);
      if (minU != null && maxU != null) {
        return {
          salary_min: Math.min(minU, maxU), salary_max: Math.max(minU, maxU),
          salary_currency: "USD", salary_period: null,
        };
      }
    }
    return null;
  }

  // Formats a parseCompFromProse() result into a human display string that
  // ALSO round-trips cleanly through the existing parseSalaryStructured()
  // (each side carries its own "$AMOUNT/PERIOD" token, which is exactly what
  // that function's regex expects) -- so setting `out.comp` to this string
  // lets the rest of the existing comp/salary/annualization pipeline in
  // parse() run completely unchanged.
  var PERIOD_ABBR = { hourly: "hr", daily: "day", weekly: "wk", biweekly: "biweekly", monthly: "mo", yearly: "yr" };
  function formatCompAmount(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }
  function formatCompDisplay(structured) {
    var sym = structured.salary_currency === "USD" ? "$" : structured.salary_currency + " ";
    if (!structured.salary_period) {
      var minUnstated = Number(structured.salary_min).toLocaleString("en-US", { maximumFractionDigits: 2 });
      var maxUnstated = Number(structured.salary_max).toLocaleString("en-US", { maximumFractionDigits: 2 });
      return sym + minUnstated + " - " + sym + maxUnstated + " (period not stated)";
    }
    var abbr = PERIOD_ABBR[structured.salary_period] || structured.salary_period;
    var minStr = sym + formatCompAmount(structured.salary_min) + "/" + abbr;
    if (structured.salary_max === structured.salary_min) return minStr;
    return minStr + " - " + sym + formatCompAmount(structured.salary_max) + "/" + abbr;
  }

  function parseApplicantCount(text) {
    if (!text) return null;
    var m = String(text).match(/(\d[\d,]*)/);
    if (!m) return null;
    var n = parseInt(m[1].replace(/,/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  }

  function mapEnum(value, table, hasOther) {
    if (!value) return null;
    var key = String(value).trim().toLowerCase();
    if (table[key]) return table[key];
    return hasOther ? "other" : null;
  }

  function mapRoleFamily(jobFunctionText) {
    if (!jobFunctionText) return null;
    for (var i = 0; i < ROLE_FAMILY_KEYWORDS.length; i++) {
      if (ROLE_FAMILY_KEYWORDS[i].re.test(jobFunctionText)) return ROLE_FAMILY_KEYWORDS[i].family;
    }
    return "other";
  }

  // LinkedIn's public "criteria" list (Seniority level / Employment type /
  // Job function / Industries) — present on the guest/public render.
  function readCriteria(doc) {
    var out = {};
    var items = doc.querySelectorAll(".description__job-criteria-item");
    for (var i = 0; i < items.length; i++) {
      var header = textOf(items[i].querySelector(".description__job-criteria-subheader")).toLowerCase();
      var value = textOf(items[i].querySelector(".description__job-criteria-text"));
      if (!value) continue;
      if (header.indexOf("seniority") !== -1) out.seniorityText = value;
      else if (header.indexOf("employment") !== -1) out.employmentTypeText = value;
      else if (header.indexOf("function") !== -1) out.jobFunctionText = value;
      else if (header.indexOf("industr") !== -1) out.industriesText = value;
    }
    return out;
  }

  // Badge/insight text lives in a handful of possible containers depending on
  // guest vs. logged-in render. These selectors are best-effort: none of them
  // matched on the logged-out fixture this adapter was validated against, so
  // they are UNVERIFIED against real logged-in markup and are expected to
  // gracefully degrade (return null/false) until spot-checked while logged in.
  function findInsightText(doc, patterns) {
    var nodes = doc.querySelectorAll(
      ".jobs-unified-top-card__job-insight, .job-details-jobs-unified-top-card__job-insight, " +
        ".topcard__flavor--bullet, .topcard__flavor--metadata, .artdeco-inline-feedback__message"
    );
    for (var i = 0; i < nodes.length; i++) {
      var t = textOf(nodes[i]);
      if (!t) continue;
      for (var j = 0; j < patterns.length; j++) {
        if (patterns[j].test(t)) return t;
      }
    }
    return null;
  }

  function hasBadge(doc, exactTextRe) {
    var nodes = doc.querySelectorAll(
      "button, span.artdeco-inline-feedback__message, .jobs-apply-button--top-card, " +
        ".jobs-unified-top-card__job-insight, .job-details-jobs-unified-top-card__job-insight"
    );
    for (var i = 0; i < nodes.length; i++) {
      if (exactTextRe.test(textOf(nodes[i]))) return true;
    }
    return false;
  }

  // Best-effort skills list (logged-in "Skills match" module). Tier is left
  // unset — LinkedIn's guest render doesn't label required-vs-preferred, and
  // guessing would violate faithful-tracker.
  function readSkills(doc) {
    var nodes = doc.querySelectorAll(
      ".job-details-how-you-match__skills-item-subtitle, .job-details-skill-match-status-list li, " +
        ".job-details-skill-match-modal__skill-name"
    );
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var name = textOf(nodes[i]);
      if (name) out.push({ skill: name });
    }
    return out;
  }

  // Best-effort hiring-contact card (logged-in "Meet the hiring team" panel).
  function readContacts(doc, base) {
    var cards = doc.querySelectorAll(".job-details-people-who-can-help__section .hirer-card, .hirer-card");
    var out = [];
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var link = card.querySelector("a[href*='/in/']");
      var name = textOf(card.querySelector(".hirer-card__hirer-information, .artdeco-entity-lockup__title")) || textOf(link);
      var role = textOf(card.querySelector(".hirer-card__hirer-job-title, .artdeco-entity-lockup__subtitle"));
      var contact = {};
      if (name) contact.name = name;
      if (role) contact.role = role;
      var profileUrl = link ? absolutizeUrl(link.getAttribute("href"), base) : null;
      if (profileUrl) contact.profile_url = profileUrl;
      if (/job poster/i.test(textOf(card))) contact.is_job_poster = true;
      if (contact.name || contact.profile_url) out.push(contact);
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // SDUI path (account-gated, logged-in render). Validated live 2026-07-16
  // against two real /jobs/view/<id> postings while logged in: the gated
  // job page is a Server-Driven UI render — components carry
  // data-sdui-component="com.linkedin.sdui.generated.jobseeker.dsl.impl.<name>"
  // and stable slot ids ("JobDetails<Name>Slot_<jobId>"), but CSS classes are
  // build-hashed and rotate, so every selector here is class-independent
  // (attribute/text-anchored). No JSON-LD is embedded on this render.
  // ---------------------------------------------------------------------

  function isSduiPage(doc) {
    return !!doc.querySelector('[data-sdui-component^="com.linkedin.sdui"]');
  }

  // Subtrees that carry their OWN badge/apply/applicant text describing a
  // DIFFERENT posting (the "More jobs" similar-jobs rail) or gated upsell
  // content unrelated to this posting. Badge/free-metric/apply/contact scans
  // must skip anything inside these or they hallucinate this posting's state
  // from a neighboring card (e.g. a similar-jobs card's own "Easy Apply" or
  // "You'd be a top applicant" text).
  var EXCLUDED_SDUI_SUBTREE_SEL =
    '[data-sdui-component*="similarJobs"], [id*="SimilarJobsSlot"], ' +
    '[data-sdui-component*="premiumApplicantInsights"], [data-sdui-component*="premiumCompanyInsights"], ' +
    '[data-sdui-component*="aboutTheCompany"], [data-sdui-component*="resumeReview"]';

  function ancestorChain(el) {
    var out = [];
    var cur = el;
    while (cur) {
      out.push(cur);
      cur = cur.parentNode;
    }
    return out;
  }

  function commonAncestor(a, b) {
    if (!a || !b) return null;
    var aChain = ancestorChain(a);
    var bChain = ancestorChain(b);
    for (var i = 0; i < aChain.length; i++) {
      if (bChain.indexOf(aChain[i]) !== -1) return aChain[i];
    }
    return null;
  }

  function getJobIdFromUrlStr(urlStr) {
    if (!urlStr) return null;
    var m = String(urlStr).match(/\/jobs\/view\/(\d+)/) || String(urlStr).match(/currentJobId=(\d+)/);
    return m ? m[1] : null;
  }

  function isLeftRailSibling(sibling, selectedJobId) {
    if (!sibling || sibling.nodeType !== 1) return false;
    if (sibling.closest && sibling.closest(EXCLUDED_SDUI_SUBTREE_SEL)) return false;
    if (sibling.querySelector && sibling.querySelector('[data-sdui-component*="search"], .jobs-search-results-list, .scaffold-layout__list')) {
      return true;
    }
    var text = textOf(sibling);
    if (/Jobs based on your preferences|results for|How promoted jobs are ranked/i.test(text)) {
      return true;
    }
    if (/Date posted.*Easy Apply.*Under 10 applicants/i.test(text)) {
      return true;
    }
    if (selectedJobId) {
      var jobLinks = sibling.querySelectorAll('a[href*="/jobs/view/"], a[href*="currentJobId="]');
      for (var i = 0; i < jobLinks.length; i++) {
        if (jobLinks[i].closest && jobLinks[i].closest(EXCLUDED_SDUI_SUBTREE_SEL)) continue;
        var href = jobLinks[i].getAttribute("href") || "";
        var id = getJobIdFromUrlStr(href);
        if (id && id !== selectedJobId) {
          return true;
        }
      }
    }
    return false;
  }

  function getSduiDetailBranch(doc, url) {
    var aboutTheJob = doc.querySelector('[data-sdui-component*="aboutTheJob"]');
    if (!aboutTheJob) return null;
    var selectedJobId = url ? jobIdFromUrl(url) : null;
    var curr = aboutTheJob;
    while (curr.parentElement && curr.parentElement !== doc.body && curr.parentElement.tagName !== "HTML") {
      var parent = curr.parentElement;
      var hasRailSibling = false;
      for (var i = 0; i < parent.children.length; i++) {
        var sib = parent.children[i];
        if (sib !== curr && isLeftRailSibling(sib, selectedJobId)) {
          hasRailSibling = true;
          break;
        }
      }
      if (hasRailSibling) {
        return curr;
      }
      curr = parent;
    }
    return curr;
  }

  // The detail region is the common ancestor of the free-tier applicant
  // metric text (e.g. "Over 100 people clicked apply") and the aboutTheJob
  // SDUI block. Constrained to the selected detail branch so multi-pane search
  // cards never bleed into this posting's metrics or region.
  function findSduiDetailRegion(doc, url) {
    var aboutTheJob = doc.querySelector('[data-sdui-component*="aboutTheJob"]');
    if (!aboutTheJob) return null;
    var branch = getSduiDetailBranch(doc, url) || aboutTheJob;
    var nodes = branch.querySelectorAll("*");
    var anchorRe = /clicked apply|applicants?/i;
    var anchor = null;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].closest(EXCLUDED_SDUI_SUBTREE_SEL)) continue;
      var t = textOf(nodes[i]);
      if (t && t.length <= 140 && anchorRe.test(t)) {
        anchor = nodes[i];
        break;
      }
    }
    if (anchor) {
      return commonAncestor(anchor, aboutTheJob);
    }
    return branch;
  }

  function scanSduiRegionText(region, re, maxLen) {
    if (!region) return null;
    var nodes = region.querySelectorAll("*");
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].closest(EXCLUDED_SDUI_SUBTREE_SEL)) continue;
      var t = textOf(nodes[i]);
      if (t && t.length <= maxLen && re.test(t)) return t;
    }
    return null;
  }

  // Innermost (childless) text-bearing elements in the region -- the tightest
  // possible text unit, so a short badge (e.g. "Contract", "$31/hr - $36/hr")
  // is returned on its own rather than concatenated with sibling badges'
  // text via a shared ancestor. excludeAboutTheJob skips the description
  // body itself, since real badges never live there (only comp-in-prose
  // does, and that's searched separately over the whole description string).
  function collectSduiLeafTexts(region, maxLen, excludeAboutTheJob) {
    var out = [];
    if (!region) return out;
    var nodes = region.querySelectorAll("*");
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].closest(EXCLUDED_SDUI_SUBTREE_SEL)) continue;
      if (excludeAboutTheJob && nodes[i].closest('[data-sdui-component*="aboutTheJob"]')) continue;
      if (nodes[i].children.length !== 0) continue;
      var t = textOf(nodes[i]);
      if (t && t.length <= maxLen) out.push(t);
    }
    return out;
  }

  // employment_type/seniority/workplace_type have no labeled criteria list on
  // SDUI (readCriteria()'s classes don't exist here) -- just a row of plain
  // badges with no header text identifying which is which. Detection is
  // therefore exact-match-only against each vocab's own known keys: a badge
  // whose text doesn't match any of the three tables is simply invisible to
  // this reader (never attributed to a category, never mapped to "other")
  // since there's no reliable way to tell "an unmapped badge of this
  // category" apart from unrelated short text -- omit-not-guess.
  function readSduiCriteria(region) {
    var texts = collectSduiLeafTexts(region, 20, true);
    var out = {};
    for (var i = 0; i < texts.length; i++) {
      var key = texts[i].trim().toLowerCase();
      if (!out.employmentTypeText && EMPLOYMENT_TYPE_MAP[key]) out.employmentTypeText = texts[i];
      if (!out.seniorityText && SENIORITY_MAP[key]) out.seniorityText = texts[i];
      if (!out.workplaceTypeText && WORKPLACE_TYPE_MAP[key]) out.workplaceTypeText = texts[i];
    }
    return out;
  }

  // comp-from-prose candidates (v3a item 1): try short badge-like leaf text
  // first (e.g. a dedicated "$31/hr - $36/hr" badge, when one exists), then
  // fall back to the full description prose (e.g. Amazon's SDUI postings
  // fold comp into a "USA, TX, Richardson - 23.00 - 37.00 USD hourly" line
  // inside the description body, with no dedicated comp badge at all).
  function findCompFromProse(region, description) {
    var badgeTexts = collectSduiLeafTexts(region, 40, true);
    for (var i = 0; i < badgeTexts.length; i++) {
      var hit = parseCompFromProse(badgeTexts[i]);
      if (hit) return hit;
    }
    return parseCompFromProse(description);
  }

  // The verified-hirer badge is an ICON, not text: LinkedIn renders
  // <span role="img" aria-label="Verified job"><svg id="verified-medium">...</svg></span>
  // beside the job title. A textContent scan can never see it, which is why every capture
  // stored verified=NULL even on a verified posting. Anchored on the accessible name
  // (and the icon id as a fallback), both of which are semantic rather than the hashed
  // class names this markup otherwise uses.
  //
  // Deliberately NOT a blanket svg[id^="verified"] match: the same page carries
  // "verified-small" icons for unrelated entities (people, companies), and treating those
  // as the JOB's badge would flip verified=true on postings that carry no such badge.
  function findVerifiedJobBadge(region) {
    if (!region) return null;
    var labelled = region.querySelectorAll('[aria-label]');
    for (var i = 0; i < labelled.length; i++) {
      if (labelled[i].closest(EXCLUDED_SDUI_SUBTREE_SEL)) continue;
      if (/^verified\s+job\b/i.test(labelled[i].getAttribute("aria-label") || "")) return labelled[i];
    }
    var medium = region.querySelector('svg[id="verified-medium"]');
    if (medium && !medium.closest(EXCLUDED_SDUI_SUBTREE_SEL)) return medium;
    return null;
  }

  function readSduiBadges(region) {
    var verifiedEl = findVerifiedJobBadge(region);
    return {
      promotedText: scanSduiRegionText(region, /\bpromoted( by hirer)?\b/i, 90),
      verifiedText: verifiedEl
        ? (verifiedEl.getAttribute("aria-label") || "Verified job")
        : scanSduiRegionText(region, /^verified$/i, 90),
      activelyReviewingText: scanSduiRegionText(region, /actively reviewing/i, 90),
      topApplicantMatchText: scanSduiRegionText(region, /top applicant/i, 90),
    };
  }

  // A posting that says it has stopped taking applications. This is the employer's own
  // statement, sitting in a snapshot Prospect already holds, so recording it needs no
  // crawler and no network call (DL-P8). Exact-ish phrases only: "closed" appears in
  // plenty of unrelated prose, and a false positive here would mark a live application
  // dead.
  var CLOSED_PHRASE_RE = /\b(?:no longer accepting applications|this job is no longer available|applications are closed)\b/i;

  function readSduiApplicationsClosed(region) {
    if (!region) return null;
    var nodes = region.querySelectorAll("*");
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].children.length) continue;
      if (nodes[i].closest(EXCLUDED_SDUI_SUBTREE_SEL)) continue;
      var t = textOf(nodes[i]);
      if (t && t.length <= 120 && CLOSED_PHRASE_RE.test(t)) return t;
    }
    return null;
  }

  // easy_apply=true iff the primary apply affordance in-region (excluding
  // similar-jobs cards) reads "Easy Apply" AND the region doesn't carry the
  // external-apply marker "Responses managed off LinkedIn".
  function readSduiEasyApply(region) {
    if (!region) return false;
    if (scanSduiRegionText(region, /responses managed off linkedin/i, 90)) return false;
    return !!scanSduiRegionText(region, /easy apply/i, 40);
  }

  // The primary Apply affordance in-region (excluding similar-jobs cards): an
  // <a target="_blank"> anchor whose visible text is exactly "Apply". Returns
  // the raw href (never the anchor), or null when no such anchor exists.
  function findSduiApplyHref(region) {
    if (!region) return null;
    var anchors = region.querySelectorAll('a[target="_blank"][href]');
    for (var i = 0; i < anchors.length; i++) {
      if (anchors[i].closest(EXCLUDED_SDUI_SUBTREE_SEL)) continue;
      var t = textOf(anchors[i]);
      if (t && t.trim().toLowerCase() === "apply") return anchors[i].getAttribute("href");
    }
    return null;
  }

  // Unwraps LinkedIn's /safety/go/?url=<encoded> interstitial to the genuine
  // external ATS target. An internal LinkedIn link (sign-in gate, search
  // results, anything not the safety-go wrapper) is never an apply target and
  // returns null -- omit-not-guess. Pure/unit-testable: takes a raw href, not
  // a DOM node.
  function extractApplyUrl(href) {
    if (!href) return null;
    var u;
    try {
      u = new global.URL(href, "https://www.linkedin.com");
    } catch (e) {
      return null;
    }
    var host = u.hostname.toLowerCase();
    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
      if (!/^\/safety\/go\/?$/.test(u.pathname)) return null;
      var wrapped = u.searchParams.get("url");
      if (!wrapped) return null;
      try {
        var t = new global.URL(wrapped);
        return t.protocol === "https:" || t.protocol === "http:" ? t.href : null;
      } catch (e2) {
        return null;
      }
    }
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  }

  // Use the structural applicant-stat reader for both top-level capture
  // fields. LinkedIn has two confirmed labels for the same markup:
  // "907 total / 31 in the past day" and
  // "268 Applicants / 3 Applicants in the past day".
  // Absent when the viewer has no Premium applicant-insights slot.
  function readSduiApplicantCounts(doc) {
    var out = {};
    var stats = parseSduiApplicantStats(doc);
    if (!stats) return out;
    if (stats.total != null) out.applicantCountText = String(stats.total);
    if (stats.past_day != null) out.applicantsLastDayText = String(stats.past_day);
    return out;
  }

  // "Meet the hiring team" (peopleWhoCanHelp slot) serializes as flattened
  // text with no sub-elements (e.g. "Jordan Poster • 2ndTechnical
  // RecruiterJob poster"), so this is a text-anchored parse, not a DOM
  // traversal. Captures ONLY the job-poster card — the slot's private
  // network-suggestions list (viewer's own connections) is never captured.
  function readSduiContacts(doc, base) {
    var slot = doc.querySelector('[id*="PeopleWhoCanHelpSlot"]');
    if (!slot) return [];
    var t = textOf(slot);
    var m = t.match(/Meet the hiring team\s*([A-Za-z][^•]*?)\s*•\s*\d+(?:st|nd|rd|th)\s*([\s\S]*?)Job poster/i);
    if (!m) return [];
    var name = m[1].trim();
    var role = m[2].trim();
    var link = slot.querySelector("a[href*='/in/']");
    var contact = { is_job_poster: true };
    if (name) contact.name = name;
    if (role) contact.role = role;
    var profileUrl = link ? absolutizeUrl(link.getAttribute("href"), base) : null;
    if (profileUrl) contact.profile_url = profileUrl;
    return contact.name || contact.profile_url ? [contact] : [];
  }

  // ---------------------------------------------------------------------
  // SDUI long-tail fields (v3a item 4): parsed.benefits / candidate_pool /
  // normalized_role / industries / company_review_time / apply_nuance. Each
  // reads a specific structural anchor (not a loose scan); absent -> omitted.
  // ---------------------------------------------------------------------

  // "Benefits found in job post" is a bold-toggle panel that sits AFTER the
  // aboutTheJob "…more" cutoff (findSduiAboutBody() deliberately stops
  // there), so it's read separately here. Observed shape is a single <p>
  // sibling holding either one item ("401(k)") or a comma-separated list
  // ("401(k), Medical insurance, Vision insurance, Dental insurance").
  function findSduiBenefits(doc) {
    var headers = doc.querySelectorAll("p");
    for (var i = 0; i < headers.length; i++) {
      if (headers[i].closest(EXCLUDED_SDUI_SUBTREE_SEL)) continue;
      if (!/^benefits found in job post$/i.test(textOf(headers[i]))) continue;
      var sib = headers[i].nextElementSibling;
      if (!sib || sib.tagName !== "P") return null;
      var items = textOf(sib).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      return items.length ? items : null;
    }
    return null;
  }

  // The premiumApplicantInsightsForJobDetails slot's "total applicants" /
  // "applicants in the past day" stat pair. Structural (not phrasing-
  // dependent) since the two live fixtures use different label wording
  // ("total" / "in the past day" vs "Applicants" / "Applicants in the past
  // day") for the same shape: a header h3, then flat alternating
  // number/label children.
  function parseSduiApplicantStats(doc) {
    var slot = doc.querySelector('[data-sdui-component*="premiumApplicantInsights"]');
    if (!slot) return null;
    var headers = slot.querySelectorAll("h3");
    var header = null;
    for (var i = 0; i < headers.length; i++) {
      if (/candidates who clicked apply|applicants for this job/i.test(textOf(headers[i]))) {
        header = headers[i];
        break;
      }
    }
    if (!header) return null;
    // Each stat (total, past-day) is its OWN sibling <div> after the header
    // -- not one shared container -- each flattening to e.g. "907total" or
    // "31in the past day" (no separating whitespace in the source markup).
    // Collect the stats IN ORDER first, then assign. The earlier version assigned inside the
    // walk with "past day" as the only discriminator and `else out.total = n`, which meant a
    // recency label LinkedIn has not used yet did not merely fail to be recognised -- it fell
    // through to the else and OVERWROTE the total with the past-day number. Silently reporting
    // 31 applicants for a posting that has 907 is worse than reporting none, which is exactly
    // the failure mode H8(a) was opened about.
    var stats = [];
    var sib = header.nextElementSibling;
    var hops = 0;
    while (sib && sib.tagName === "DIV" && hops < 6) {
      var m = textOf(sib).match(/^(\d[\d,]*)\s*(.*)$/);
      if (m) {
        var n = parseInt(m[1].replace(/,/g, ""), 10);
        if (Number.isFinite(n)) stats.push({ n: n, label: m[2] || "" });
      }
      sib = sib.nextElementSibling;
      hops++;
    }
    if (!stats.length) return null;

    // A recency label is the authoritative signal when present -- both live fixtures carry one
    // ("in the past day" / "Applicants in the past day"), just worded differently.
    var out = {};
    var recencyRe = /past day|last day|past 24|last 24|today/i;
    var remaining = [];
    for (var s2 = 0; s2 < stats.length; s2++) {
      if (out.past_day == null && recencyRe.test(stats[s2].label)) out.past_day = stats[s2].n;
      else remaining.push(stats[s2]);
    }
    // Whatever is left falls back to POSITION rather than to phrasing: the slot renders the
    // running total first and the recency figure second, so an unfamiliar label still lands
    // correctly instead of clobbering a value that was already read.
    if (remaining.length) out.total = remaining[0].n;
    if (out.past_day == null && remaining.length > 1) out.past_day = remaining[1].n;

    return out.total != null || out.past_day != null ? out : null;
  }

  // Seniority breakdown from the same slot ("65% Entry level candidates" /
  // "63% Entry level people applied for this job" -- phrasing again differs
  // between the two fixtures, so this anchors on the stable "N% <Label>
  // level" fragment common to both rather than the trailing phrase).
  function parseSduiSeniorityMix(doc) {
    var slot = doc.querySelector('[data-sdui-component*="premiumApplicantInsights"]');
    if (!slot) return null;
    var t = textOf(slot);
    var re = /(\d+)%\s+([A-Za-z]+)\s+level\b/gi;
    var out = {};
    var m;
    while ((m = re.exec(t)) !== null) {
      out[slugify(m[2]) + "_level"] = parseInt(m[1], 10);
    }
    return Object.keys(out).length ? out : null;
  }

  function readSduiCandidatePool(doc) {
    var stats = parseSduiApplicantStats(doc);
    var mix = parseSduiSeniorityMix(doc);
    var out = {};
    if (stats && stats.total != null) out.total = stats.total;
    if (stats && stats.past_day != null) out.past_day = stats.past_day;
    if (mix) out.seniority_mix = mix;
    return Object.keys(out).length ? out : null;
  }

  function findSduiCompanyReviewTime(region) {
    var t = scanSduiRegionText(region, /company review time is typically/i, 90);
    if (!t) return null;
    var m = t.match(/company review time is typically\s+(.+?)[.\s]*$/i);
    return m ? m[1].trim() : null;
  }

  // Reuses the same anchor readSduiEasyApply() checks for external-apply
  // detection, surfaced here as its own long-tail field. Extracts just the
  // matched phrase (not the whole containing element's flattened text,
  // which may also carry an unrelated "Promoted by hirer" prefix).
  function findSduiApplyNuance(region) {
    var t = scanSduiRegionText(region, /responses managed off linkedin/i, 90);
    if (!t) return null;
    var m = t.match(/responses managed off linkedin/i);
    return m ? m[0] : null;
  }

  // No aboutTheCompany component was present on either fixture this adapter
  // was validated against (industries/company legal name were only
  // observable inline in the description on the one fixture that had them --
  // see findCompanyLegalNameInDescription()). This reads a dedicated slot
  // IF LinkedIn renders one; omits (never guesses) when absent -- a live
  // spot-check against a posting that shows an "About the company" panel is
  // needed to confirm the real shape.
  function readSduiAboutCompany(doc) {
    var out = {};
    var slot = doc.querySelector('[data-sdui-component*="aboutTheCompany"]');
    if (!slot) return out;
    var nodes = slot.querySelectorAll("p, span");
    for (var i = 0; i < nodes.length; i++) {
      if (!/^industr/i.test(textOf(nodes[i]))) continue;
      var sib = nodes[i].nextElementSibling;
      if (!sib) break;
      var items = textOf(sib).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      if (items.length) out.industries = items;
      break;
    }
    return out;
  }

  // LinkedIn's normalized job-function label has no confirmed SDUI anchor on
  // either fixture this adapter was validated against -- no badge distinct
  // from the employment/workplace/seniority badges (readSduiCriteria) was
  // observed. Reads a dedicated slot if LinkedIn ever names one; omits
  // (never guesses) when absent -- a live spot-check is needed to confirm
  // the real anchor.
  function readSduiNormalizedRole(doc) {
    var slot = doc.querySelector(
      '[data-sdui-component*="normalizedJobFunction"], [data-sdui-component*="normalizedTitle"]'
    );
    var t = slot ? textOf(slot) : "";
    return t || null;
  }

  // Skills-match + required/preferred tiers are NOT in the static SDUI DOM:
  // howYouFitGuide exposes only action buttons ("Show match details" etc.);
  // the actual list is behind a Premium modal not present until expanded.
  // Graceful degrade: omit rather than guess.
  function readSduiGatedFields(doc, url, region) {
    var badges = readSduiBadges(region);
    var counts = readSduiApplicantCounts(doc);
    return {
      applicantCountText: counts.applicantCountText || null,
      applicantsLastDayText: counts.applicantsLastDayText || null,
      activelyReviewingText: badges.activelyReviewingText,
      topApplicantMatchText: badges.topApplicantMatchText,
      promotedText: badges.promotedText,
      verified: !!badges.verifiedText,
      applicationsClosedText: readSduiApplicationsClosed(region),
      easyApply: readSduiEasyApply(region),
      applyUrl: extractApplyUrl(findSduiApplyHref(region)),
      skills: [],
      contacts: readSduiContacts(doc, url),
    };
  }

  // ---------------------------------------------------------------------
  // SDUI core fields (role/company/location/posted_at/comp/description).
  // Unlike the gated fields above, these have NO guest/JSON-LD equivalent on
  // the logged-in render (no JSON-LD is embedded, and none of the guest CSS
  // classes exist), so every logged-in capture needs this path. Validated
  // live 2026-07-16 against the same two postings as the gated-field pass:
  //   - role/company: document.title is "<role> | <company> | LinkedIn"
  //     (LinkedIn prepends "(N) " when the viewer has unread notifications).
  //   - location/posted_at: a single top-card line reading
  //     "<City, ST> · Reposted N days ago · Over 100 people clicked apply".
  //   - description: the aboutTheJob SDUI block, body text after its
  //     "About the job" <h2> header.
  //   - comp (v3a): no dedicated comp DOM anchor exists on either posting,
  //     but a comp figure shows up as free text -- either a short badge
  //     ("$31/hr - $36/hr") or folded into the description prose ("...
  //     Richardson - 23.00 - 37.00 USD hourly..."). findCompFromProse()
  //     covers both shapes; comp stays omitted (never guessed) when neither
  //     yields an unambiguous match.
  // ---------------------------------------------------------------------

  // "<role> | <company> | LinkedIn", with an optional "(3) " unread-count
  // prefix stripped first. A company name that itself contains " | " is
  // preserved by treating every segment between the first and last as company.
  function parseSduiTitleRoleCompany(doc) {
    var raw = (doc.title || "").replace(/^\(\d+\)\s*/, "").trim();
    if (!raw) return null;
    var parts = raw.split(" | ");
    for (var i = 0; i < parts.length; i++) parts[i] = parts[i].trim();
    if (parts.length < 3) return null;
    if (parts[parts.length - 1].toLowerCase() !== "linkedin") return null;
    var role = parts[0];
    var company = parts.slice(1, parts.length - 1).join(" | ");
    if (!role || !company) return null;
    return { role: role, company: company };
  }

  // Fallback/corroboration for company: the first /company/ link outside the
  // excluded subtrees (similar-jobs cards carry their own company links).
  function findSduiCompanyLink(doc) {
    var links = doc.querySelectorAll('a[href*="/company/"]');
    for (var i = 0; i < links.length; i++) {
      if (links[i].closest(EXCLUDED_SDUI_SUBTREE_SEL)) continue;
      var t = textOf(links[i]);
      if (t) return links[i];
    }
    return null;
  }

  // The top-card metric line ("<location> · Reposted N days ago · ...").
  // Scans for the SMALLEST matching element rather than the first: a
  // first-match scan (document order visits parents before children) would
  // return an ancestor whose flattened text happens to also satisfy the
  // pattern by virtue of containing the metric line plus other text — the
  // tight <p> itself is the minimal (most specific) match.
  // A bare relative-age token, i.e. the age WITHOUT a "Posted"/"Reposted" prefix.
  // LinkedIn renders both shapes: "Dallas, TX · Reposted 5 days ago · ..." on some
  // postings and "Dallas, TX · 5 days ago · ..." on others. Requiring the prefix is
  // what silently lost location AND posted_at on every capture from the bare variant
  // (claims #16 and #18 both stored NULL for both, with the values plainly present in
  // their snapshots).
  var RELATIVE_AGE_RE = /^(?:just now|today|yesterday|\d+\s*(?:minute|hour|day|week|month|year)s?\s+ago)$/i;

  function findSduiMetricLine(region) {
    if (!region) return null;
    var nodes = region.querySelectorAll("*");
    var best = null;
    var bestLen = Infinity;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].closest(EXCLUDED_SDUI_SUBTREE_SEL)) continue;
      var t = textOf(nodes[i]);
      if (!t || t.length > 200 || t.length >= bestLen) continue;
      if (t.indexOf("·") === -1) continue;
      if (!hasAgeSegment(t)) continue;
      best = nodes[i];
      bestLen = t.length;
    }
    return best;
  }

  // True when any "·"-separated segment carries the posting age, in either shape.
  function hasAgeSegment(text) {
    var parts = String(text).split("·");
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i].trim();
      if (/^(?:reposted|posted)\b/i.test(seg)) return true;
      if (RELATIVE_AGE_RE.test(seg)) return true;
    }
    return false;
  }

  function parseSduiMetricLine(text) {
    var out = {};
    if (!text) return out;
    var rawParts = text.split("·");
    var parts = [];
    for (var i = 0; i < rawParts.length; i++) {
      var p = rawParts[i].trim();
      if (p) parts.push(p);
    }
    // The first segment is the location UNLESS it is itself the age -- a posting with
    // no location renders "5 days ago · Over 100 people clicked apply", and taking that
    // as the location would store a date string in the location column.
    if (parts.length && !/^(?:reposted|posted)\b/i.test(parts[0]) && !RELATIVE_AGE_RE.test(parts[0])) {
      out.location = parts[0];
    }
    for (var j = 0; j < parts.length; j++) {
      var m = parts[j].match(/^(?:reposted|posted)\s+(.+)$/i);
      if (m) {
        out.posted_at = m[1].trim();
        break;
      }
      if (RELATIVE_AGE_RE.test(parts[j])) {
        out.posted_at = parts[j];
        break;
      }
    }
    return out;
  }

  // Last-resort structural fallback for role/company, used only when neither
  // the title nor a /company/ link is usable (e.g. an unexpected title
  // shape). Mirrors the guest-render three-tier top-card shape (company,
  // role, metric line) using the metric line's own parent as the card
  // boundary, so it can never reach outside this posting's own top card.
  function readSduiCardFallback(metricEl) {
    var out = {};
    var card = metricEl && metricEl.parentNode;
    if (!card || !card.children) return out;
    var kids = card.children;
    var texts = [];
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] === metricEl) break;
      var t = textOf(kids[i]);
      if (t && t.length <= 200) texts.push(t);
    }
    if (texts.length >= 1) out.company = texts[0];
    if (texts.length >= 2) out.role = texts[1];
    return out;
  }

  // The aboutTheJob slot's body, excluding its own "About the job" <h2>
  // header chrome and anything from the first trailing "…more" toggle
  // button/<hr> onward (a distinct panel, e.g. "Benefits found in job
  // post"). Returns a plain array of sibling element nodes rather than a
  // live DOM element — enough for segmentDescription()'s childNodes-shaped
  // scan, without mutating the page.
  function findSduiAboutBody(doc) {
    var aboutEl = doc.querySelector('[data-sdui-component*="aboutTheJob"]');
    if (!aboutEl) return null;
    var h2 = aboutEl.querySelector("h2");
    if (!h2 || !/about the job/i.test(textOf(h2))) return null;
    var headerContainer = h2.parentNode;
    var parent = headerContainer ? headerContainer.parentNode : null;
    // childNodes (not children/element-only): some postings fold real
    // content -- e.g. Amazon's "USA, TX, Richardson - 23.00 - 37.00 USD
    // hourly" comp line -- into a bare text node sandwiched between <br>
    // elements rather than wrapping it in its own tag. An element-only scan
    // silently drops that text; htmlOfNodes() already handles mixed
    // element/text nodes (nodeType 1 vs textContent), it just never used to
    // receive any text nodes to handle.
    if (!parent || !parent.childNodes) return null;
    var kids = parent.childNodes;
    var headerIdx = -1;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] === headerContainer) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) return null;
    var body = [];
    for (var j = headerIdx + 1; j < kids.length; j++) {
      var kid = kids[j];
      if (kid.nodeType === 1 && (kid.tagName === "HR" || kid.tagName === "BUTTON")) break;
      body.push(kid);
    }
    return body.length ? body : null;
  }

  function htmlOfNodes(nodes) {
    var html = "";
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      html += n.nodeType === 1 ? n.outerHTML : n.textContent || "";
    }
    return html.trim();
  }

  // v3a item 3: sanitizes a raw HTML string down to a small semantic
  // allowlist, purely via string tokenization (no DOMParser/document
  // dependency, so this works identically as an injected content script and
  // under Node -- the SAME requirement that keeps the rest of this file
  // dependency-free). <script>/<style> are dropped with their content;
  // every other non-allowlisted element is UNWRAPPED (its tag is dropped,
  // its inner text/children survive) rather than deleted outright. Every
  // attribute is stripped except <a href>, which is kept ONLY when it's an
  // http(s) URL -- any other scheme (or a missing href) unwraps the <a>
  // itself rather than emitting a bare/dangerous link. Never applied to
  // `raw`/raw_payload -- see the faithful-tracker note in parse().
  var DESCRIPTION_ALLOWLIST = { p: 1, ul: 1, ol: 1, li: 1, a: 1, strong: 1, b: 1, em: 1, i: 1, br: 1, h3: 1, h4: 1 };
  var DESCRIPTION_VOID_TAGS = { br: 1 };
  var DESCRIPTION_TAG_RE =
    /<!--[\s\S]*?-->|<\/\s*([a-zA-Z][a-zA-Z0-9]*)\s*>|<\s*([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*)?)(\/)?\s*>|[^<]+/g;

  function extractHrefAttr(attrsRaw) {
    var m = attrsRaw.match(/href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'|href\s*=\s*([^\s"'>]+)/i);
    return m ? m[1] || m[2] || m[3] || "" : "";
  }

  function cleanDescriptionHtml(html) {
    if (!html) return "";
    var stripped = String(html)
      .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
      .replace(/<style[\s\S]*?<\/style\s*>/gi, "");

    var out = "";
    var stack = [];
    var m;
    DESCRIPTION_TAG_RE.lastIndex = 0;
    while ((m = DESCRIPTION_TAG_RE.exec(stripped)) !== null) {
      var token = m[0];
      if (token.charAt(0) !== "<") {
        out += token;
        continue;
      }
      if (token.indexOf("<!--") === 0) continue;

      if (m[1]) {
        // Closing tag: pop the matching stack entry (tolerant of unbalanced
        // markup) and emit "</tag>" only if that tag was itself kept.
        var closeName = m[1].toLowerCase();
        for (var i = stack.length - 1; i >= 0; i--) {
          if (stack[i].tag === closeName) {
            if (stack[i].keep) out += "</" + closeName + ">";
            stack.length = i;
            break;
          }
        }
        continue;
      }

      var tagName = m[2].toLowerCase();
      var attrsRaw = m[3] || "";
      var selfClosing = !!m[4] || !!DESCRIPTION_VOID_TAGS[tagName];
      var keep = !!DESCRIPTION_ALLOWLIST[tagName];
      var hrefVal = "";
      if (keep && tagName === "a") {
        hrefVal = extractHrefAttr(attrsRaw);
        if (!/^https?:\/\//i.test(hrefVal)) keep = false; // unwrap: no href or a non-http(s) scheme
      }

      if (keep) {
        out += tagName === "a" ? '<a href="' + hrefVal.replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '">' : "<" + tagName + ">";
      }
      if (!selfClosing) stack.push({ tag: tagName, keep: keep });
    }
    for (var j = stack.length - 1; j >= 0; j--) {
      if (stack[j].keep) out += "</" + stack[j].tag + ">";
    }
    return out.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  }

  // url is needed (beyond doc/region) to absolutize the company link, so
  // this takes the same (doc, url, region) shape as readSduiGatedFields.
  function readSduiCoreFields(doc, url, region) {
    var out = {};

    var titleFields = parseSduiTitleRoleCompany(doc);
    if (titleFields) {
      out.role = titleFields.role;
      out.company = titleFields.company;
    }

    var companyLink = findSduiCompanyLink(doc);
    if (companyLink) {
      if (!out.company) out.company = textOf(companyLink);
      var href = companyLink.getAttribute("href");
      if (href) out.companyUrl = absolutizeUrl(href, url);
    }

    var metricEl = findSduiMetricLine(region);
    if (metricEl) {
      var metricFields = parseSduiMetricLine(textOf(metricEl));
      if (metricFields.location) out.location = metricFields.location;
      if (metricFields.posted_at) out.posted_at = metricFields.posted_at;

      if (!out.role || !out.company) {
        var fallback = readSduiCardFallback(metricEl);
        if (!out.company && fallback.company) out.company = fallback.company;
        if (!out.role && fallback.role) out.role = fallback.role;
      }
    }

    var aboutBody = findSduiAboutBody(doc);
    if (aboutBody) {
      out.descriptionEl = { childNodes: aboutBody };
      out.description = htmlOfNodes(aboutBody);
      var legalName = findCompanyLegalNameInDescription(aboutBody);
      if (legalName) out.companyLegalName = legalName;
    }

    var compProse = findCompFromProse(region, out.description || "");
    if (compProse) {
      out.comp = formatCompDisplay(compProse);
      out.compStructured = compProse;
    }

    return out;
  }

  // A "<strong>Company</strong> - Amazon.com Services LLC" style line,
  // observed inline in the aboutTheJob description body (not a dedicated
  // aboutTheCompany slot -- that component doesn't exist on either fixture
  // this adapter was validated against). Walks the <strong>'s remaining
  // sibling nodes up to the next <br> (or end of its parent), then strips
  // the leading "- " separator. Returns null (never guesses) when no such
  // label is present.
  function findCompanyLegalNameInDescription(aboutBody) {
    if (!aboutBody) return null;
    for (var i = 0; i < aboutBody.length; i++) {
      var node = aboutBody[i];
      if (node.nodeType !== 1) continue;
      // The <strong>Company</strong> label is sometimes itself a top-level
      // aboutBody node (not nested in a wrapping container), so it has to be
      // checked directly -- querySelectorAll() only finds descendants.
      var strongs = node.tagName === "STRONG" ? [node] : node.querySelectorAll ? node.querySelectorAll("strong") : [];
      for (var j = 0; j < strongs.length; j++) {
        if (!/^company$/i.test(textOf(strongs[j]))) continue;
        var text = "";
        var cursor = strongs[j].nextSibling;
        var hops = 0;
        while (cursor && hops < 20) {
          if (cursor.nodeType === 1 && cursor.tagName === "BR") break;
          text += cursor.textContent || "";
          cursor = cursor.nextSibling;
          hops++;
        }
        var cleaned = text.replace(/^[\s:\-–—]+/, "").trim();
        if (cleaned) return cleaned;
      }
    }
    return null;
  }

  function slugify(text) {
    return String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
  }

  function classifySectionHeader(headerText) {
    var t = headerText.toLowerCase();
    if (/why|about|who we are|company overview/.test(t)) return "about";
    if (/what you.?ll do|responsib/.test(t)) return "responsibilities";
    if (/looking for|require|thrive|qualif/.test(t)) return "requirements";
    if (/benefit|perk|we offer/.test(t)) return "benefits";
    return null;
  }

  // Best-effort structural segmentation of the description into named
  // sections (responsibilities/requirements/benefits/about/...), based on
  // LinkedIn's common pattern of a bold header followed by a bullet list.
  // Never throws; returns null (no sections) rather than guessing when the
  // description doesn't follow that pattern.
  function segmentDescription(descriptionEl) {
    if (!descriptionEl || !descriptionEl.childNodes) return null;
    var sections = {};
    var currentKey = null;
    var found = false;

    function addItems(items) {
      if (!currentKey || !items.length) return;
      sections[currentKey] = (sections[currentKey] || []).concat(items);
      found = true;
    }

    var nodes = descriptionEl.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.nodeType !== 1) continue; // element nodes only
      var tag = node.tagName;
      if (tag === "STRONG") {
        var headerText = textOf(node);
        if (headerText && headerText.length <= 80 && /:\s*$/.test(headerText)) {
          var cleaned = headerText.replace(/:\s*$/, "");
          currentKey = classifySectionHeader(cleaned) || ("other_" + slugify(cleaned));
        }
        continue;
      }
      if (tag === "UL" || tag === "OL") {
        var lis = node.querySelectorAll("li");
        var items = [];
        for (var j = 0; j < lis.length; j++) {
          var t = textOf(lis[j]);
          if (t) items.push(t);
        }
        addItems(items);
      }
    }
    return found ? sections : null;
  }

  // Selectors confirmed against a live logged-out linkedin.com/jobs/view/<id>
  // page on 2026-07-15/16 (guest render; class-based). Both the account-
  // gated fields AND the six core fields (role/company/location/comp/
  // posted_at/description) additionally branch to an SDUI path (see
  // isSduiPage/readSduiGatedFields/readSduiCoreFields above) when logged in
  // — confirmed live 2026-07-16 against two real postings. On the logged-in
  // SDUI render there is no JSON-LD AND none of the guest classes below
  // exist, so the SDUI branch is not optional there; it's the only source.
  // JSON-LD is checked first and preferred whenever present (guest render).
  function readDom(doc, url) {
    var flavorRow = doc.querySelector(".top-card-layout .topcard__flavor-row");
    var locationEl = flavorRow ? flavorRow.querySelector(".topcard__flavor--bullet") : null;
    var descriptionEl =
      doc.querySelector(".description__text--rich .show-more-less-html__markup") ||
      doc.querySelector(".description__text--rich");
    var orgLink = doc.querySelector(".topcard__org-name-link, .topcard__flavor--black-link");

    var sduiRegion = isSduiPage(doc) ? findSduiDetailRegion(doc, url) : null;
    // Guest render exposes labeled criteria classes; SDUI has no labels, so
    // it gets its own exact-match badge reader (readSduiCriteria) instead.
    var criteria = sduiRegion ? readSduiCriteria(sduiRegion) : readCriteria(doc);
    var longTail = sduiRegion
      ? {
          benefits: findSduiBenefits(doc),
          candidatePool: readSduiCandidatePool(doc),
          normalizedRole: readSduiNormalizedRole(doc),
          industries: readSduiAboutCompany(doc).industries || null,
          companyReviewTime: findSduiCompanyReviewTime(sduiRegion),
          applyNuance: findSduiApplyNuance(sduiRegion),
        }
      : {};
    var gated = sduiRegion
      ? readSduiGatedFields(doc, url, sduiRegion)
      : {
          applicantCountText: textOf(doc.querySelector(".num-applicants__caption")),
          applicantsLastDayText: findInsightText(doc, [/applicants? in the last/i]),
          activelyReviewingText: findInsightText(doc, [/actively reviewing/i]),
          topApplicantMatchText: findInsightText(doc, [/top applicant/i]),
          promotedText: findInsightText(doc, [/^promoted$/i]),
          verified: hasBadge(doc, /^verified$/i),
          easyApply: hasBadge(doc, /easy apply/i),
          skills: readSkills(doc),
          contacts: readContacts(doc, url),
        };
    var core = sduiRegion
      ? readSduiCoreFields(doc, url, sduiRegion)
      : {
          role: textOf(doc.querySelector("h1.topcard__title, .top-card-layout__title")),
          company: textOf(doc.querySelector(".topcard__org-name-link, .topcard__flavor--black-link")),
          companyUrl: orgLink ? absolutizeUrl(orgLink.getAttribute("href"), url) : null,
          location: textOf(locationEl),
          posted_at: textOf(doc.querySelector(".posted-time-ago__text")),
          comp: textOf(doc.querySelector(".compensation__salary")),
          descriptionEl: descriptionEl,
          description: descriptionEl ? descriptionEl.innerHTML.trim() : "",
        };

    return {
      role: core.role || "",
      company: core.company || "",
      companyUrl: core.companyUrl || null,
      location: core.location || "",
      posted_at: core.posted_at || "",
      comp: core.comp || "",
      compStructured: core.compStructured || null,
      companyLegalName: core.companyLegalName || null,
      descriptionEl: core.descriptionEl,
      description: core.description || "",
      criteria: criteria,
      applicantCountText: gated.applicantCountText,
      applicantsLastDayText: gated.applicantsLastDayText,
      activelyReviewingText: gated.activelyReviewingText,
      topApplicantMatchText: gated.topApplicantMatchText,
      promotedText: gated.promotedText,
      verified: gated.verified,
      applicationsClosedText: gated.applicationsClosedText || null,
      easyApply: gated.easyApply,
      applyUrl: gated.applyUrl || null,
      skills: gated.skills,
      contacts: gated.contacts,
      benefits: longTail.benefits || null,
      candidatePool: longTail.candidatePool || null,
      normalizedRole: longTail.normalizedRole || null,
      industries: longTail.industries || null,
      companyReviewTime: longTail.companyReviewTime || null,
      applyNuance: longTail.applyNuance || null,
    };
  }

  function captureRawHtml(doc, url) {
    var twoPane = isTwoPaneUrl(url);
    var sduiRegion = isSduiPage(doc) ? findSduiDetailRegion(doc, url) : null;

    if (twoPane) {
      if (sduiRegion) {
        var panels = [sduiRegion];
        var helpSlot = sduiRegion.querySelector('[id*="PeopleWhoCanHelpSlot"]');
        if (!helpSlot) {
          var branch = getSduiDetailBranch(doc, url);
          if (branch) {
            var branchHelp = branch.querySelector('[id*="PeopleWhoCanHelpSlot"]');
            if (branchHelp && branchHelp !== sduiRegion) {
              panels.push(branchHelp);
            }
          }
        }
        return panels.map(function (el) { return el.outerHTML; }).join("\n");
      }
      return "";
    }

    var panels = [
      doc.querySelector(".top-card-layout"),
      doc.querySelector(".decorated-job-posting__details"),
      // Best-effort extra coverage for logged-in-only regions (skills match,
      // hiring team panel) on the guest-render class scheme. No-ops (filtered
      // out) when absent, e.g. on the SDUI render, which has no such classes.
      doc.querySelector(".job-details-people-who-can-help__section"),
      doc.querySelector(".job-details-how-you-match__container"),
      // SDUI render: the detail region found for gated-field extraction, plus
      // the peopleWhoCanHelp slot (may sit outside that region).
      sduiRegion,
      doc.querySelector('[id*="PeopleWhoCanHelpSlot"]'),
    ].filter(Boolean);
    if (panels.length) {
      return panels.map(function (el) { return el.outerHTML; }).join("\n");
    }
    var main = doc.querySelector("#main-content, main");
    if (main) return main.outerHTML;
    return doc.body ? doc.body.outerHTML : "";
  }

  function parse(doc, url, options) {
    var jsonLd = readJsonLd(doc);
    var dom = readDom(doc, url);
    // Defaults to now, which is right for a live capture. A caller RE-READING a stored snapshot
    // must pass that snapshot's own capture time instead: posted_at is derived from a relative
    // label ("5 days ago"), so anchoring an old snapshot to today would silently write a date
    // that is wrong by however long the snapshot has been sitting in the database.
    var capturedAt = (options && options.capturedAt) || new Date().toISOString();

    var fields = {
      source: ADAPTER_SOURCE,
      source_url: canonicalUrl(url),
    };

    var jsonLdFields = {};
    if (jsonLd && jsonLd.data) {
      var p = jsonLd.data;
      jsonLdFields.role = p.title || "";
      jsonLdFields.company = (p.hiringOrganization && p.hiringOrganization.name) || "";
      jsonLdFields.location = flattenLocation(p.jobLocation);
      jsonLdFields.posted_at = p.datePosted || ""; // schema.org datePosted is already absolute ISO 8601
      jsonLdFields.comp = flattenSalary(p.baseSalary);
      jsonLdFields.description = p.description || "";
    }

    // DOM fills anything JSON-LD didn't provide (or everything, when there's
    // no JSON-LD on the page at all, which is the common case observed live).
    var role = jsonLdFields.role || dom.role;
    var company = jsonLdFields.company || dom.company;
    var location = jsonLdFields.location || dom.location;
    var comp = jsonLdFields.comp || dom.comp;
    var description = jsonLdFields.description || dom.description;
    var postedAt = jsonLdFields.posted_at || normalizeRelativeDate(dom.posted_at, capturedAt) || "";

    if (role) fields.role = role;
    if (company) fields.company = company;
    if (location) fields.location = location;
    if (comp) fields.comp = comp;
    if (description) fields.description = cleanDescriptionHtml(description);
    if (postedAt) fields.posted_at = postedAt;

    var jobIdMatch = /\bJob ID:?\s*([A-Za-z0-9-]{4,})/i.exec(fields.description || "");
    if (jobIdMatch) fields.external_job_id = jobIdMatch[1];
    if (dom.applyUrl) fields.apply_url = dom.applyUrl;

    var jobId = jobIdFromUrl(url);
    if (jobId) fields.job_id = jobId;
    if (dom.companyUrl) fields.company_url = dom.companyUrl;

    if (location) {
      var loc = splitLocation(location);
      if (loc.location_city) fields.location_city = loc.location_city;
      if (loc.location_state) fields.location_state = loc.location_state;
      if (loc.location_metro) fields.location_metro = loc.location_metro;
    }

    var employmentType = mapEnum(dom.criteria.employmentTypeText, EMPLOYMENT_TYPE_MAP, EMPLOYMENT_TYPE_HAS_OTHER);
    if (employmentType) fields.employment_type = employmentType;
    var seniority = mapEnum(dom.criteria.seniorityText, SENIORITY_MAP, false);
    if (seniority) fields.seniority = seniority;
    var roleFamily = mapRoleFamily(dom.criteria.jobFunctionText);
    if (roleFamily) fields.role_family = roleFamily;
    // Workplace type has no dedicated public-DOM badge observed on the
    // logged-out fixture; best-effort match against the flattened location
    // string only (e.g. "New York, NY (Hybrid)"), else omitted.
    var workplaceMatch = location && location.match(/\((remote|hybrid|on-site|onsite)\)/i);
    var workplaceType = workplaceMatch ? mapEnum(workplaceMatch[1], WORKPLACE_TYPE_MAP, false) : null;
    // SDUI fallback: no parenthesized location suffix exists there, but its
    // own exact-match badge reader (readSduiCriteria) may have found one.
    if (!workplaceType && dom.criteria.workplaceTypeText) {
      workplaceType = mapEnum(dom.criteria.workplaceTypeText, WORKPLACE_TYPE_MAP, false);
    }
    if (workplaceType) fields.workplace_type = workplaceType;

    if (comp) {
      fields.comp_disclosed = true;
      var salary = parseSalaryStructured(comp);
      // A prose range with no stated period is still disclosed compensation.
      // Carry its exact amounts/currency, but leave salary_period absent so the
      // server cannot annualize or compare it as though a period were known.
      if (dom.compStructured && salary.salary_min == null) salary = dom.compStructured;
      if (salary.salary_min != null) fields.salary_min = salary.salary_min;
      if (salary.salary_max != null) fields.salary_max = salary.salary_max;
      if (salary.salary_period) fields.salary_period = salary.salary_period;
      if (salary.salary_currency) fields.salary_currency = salary.salary_currency;
    } else {
      fields.comp_disclosed = false;
    }

    var applicantCount = parseApplicantCount(dom.applicantCountText);
    if (applicantCount != null) fields.applicant_count = applicantCount;
    var applicantsLastDay = parseApplicantCount(dom.applicantsLastDayText);
    if (applicantsLastDay != null) fields.applicants_last_day = applicantsLastDay;
    if (dom.activelyReviewingText) fields.actively_reviewing = true;
    if (dom.topApplicantMatchText) fields.top_applicant_match = true;
    if (dom.promotedText) fields.promoted = true;
    if (dom.verified) fields.verified = true;
    if (dom.easyApply) fields.easy_apply = true;

    if (dom.skills && dom.skills.length) fields.skills = dom.skills;
    if (dom.contacts && dom.contacts.length) fields.contacts = dom.contacts;

    var sections = segmentDescription(dom.descriptionEl);
    var longTail = {};
    if (dom.benefits && dom.benefits.length) longTail.benefits = dom.benefits;
    if (dom.candidatePool) longTail.candidate_pool = dom.candidatePool;
    if (dom.normalizedRole) longTail.normalized_role = dom.normalizedRole;
    if (dom.industries && dom.industries.length) longTail.industries = dom.industries;
    if (dom.companyLegalName) longTail.company_legal_name = dom.companyLegalName;
    if (dom.companyReviewTime) longTail.company_review_time = dom.companyReviewTime;
    if (dom.applyNuance) longTail.apply_nuance = dom.applyNuance;
    // The employer's own "no longer accepting applications" statement, verbatim, plus a
    // boolean for callers that only need the fact. Lives in the parsed long tail rather
    // than a listings column: it is adapter-derived, so it belongs with the other
    // provenance-tagged derivations, and server/index.js turns it into a §3.5b vendor
    // status observation at capture time.
    if (dom.applicationsClosedText) {
      longTail.applications_closed = true;
      longTail.applications_closed_text = dom.applicationsClosedText;
    }

    if (sections || description || Object.keys(longTail).length) {
      var parsed = { parsed_by: "adapter" };
      if (sections) parsed.sections = sections;
      for (var longTailKey in longTail) {
        if (Object.prototype.hasOwnProperty.call(longTail, longTailKey)) parsed[longTailKey] = longTail[longTailKey];
      }
      fields.parsed = parsed;
    }

    var missing = [];
    ["company", "role", "location", "comp", "description", "posted_at"].forEach(function (key) {
      if (!fields[key]) missing.push(key);
    });

    var raw = {
      jsonLd: jsonLd ? jsonLd.raw : null,
      jobDetailHtml: captureRawHtml(doc, url),
      url: url,
      capturedAt: capturedAt,
    };

    return { fields: fields, raw: raw, missing: missing };
  }

  var adapter = {
    id: "linkedin",
    source: ADAPTER_SOURCE,
    match: match,
    parse: parse,
    canonicalUrl: canonicalUrl,
    jobIdFromUrl: jobIdFromUrl,
    // Exposed for direct unit testing (v3a items 1/3, v3b apply-url unwrap);
    // not part of the adapter's registry-facing contract (match/parse/canonicalUrl).
    parseCompFromProse: parseCompFromProse,
    cleanDescriptionHtml: cleanDescriptionHtml,
    extractApplyUrl: extractApplyUrl,
    // H8: the applicant-stat reader and the badge reader, exposed on the same
    // test-only footing as the three above so their behaviour is pinned by
    // assertions rather than by the comments that describe them.
    parseSduiApplicantStats: parseSduiApplicantStats,
    hasBadge: hasBadge,
    // Exposed for the H8/live-regression tests: the metric-line reader that silently lost
    // location and posted_at, the icon-based verified-badge reader, and the closure reader.
    findSduiMetricLine: findSduiMetricLine,
    parseSduiMetricLine: parseSduiMetricLine,
    findVerifiedJobBadge: findVerifiedJobBadge,
    readSduiApplicationsClosed: readSduiApplicationsClosed,
    normalizeRelativeDate: normalizeRelativeDate,
  };

  global.ProspectAdapters = global.ProspectAdapters || {};
  global.ProspectAdapters.linkedin = adapter;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = adapter;
  }
})(typeof self !== "undefined" ? self : globalThis);
