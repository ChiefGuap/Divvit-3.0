# Divvit Engine API

One engine, two front ends. The dashboard calls it today; the app calls the
same endpoints when its UI is ready. Nothing about screening or verification
is reimplemented on either side, so there is no second copy of a fraud check
to drift out of sync.

## Why it is a service and not a library

The dashboard used to reach the engine by spawning a Python subprocess. That
only works because the browser and the engine share a machine. A phone cannot
spawn Python, cannot run ffmpeg, and should not hold a TwelveLabs key — so
that design would have forced a second implementation for the app.

Screening also *cannot* move to the client. It needs the original video file,
ffmpeg frame extraction, and a paid model call. The app uploads; the engine
decides.

## Running it

```bash
DIVVIT_DEV_TOKENS="devtok:creator_demo" \
  .venv/bin/uvicorn services.api.app:app --port 8787 --reload
```

The dashboard reads `DIVVIT_ENGINE_URL` (default `http://127.0.0.1:8787`) and
`DIVVIT_ENGINE_TOKEN`. With the engine down, the dashboard returns **503 with
a hint**, never a rejection — an outage is not fraud, at the transport layer
just as at the gate layer.

## Identity comes from the token, never the body

`creator_id` is resolved from the bearer token and is not a request field.
This is not a style choice: a client that can name itself can claim to be
someone else, and ownership, duplicate detection and payout all key off that
name. It is the same hole that `connected` had.

`DIVVIT_DEV_TOKENS` is a placeholder for real session auth. **Unset, the
service returns 503 rather than defaulting to open.**

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/health` | liveness, version, whether auth is configured |
| POST | `/v1/screen` | screen a video **before** posting (multipart) |
| POST | `/v1/claims` | run a posted link through the five gates |
| GET | `/v1/claims` | this creator's claim history |
| GET | `/v1/links/preview` | resolve a link without recording a claim |
| POST | `/v1/accounts/link` | link a platform account |
| GET | `/v1/accounts` | this creator's linked accounts |
| POST | `/v1/rechecks/run` | T+7 liveness sweep (operational) |

### POST /v1/screen

`multipart/form-data`: `video` (file), `venue` (string), `location` (optional).
Max 200MB; `video/mp4`, `quicktime`, `webm`, `x-m4v`.

Must run before the creator posts. Neither platform returns the video
afterwards, so this is the only moment the real file exists on our side, and
the fingerprint taken here is what a later claim matches the posted cover
frame against.

### POST /v1/claims

```json
{ "url": "https://www.tiktok.com/@you/video/123", "handle": "you",
  "tier": 2, "submission_id": null }
```

**The response shape is identical on every exit** — a resolve failure, a
duplicate post, and a full gate run all return these keys, so a client never
branches on which path produced it:

```json
{
  "verdict": "auto_approve | auto_approve_soft | hold_for_review | reject | retry",
  "tier": 2,
  "user_message": "one line written for the creator",
  "gates": [{ "gate": "...", "status": "pass|soft|fail|no_data|retry|skipped",
              "reason": "...", "evidence": {} }],
  "post": { "handle": "...", "caption": "...", "thumbnail_url": "...",
            "embed_html": "...", "created_at": "...", "created_at_source": "snowflake" },
  "soft_passes": ["ownership"],
  "submission_id": "sub_… | null",
  "screened": true,
  "ownership_proof": { "connected": false, "reason": "..." },
  "claim_id": "clm_… | null"
}
```

Gate order is `resolve → ownership → window → content_match → screening`, and
it short-circuits: a private post costs one HTTP call, not five. Gates after a
hard failure report `skipped` rather than being omitted, so the audit trail
shows what was never reached.

## Notes for the app

- **Show `user_message`, never `reason`.** `reason` is the engine's own words,
  for staff. Gate names read as accusations and scores are what a fraudster
  would calibrate against.
- **`retry` is not a rejection.** Show "we'll keep trying" with *no* call to
  action — the creator did nothing wrong, and a retry button implies they did.
- **Poll nothing.** `/v1/claims` is synchronous; a claim takes about two
  seconds unless the venue model runs.
- **`/v1/links/preview` before claiming** lets you show the post and say up
  front that an Instagram link cannot be checked, before the creator commits.
- **Screening takes 10-90s** because of the venue model. Show progress; the
  five step labels the dashboard uses are in `app/collection/claim/page.tsx`.

## Not built

- Real session auth. The dev token map must be replaced before deploying.
- Rate limiting, request size limits above the 200MB cap, and per-creator
  quotas.
- OAuth callbacks. `/v1/accounts/link` records a link as `manual` — unproven —
  and only a real callback may ever pass `oauth_verified`.
- Async screening. A 90s synchronous upload is acceptable on a laptop and
  marginal on mobile data; a job id and a poll endpoint are the fix when it
  starts hurting.
