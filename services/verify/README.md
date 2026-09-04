# Divvit Verify — post links, and what they can and cannot prove

Implements the five gates from `docs/Divvit verification link MD`. Everything
below was measured against the live endpoints on 2026-09-01, not taken from
the spec on trust.

## The constraint that shapes everything

**Neither platform returns the video after posting.**

| | TikTok oEmbed | Instagram pasted link |
|---|---|---|
| Ownership | asserted (`author_unique_id`) | weak (display name) |
| Caption | yes | **none** |
| Timestamp | **none returned** — decoded from the id | **none, and underivable** |
| Media | cover frame + embed player | thumbnail |
| Cost of entry | none: no key, no app review | app review, scoped to *embedding* |

Confirmed field set from the live oEmbed: `author_unique_id`, `author_name`,
`title`, `thumbnail_url`, `html`, `embed_product_id` — and no time field of
any kind.

So a pasted link can never be re-screened from its media. Screening happens
**in-app, before posting, on the original file**, and gate 4 compares the
platform's cover frame against the fingerprint taken then. That ordering is
not a preference; it is the only ordering the platforms permit.

### "Can we view it or download it?"

- **View — yes.** oEmbed returns embed HTML that plays the post in-page, and a
  `thumbnail_url` that fetches as a real JPEG (720x1280, verified).
- **Download — no**, not through any official endpoint. And we do not need to:
  the video was screened in-app before it was posted, so we already hold the
  original file and its fingerprint. The platform copy is only ever used to
  answer *"is this the same video?"*, which the cover frame settles.

Scraping to fill the gap is explicitly out. It breaks Meta's terms, breaks
without warning, and risks venue relationships to save an onboarding step.

## Snowflake timestamps

oEmbed returns no timestamp, so the 24-hour rule would be uncheckable on the
pasted path. TikTok ids are snowflakes: the top 32 bits are Unix seconds.

Measured against three posts whose real publish time we already held, the
decode landed **5–7 seconds early** every time — the id is minted when the
upload starts, `published_at` is when it goes live. Against a 24-hour window
that skew is irrelevant.

`snowflake_created_at` returns `None` rather than a wrong answer for ids that
decode before 2016 or into the future. A wrong timestamp that silently
approves a stale post is worse than having none.

## Gate 4 — content match, calibrated

The hole the spec identifies: screening and posting are separate acts, so
without this gate a diner can get a clean screening on one clip and post a
different video. Nothing else looks at what actually went up.

`fingerprint.cover_match` hashes the posted cover on the same 9x8 grid the
video frames use and takes the **minimum** distance across every sampled
frame — the cover is whichever frame the poster chose, so matching frame zero
would fail most videos.

Calibrated on real covers fetched from oEmbed against the same creator's
videos held locally:

| cover | vs video | distance | similarity |
|---|---|---|---|
| 6747282088778632454 | its own | **2 bits** | 0.969 |
| 6745113350746737926 | its own | **1 bit** | 0.984 |
| 6747282088778632454 | the other | 24 bits | 0.625 |
| 6745113350746737926 | the other | 23 bits | 0.641 |

A 21-bit gap. The threshold is **12**, in the middle of it. An earlier guess
of 18 would have passed this data while sitting 5 bits from an impostor. The
spec's 0.85 similarity works out at ~10 bits, so this is the same call reached
from measurement rather than assumption.

## Gate 5 — screening: deliberately not deciding

`SHADOW_MODE = True` and `BASE_PASS_MARK = 0`. Gate 5 returns **no data**, so
every claim routes to review.

That is the point, not an omission. The pass mark cannot be chosen before
shadow mode produces a labelled distribution; any number set now is a guess
dressed as a rule. The tier logic underneath is built and tested — it simply
does not bite until calibration happens.

## Two rules the tests exist to protect

**Infrastructure failure is not fraud.** A 5xx or a transport error returns
`retry`, never `reject`, and the diner sees "we'll keep trying" with *no call
to action* — they did nothing wrong, and asking them to retry implies they
did. A 404 is a genuine rejection, because the post really is not public.

**Soft passes are priced by tier.** A pasted link proves a post exists, not
who pasted it, so ownership soft-passes. Paying that instantly on a coffee is
a good trade; on a free entrée it goes to review. Connected accounts hard-pass
instead — TikTok's query endpoint only returns the authorized user's own
videos, so ownership is refused rather than inferred.

## Run it

```bash
.venv/bin/python -m services.verify.tests.test_verify
```

No network. Covers outage-vs-rejection, tier routing, short-circuit ordering
(a private post costs one HTTP call, not five), and that no gate name or score
leaks into diner-facing copy.

## On the frontend

`/collection/claim` runs the whole engine from the browser: paste a link, the
five checks resolve, and the post renders beside them with its cover frame,
caption and decoded timestamp.

The page has two views. **Diner** shows five plain-language steps — *Finding
your post, Matching your account, Checking the timing, Confirming your video,
Reviewing your video* — and one sentence naming the fix. No gate names, no
scores. **Staff** adds the engine's own reason per gate, the verdict, which
links soft-passed, and the claim id.

`POST /api/verify` spawns the CLI with an argument array and no shell. A
pasted URL is attacker-controlled by definition, so it goes into argv, never
a command line.

## Claims, dedupe and the T+7 re-check

`claims.db` records one row per post, behind a unique index on
`(platform, post_id)` — a double payout is impossible even if two requests
arrive together. The dedupe check runs *before* the gates: a link already paid
out costs nothing to detect, and running five gates on it, one of which
downloads a file, would be paying to re-answer a settled question. The
duplicate response carries the original post metadata from the stored row, so
the diner can see which post it was without a second fetch.

Only **paid** verdicts schedule a re-check — there is nothing to claw back
from a claim that never paid. At T+7 only gate 1 re-runs: the other four
judged facts that cannot change, and liveness is the thing being attacked. An
unreachable platform **defers**, leaving the claim due; our downtime is not
their fraud, at re-check time just as at claim time.

## Not built

- Instagram anything. Its pasted link cannot satisfy the window rule, so it is
  marked unsupported rather than held silently. The answer is the venue's
  connected account.
- Story mentions via the venue's DM inbox — needs a live webhook payload first.
- The screening model itself. Four dimensions, four mechanisms; only venue
  match needs a model, and the transaction record makes most claims a lookup.
- T+7d delete-after-payout re-check.
