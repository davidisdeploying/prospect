/*
 * Turns an adapter result ({ fields, raw, missing }) into the POST
 * /api/claims request body. raw_payload is the verbatim JSON.stringify of
 * the raw snapshot — kept distinct from (never merged into) the parsed
 * fields, per FAITHFUL-TRACKER.
 */
(function (global) {
  "use strict";

  // Scalar/string/number/boolean fields forwarded verbatim when the adapter
  // resolved them. Exactly the keys POST /api/claims reads off req.body (per
  // server/index.js, read on delta 2026-07-16) — nothing else, so we never
  // ship a key the backend silently ignores. Server-derived fields
  // (annual_comp*, applicants_per_day, desc_hash, posting_quality,
  // company_id, applied_at) are intentionally NOT in this list.
  var PASSTHROUGH_KEYS = [
    "company", "company_url", "role", "location", "comp", "description", "posted_at",
    "job_id", "external_job_id", "apply_url", "location_city", "location_state", "location_metro",
    "employment_type", "workplace_type", "seniority", "role_family",
    "salary_min", "salary_max", "salary_period", "salary_currency", "comp_disclosed",
    "applicant_count", "applicants_last_day",
    "easy_apply", "promoted", "verified", "actively_reviewing", "top_applicant_match",
  ];

  function buildClaimBody(adapterResult) {
    var fields = adapterResult.fields || {};
    var raw = adapterResult.raw || {};

    var body = {
      source: fields.source || "",
      source_url: fields.source_url || "",
      raw_payload: JSON.stringify(raw),
    };

    // Optional fields: only attach when the adapter actually resolved them,
    // so a partial parse doesn't ship empty strings/placeholders as if they
    // were real data. comp_disclosed is a real boolean (incl. false), so it
    // uses an explicit undefined check rather than a truthiness check.
    PASSTHROUGH_KEYS.forEach(function (key) {
      var value = fields[key];
      if (value !== undefined && value !== null && value !== "") body[key] = value;
    });

    // Arrays: omitted entirely (not sent as []) when the adapter found none.
    if (fields.skills && fields.skills.length) body.skills = fields.skills;
    if (fields.contacts && fields.contacts.length) body.contacts = fields.contacts;

    // parsed carries the adapter's provenance tag; raw_payload above never does.
    if (fields.parsed) body.parsed = fields.parsed;

    return body;
  }

  function postClaim(endpoint, body) {
    return global
      .fetch(endpoint.replace(/\/$/, "") + "/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      .then(function (res) {
        if (!res.ok) {
          return res
            .text()
            .catch(function () { return ""; })
            .then(function (text) {
              var snippet = text ? ": " + text.slice(0, 200) : "";
              var err = new Error("HTTP " + res.status + " " + res.statusText + snippet);
              err.status = res.status;
              throw err;
            });
        }
        return res.json().catch(function () { return {}; });
      });
  }

  var api = { buildClaimBody: buildClaimBody, postClaim: postClaim };

  global.ProspectCapture = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof self !== "undefined" ? self : globalThis);
