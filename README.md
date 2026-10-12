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

## Automatic application packages

Schema 29 adds a durable `application_generation_jobs` queue. A future claim is queued exactly once when it
actually enters Staked; an already-Staked no-op and a previously linked Scout claim do not enqueue. Migration
and service startup never backfill existing claims. An explicit Regenerate action creates a new immutable
request only after the current listing snapshot, Career evidence, audited baseline, and deterministic audit
are all resolved.

The package worker owns this local lifecycle:

```text
queued -> auditing -> drafting -> rendering -> ready
                                 \-> needs_review / failed
```

Deterministic job audits are complete as soon as their evidence matrix is stored. Optional Ollama synthesis is
tracked separately as enrichment (`synthesis_status`, `synthesis_error`) and cannot block package readiness.
During drafting, the worker uses Tower's trusted loopback Streamable HTTP endpoint. Tower receives a fresh,
single-use token and `seat=auto`, `provider=auto`, `lane=prompts`, `task_size=medium`, `target_host=scalar`, and
the fixed staging collision scope. Tests inject `FakePackageProvider`; they never call Tower or consume quota.

Rendering uses Node built-ins only—no browser, LibreOffice, Python, global package, or external network. Each
generation writes a new directory beneath:

```text
~/Vaults/career-vault/files/YYYY/YYYY-MM-DD/prospect-worker-prospect-package-<package-id>/
```

It contains résumé and cover-letter DOCX/PDF files plus `verification.json` and `MANIFEST.md`. Prospect records
the four document hashes. Downloads accept an artifact ID only and re-check path containment, regular-file
status, and SHA-256 before returning a private, no-store attachment.

### Operator lifecycle

Production rollout is deliberately separate from source development. After a verified database backup and
source review, the strategy operator may install and migrate explicitly:

```sh
cd ~/prospect
npm ci
PROSPECT_DB_PATH=~/prospect/data/prospect.db node server/migrate.js
install -m 0644 deploy/prospect-package-worker.service ~/.config/systemd/user/prospect-package-worker.service
systemctl --user daemon-reload
systemctl --user enable --now prospect-package-worker.service
```

The service environment is:

- `PROSPECT_DB_PATH` — exact schema-29 database.
- `PROSPECT_PACKAGE_STAGING_ROOT` — private per-job draft staging root; defaults to
  `~/prospect/data/application-generation`.
- `CAREER_ARTIFACT_ROOT` — governed Career `files/` root.
- `TOWER_MCP_URL` — defaults to trusted Scalar loopback `http://127.0.0.1:8765/mcp`.
- `CAREER_CLAIMS_PATH` — canonical Career evidence source used by audits/readiness.

Workers atomically lease one job, recover expired leases, and use bounded attempts with retry backoff. A
staged draft with verified token metadata resumes without another dispatch. Missing or stale source inputs,
or ambiguous prior Tower state, stop at `needs_review` rather than hallucinating or looping. Inspect with
`systemctl --user status prospect-package-worker.service` and `journalctl --user -u
prospect-package-worker.service`; resolve the stated input error and use Regenerate for a new immutable run.

This automation never submits an application, emails an employer, changes an external profile, or moves a
claim after the initiating Staked transition. Human review and any later external action remain separate.

## Layout

- Design system: `./design-system/`
- Data: `./data/prospect.db`
