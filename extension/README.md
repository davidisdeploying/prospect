# Prospect Capture (browser extension)

User-initiated, per-listing capture of job postings into Prospect. Click "Stake
this claim" on a job posting you're looking at; it captures that one listing on
that one tab. No bulk crawling, no auto-run, no background scraping.

## Load unpacked (Chrome)

1. `chrome://extensions`
2. Enable "Developer mode" (top right).
3. "Load unpacked" -> select this directory (`prospect-ext/`, the folder
   containing `manifest.json`).
4. Pin the "Prospect Capture" icon to the toolbar if you want it visible.

## Setting the API endpoint

The popup defaults to `https://alpha.tail3327f9.ts.net:8443`. The legacy
`http://alpha.tail3327f9.ts.net:8787` origin remains permitted during the
transition and is an explicit Safari physical-device compatibility gate. To point it
elsewhere: open the popup -> "Endpoint settings" -> enter the new base URL ->
Save. Chrome will prompt for permission to reach that origin the first time
(this is `optional_host_permissions` being requested at runtime, not a fixed
broad permission baked into the manifest).

## How a capture works

1. You click "Stake this claim" in the popup, on the active tab.
2. `popup.js` injects `src/adapters/linkedin.js`, `src/adapters/registry.js`,
   and `src/content/collector.js` into that tab only (`chrome.scripting`,
   `activeTab` — no persistent content script, nothing runs until you click).
3. `collector.js` asks the registry for an adapter matching the tab's URL,
   runs it, and returns `{ fields, raw, missing }` to the popup.
4. The popup shows the parsed fields for you to eyeball.
5. On confirm, `capture.js` builds the `POST /api/claims` body (`raw_payload`
   is the JSON-stringified raw snapshot, kept separate from the parsed
   fields) and sends it to the configured endpoint.
6. If the endpoint is unreachable, the built request body is saved to
   `chrome.storage.local` and the popup offers Retry — the capture is not
   lost, even if you close the popup before retrying.

## Adding a new site adapter

1. Create `src/adapters/<site>.js` exporting `{ id, match(url), parse(document, url) }`
   (copy the shape of `linkedin.js` — it self-registers onto
   `global.ProspectAdapters.<site>` and also does a CommonJS `module.exports`
   so it can be unit-tested under Node).
2. Add `"<site>"` to the `ADAPTER_IDS` array in `src/adapters/registry.js`.
   That's the only edit to shared code — existing adapters are untouched.
3. Add the new file to the `ADAPTER_FILES` list in `src/popup/popup.js` (the
   files injected into the tab on capture).
4. `parse()` must never throw on a partial page: return whatever fields it
   found, the raw snapshot, and a `missing` array for anything it couldn't
   resolve, rather than failing the whole capture.

## What's captured as "raw"

The raw snapshot (`raw_payload` in the API body) is the JSON-LD script text
if the page has one, the outerHTML of the job-detail DOM panel, the page URL,
and a capture timestamp. It is stored verbatim and never mutated — it's the
source of truth if a listing is later deleted or reposted with different
content. Parsed fields (`company`, `role`, `location`, ...) are best-effort
derivations from that same page, kept in a separate object.

## Known follow-ups (not done here)

- `git commit` of this tree on delta (deliberately left for the next step).
- Wiring the GitHub remote.
- Physical-device Safari validation of both the default HTTPS endpoint and the
  legacy HTTP endpoint. Do not add a Cloudflare service token or alternate
  ingress to make the HTTP check pass.
- Swapping `icons/*.png` (flat-color placeholders) for the real
  design-system gold-pan mark.
- LinkedIn gates full listing content behind login for logged-out/guest
  requests in some cases; a logged-in manual spot-check is worth doing since
  this adapter was validated against a logged-out public fetch.
