# Prospect

Prospect is a self-hosted, local-first job-application tracker.

- Local-first: no paid or AI runtime dependency.
- Faithful-tracker: the scraped listing snapshot is kept verbatim and distinct
  from the user's own notes/edits; every stage transition is recorded.

## Running this

Node plus SQLite, with a browser extension loaded separately. No paid or AI
runtime dependency — the local-first constraint is deliberate.

```sh
npm ci
npm run dev:api      # server
npm run dev:web      # app
npm test             # node --test
```

`data/` holds `prospect.db` and is gitignored: the database is rebuilt from
schema plus your own captures, and nothing personal is tracked.

`config/scout-profile.json` ships a **generic example** profile. Scout scores
listings against whatever profile has been saved into the database, so seed it
once with your own and the tracked file stays an example:

```sh
node scripts/scout-feed.mjs profile config/scout-profile.local.json
```

`extension/` loads unpacked in a Chromium browser. `deploy/` holds systemd units
as worked examples; they assume this repository at `~/prospect`.

## Pipeline stages

Showings -> Staked -> Working the Vein -> Strike, plus Tailings.

## Layout

- Design system: `./design-system/`
- Data: `./data/prospect.db`
