/*
 * Maps the active tab's URL to the right adapter. The ONLY place that knows
 * which sites are supported. Adding a new site = a new adapters/*.js file
 * that registers itself on global.ProspectAdapters, plus one line in the
 * ADAPTER_IDS list below. No edits to any existing adapter file.
 */
(function (global) {
  "use strict";

  var ADAPTERS = [{ id: "linkedin", file: "src/adapters/linkedin.js" }];

  function findAdapter(url) {
    var adapters = global.ProspectAdapters || {};
    for (var i = 0; i < ADAPTERS.length; i++) {
      var adapter = adapters[ADAPTERS[i].id];
      if (adapter && adapter.match(url)) return adapter;
    }
    return null;
  }

  // Ordered file list for chrome.scripting.executeScript injection: every
  // registered adapter's script, then this registry, then the generic
  // collector. Adding a site is one ADAPTERS entry above, nothing else.
  function fileList() {
    return ADAPTERS.map(function (a) {
      return a.file;
    }).concat(["src/adapters/registry.js", "src/content/collector.js"]);
  }

  global.ProspectAdapters = global.ProspectAdapters || {};
  global.ProspectAdapters.registry = { findAdapter: findAdapter, fileList: fileList };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { findAdapter: findAdapter, fileList: fileList };
  }
})(typeof self !== "undefined" ? self : globalThis);
