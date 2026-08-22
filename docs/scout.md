# Scout

Scout is Prospect's pre-application inbox. It ranks job leads against a versioned candidate
profile without creating listings or claims. A discovery enters the faithful tracker only after
David opens the posting and deliberately uses the existing Prospect Capture extension.

## Pipeline

1. LinkedIn produces native daily job-alert emails and notifications.
2. Apple Mail forwards matching alerts from `owner@example.com` to Gmail.
3. The read-only Gmail worker verifies the embedded LinkedIn sender, converts job links into the
   JSON contract below, and imports them directly into Scout.
4. Prospect stores an immutable sighting snapshot, deduplicates the job, and assigns a transparent
   deterministic fit score using the latest candidate-profile version.
5. David reviews `/scout`, shortlists or dismisses the lead, and opens promising jobs on LinkedIn.
6. Prospect Capture stakes the verified posting in `Showings`. Matching LinkedIn job IDs
   automatically mark the Scout lead `captured` and link it to the claim.

This deliberately does not run a LinkedIn scraper or unattended browser. Native alerts are the
compliant discovery source; Chrome and the extension remain the authenticated verification and
capture path.

## Configure the profile

After migration 014 and a server restart:

```sh
node scripts/scout-feed.mjs profile
```

The default profile is in `config/scout-profile.json`. Saving it creates an append-only version;
existing lead assessments keep the profile version that produced them.

## Import contract

```json
{
  "source": "linkedin-alert",
  "message_id": "provider-message-id",
  "jobs": [
    {
      "external_job_id": "1234567890",
      "source_url": "https://www.linkedin.com/jobs/view/1234567890/",
      "apply_url": "https://www.linkedin.com/jobs/view/1234567890/",
      "company": "Example Co",
      "role": "Desktop Support Technician",
      "location": "Dallas, Texas",
      "description": "Optional alert excerpt",
      "posted_at": "2026-07-29",
      "raw_payload": "The exact source record or email-derived job block"
    }
  ]
}
```

Run an import manually or from an authorized mail worker:

```sh
PROSPECT_BASE_URL=http://127.0.0.1:8787 \
  node scripts/scout-feed.mjs import /path/to/linkedin-alert.json
```

Imports are idempotent by source/job identity and snapshot hash. Repeat alerts update
`last_seen_at` and append a new sighting only when the raw snapshot changed.

## Gmail worker

The OAuth client and refresh token live outside Git under `data/scout-gmail/`, mode `0600`.
The only granted scope is:

```text
https://www.googleapis.com/auth/gmail.readonly
```

The worker searches only `from:owner@example.com newer_than:30d`, then rejects any message
whose forwarded body does not contain `jobalerts-noreply@linkedin.com`. It does not send, delete,
label, archive, or mark mail read. Migration 015 stores one bounded receipt per Gmail message ID;
message bodies are not retained in the receipt table.

Manual checks:

```sh
node scripts/scout-gmail.mjs dry-run
node scripts/scout-gmail.mjs run
```

Production scheduling uses the user units in `deploy/prospect-scout-gmail.{service,timer}`. The
timer runs daily around 9:15 AM America/Chicago and is persistent across downtime. Apple Mail is
still the forwarding hop, so the Mac must be awake with Mail running for new LinkedIn alerts to
reach Gmail.
