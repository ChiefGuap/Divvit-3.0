# Overnight: Create trend learning + review loop

Branch `agents/create-trends`. Zero indexed minutes. Committed code only —
`data/` is gitignored, so no profile or corpus artifact ships from this run.

The agent building this ran out of credits after committing all code and
producing all data; the dated trend report and this summary were written
afterward from its measured output.

## What was built

| Module | Job |
|---|---|
| `services/discover/trendseeds.py` | 20 verified TikTok food-creator handles + city sweep config |
| `services/discover/trend_style.py` | direct-path style learning: inline base64 (no indexing), split focused schemas, junk gate first, persistent token ledger with a hard cap |
| `services/create/review.py` | the editor review loop — build plans against current profiles, score 12 criteria, write a dated report |
| `services/create/cli.py` | `review` subcommand |
| `services/create/tests/test_review.py` | no-network tests |

`TokenBudget` refuses a call it *estimates* would breach the cap rather than
detecting the breach after the fact — a refused call costs nothing, an over-cap
call cannot be un-spent.

## Measured

| | |
|---|---|
| Harvested | **210** videos — **180 TikTok**, 30 YouTube Shorts |
| Tokens | **192,681 / 200,000** input, 1,309 output, 18 calls |
| Indexed minutes | **0** |
| Classified (junk gate) | 10 — **4 not_cafe (40%)** |
| Style-analysed | **6** |
| Review loop | PASS, 12/12 criteria, real render |

**TikTok harvesting is the real win.** 180 videos in one night from creator
handles, unauthenticated, against 10 TikToks in the entire main corpus. The
supply problem identified earlier has a working answer.

**The style refresh failed to produce a usable profile.** Full analysis in
`data/reports/create-trends-2026-08-17.md`. In short: 200k tokens bought only 6
profiled videos (~21k each — style extraction is ~2× a classification call), so
`menu_review` refreshed on **n=4 against July's n=7**, and `cafe_vlog` /
`aesthetic` were carried forward unchanged at n=1.

Worse, the refreshed `menu_review` reports **0% of videos with on-screen text**
against July's 71%. Four consecutive caption-free short-form food videos is not
a credible trend; the likely cause is that the direct `pegasus1.5` path reads
on-screen text materially worse than indexed `pegasus1.2`. **Adopting it would
make Create build 5-slot, 32-second, caption-free videos** where the July
evidence says 13 slots, 68 seconds, large captions.

The review loop passed against that profile, which is the instructive part: the
checklist verifies the plan is consistent with the profile, not that the profile
is true. Internal consistency is not correctness.

## Recommendation

1. Do **not** promote these profiles. July's remain canonical. (`data/` being
   gitignored meant nothing shipped — luck, not design.)
2. Validate the text gap first: 3 indexed videos, both paths, compare
   `pct_with_text`. ~6 calls.
3. If confirmed, source cut rhythm from ffmpeg (free, local, trusted) and
   caption/text fields from indexed video or a dedicated OCR pass.
4. Require **n≥10** per archetype before a new profile may replace an old one.

## Open gaps

- **Instagram**: skipped, no unauthenticated surface. Needs cookies or Graph API.
- **Music**: still absent; needs licensed tracks. `music_hint` carries the intent.
- **Token economics**: at ~21k tokens per profiled video, meaningful sample
  sizes need either a bigger budget or a cheaper instrument (ffmpeg + OCR does
  most of the measurable work for free).
