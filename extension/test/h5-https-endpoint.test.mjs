// H5 — the capture endpoint moves to HTTPS via `tailscale serve`.
//
// What this actually buys is worth being precise about, because the naive version of the claim is
// wrong: the extension already posted over the tailnet, which is WireGuard-encrypted end to end, so
// this does NOT add confidentiality that was missing. What it adds is a real certificate and a
// secure browsing context, so the capture path stops being a plaintext origin.
//
// Port 8443 rather than 443 because 443 on alpha already proxies compendium-ota. The plaintext
// endpoint is deliberately left listening and still permitted, so an extension that has not been
// reloaded keeps working through the switchover.
//
// Run: node test/h5-https-endpoint.test.mjs   (from extension/)

import { readFileSync } from "node:fs";

global.self = global;
await import("../src/lib/config.js");
const config = global.ProspectConfig;

let failures = 0;
function assert(cond, label) {
  console.log((cond ? "PASS" : "FAIL") + " — " + label);
  if (!cond) failures++;
}

console.log("=== default endpoint ===");
assert(config.DEFAULT_ENDPOINT === "https://alpha.tail3327f9.ts.net:8443",
  "default endpoint is the HTTPS tailnet endpoint");
assert(config.DEFAULT_ENDPOINT.startsWith("https://"),
  "default is a secure context, not a plaintext origin");

console.log("=== superseded endpoints are retired, deliberate overrides are not ===");
assert(config.isSupersededEndpoint("http://alpha.tail3327f9.ts.net:8787") === true,
  "the plaintext alpha endpoint is retired (H5)");
assert(config.isSupersededEndpoint("http://alpha.tail3327f9.ts.net:8787/") === true,
  "a trailing slash does not defeat the migration");
assert(config.isSupersededEndpoint("http://delta.tail3327f9.ts.net:8787") === true,
  "the delta endpoint stays retired (host moved 2026-08-06)");
assert(config.isSupersededEndpoint(config.DEFAULT_ENDPOINT) === false,
  "the current default is obviously not superseded");
assert(config.isSupersededEndpoint("http://localhost:8787") === false,
  "a deliberate local override is never silently discarded");
assert(config.isSupersededEndpoint("http://192.168.1.50:8787") === false,
  "nor is a deliberate LAN override");

console.log("=== manifest permission follows the endpoint ===");
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const origin = new URL(config.DEFAULT_ENDPOINT).origin + "/*";
assert(manifest.host_permissions.includes(origin),
  "manifest grants the default endpoint origin (" + origin + ")");
assert(manifest.host_permissions.includes("http://alpha.tail3327f9.ts.net:8787/*"),
  "the plaintext origin stays permitted so an un-reloaded extension keeps working");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
