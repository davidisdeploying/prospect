/*
 * Endpoint configuration. Default points at the API on alpha over
 * Tailscale (moved from delta on 2026-08-06); user-overridable via
 * chrome.storage.local. Never hard-code secrets here — there are none to
 * hard-code, the API takes no auth today.
 *
 * H5 (2026-08-09): moved from http://…:8787 to https://…:8443, which is
 * `tailscale serve` terminating TLS in front of the same local port. Tailnet
 * traffic was already WireGuard-encrypted, so this buys a real certificate and
 * a secure browsing context rather than confidentiality that was missing. Port
 * 8443 rather than 443 because 443 on this host already proxies compendium-ota;
 * the plain-HTTP endpoint is deliberately left listening so an extension that
 * has not been reloaded yet keeps working.
 */
(function (global) {
  "use strict";

  var DEFAULT_ENDPOINT = "https://alpha.tail3327f9.ts.net:8443";
  var STORAGE_KEY = "prospectEndpoint";

  // Endpoints that were once correct and are not any more. Deliberately a list of
  // exact retired values rather than a pattern: a user's own deliberate override
  // (a laptop-local port, a test server) must never be silently discarded.
  var SUPERSEDED_ENDPOINTS = [
    "http://delta.tail3327f9.ts.net:8787",
    "http://alpha.tail3327f9.ts.net:8787",
  ];

  function isSupersededEndpoint(stored) {
    var normalized = String(stored).replace(/\/+$/, "");
    for (var i = 0; i < SUPERSEDED_ENDPOINTS.length; i++) {
      if (normalized === SUPERSEDED_ENDPOINTS[i]) return true;
    }
    // Any remaining delta spelling is retired regardless of port/scheme.
    return normalized.indexOf("delta.tail3327f9.ts.net") !== -1;
  }

  function getEndpoint() {
    return new Promise(function (resolve) {
      if (!global.chrome || !global.chrome.storage) {
        resolve(DEFAULT_ENDPOINT);
        return;
      }
      global.chrome.storage.local.get([STORAGE_KEY], function (items) {
        var stored = items && items[STORAGE_KEY];
        if (stored && typeof stored === "string" && isSupersededEndpoint(stored)) {
          // A stored override that history has retired: the delta host (moved to
          // alpha 2026-08-06) or the plaintext alpha endpoint (superseded by the
          // H5 HTTPS endpoint 2026-08-09). Clearing it falls back to DEFAULT_ENDPOINT
          // rather than silently keeping David on the old one forever — a stored
          // value would otherwise outlive every future move.
          global.chrome.storage.local.remove([STORAGE_KEY], function () {
            resolve(DEFAULT_ENDPOINT);
          });
          return;
        }
        resolve(stored || DEFAULT_ENDPOINT);
      });
    });
  }

  // Custom (non-default) endpoints need an optional host permission grant
  // before fetch() will be allowed to reach them cross-origin. Must be
  // called from a user gesture (e.g. a popup click handler).
  function requestEndpointPermission(endpoint) {
    var origin = new global.URL(endpoint).origin + "/*";
    if (!global.chrome || !global.chrome.permissions) {
      return Promise.resolve(true);
    }
    return new Promise(function (resolve) {
      global.chrome.permissions.request({ origins: [origin] }, function (granted) {
        resolve(!!granted);
      });
    });
  }

  function setEndpoint(endpoint) {
    return requestEndpointPermission(endpoint).then(function (granted) {
      if (!granted) return false;
      return new Promise(function (resolve) {
        if (!global.chrome || !global.chrome.storage) {
          resolve(true);
          return;
        }
        var payload = {};
        payload[STORAGE_KEY] = endpoint;
        global.chrome.storage.local.set(payload, function () {
          resolve(true);
        });
      });
    });
  }

  global.ProspectConfig = {
    DEFAULT_ENDPOINT: DEFAULT_ENDPOINT,
    SUPERSEDED_ENDPOINTS: SUPERSEDED_ENDPOINTS,
    isSupersededEndpoint: isSupersededEndpoint,
    getEndpoint: getEndpoint,
    setEndpoint: setEndpoint,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.ProspectConfig;
  }
})(typeof self !== "undefined" ? self : globalThis);
