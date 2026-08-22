/*
 * Injected into the active tab on demand (never a persistent content
 * script — no manifest content_scripts entry, no auto-run). Hands the page
 * to the registry and returns the adapter result. Runs in the tab's
 * isolated world alongside the matched adapter(s) and registry.js, which
 * registry.fileList() orders ahead of this file in the same
 * chrome.scripting.executeScript call.
 */
(function (global) {
  "use strict";

  function collect() {
    var registry = global.ProspectAdapters && global.ProspectAdapters.registry;
    if (!registry) {
      return { error: "adapters not loaded" };
    }
    var adapter = registry.findAdapter(global.location.href);
    if (!adapter) {
      return { error: "no adapter for this site" };
    }
    try {
      var result = adapter.parse(global.document, global.location.href);
      return { adapterId: adapter.id, result: result };
    } catch (e) {
      // Even an unexpected parse failure should not lose the capture:
      // fall back to a raw-only snapshot with everything marked missing.
      return {
        adapterId: adapter.id,
        result: {
          fields: {
            source: adapter.source || adapter.id || "",
            source_url: adapter.canonicalUrl ? adapter.canonicalUrl(global.location.href) : global.location.href,
            company: "",
            role: "",
            location: "",
            comp: "",
            description: "",
            posted_at: "",
          },
          raw: {
            jsonLd: null,
            jobDetailHtml: global.document.body ? global.document.body.outerHTML : "",
            url: global.location.href,
            capturedAt: new Date().toISOString(),
          },
          missing: ["company", "role", "location", "comp", "description", "posted_at"],
        },
        parseError: String(e && e.message ? e.message : e),
      };
    }
  }

  global.__prospectCollect = collect;
})(typeof self !== "undefined" ? self : globalThis);
