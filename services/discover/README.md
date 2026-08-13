# Divvit Discover — social video harvesting & format ROI

Harvests public cafe/restaurant videos, normalizes them into one corpus, scores
which **formats** actually perform, and hands the best ones to the TwelveLabs
screening model (`screening.py`).

Covers the three Discover jobs from the product doc:

| Job | Question | Command |
|---|---|---|
| `business` | What is being posted about this partner? | `harvest business --name "La Bora"` |
| `trend` | Which cafe UGC formats are working? | `harvest trend --city "San Diego"` |
| `category` | What does the competitive landscape look like? | `harvest category --name ... --competitors ...` |
| `creators` | Pull known food creators' Shorts tabs | `harvest creators --handles "@eattryunbox,@thehangryrider"` |

**Creator seeding is the volume play.** Measured: 5 creator handles returned 104
videos in 3 minutes; 22 keyword queries across a city returned 5. A creator's
Shorts tab is entirely vertical short-form by construction, where keyword search
yields a handful per few hundred results. The trend harvest surfaces creator
handles, which seed the creator harvest — the corpus finds its own suppliers.

### The supply loop

Repeat keyword searches return videos we already have — day 2 of a daily agent
adds almost nothing. What *does* compound is creators. Each run:

1. tallies every creator handle in the corpus against its screening verdicts
2. auto-blocks any handle with repeated rejections and zero approvals
3. seeds the next run from the best remaining suppliers

So the corpus recruits its own suppliers and fires the bad ones without anyone
watching. `@growingupitalian` — 31 videos, 0 approved, 2 rejected — blocked
itself on the first pass.

```bash
.venv/bin/python -m services.discover.cli creators           # supply table
.venv/bin/python -m services.discover.cli creators --block @handle
```

Set `auto_seed_creators: false` in config to harvest only hand-listed handles.

## Quick start

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

```bash
.venv/bin/python -m services.discover.cli harvest trend --city "San Diego" --limit 15
```

```bash
.venv/bin/python -m services.discover.cli roi --videos 10 --reward-cost 15
```

Other commands: `stats`, `list`, `screen`, `export`. `--dry-run` on `harvest`
prints the query plan without hitting the network; `--dry-run` on `screen`
prices a batch in indexed minutes before spending any.

## The daily agent

One unattended pass: harvest every configured target → score the corpus →
push a budgeted batch through TwelveLabs → write a dated XML report.

```bash
cp services/discover/agent_config.example.json services/discover/agent_config.json
.venv/bin/python -u -m services.discover.agent --config services/discover/agent_config.json
```

Schedule it (macOS): edit the paths in `scripts/com.divvit.discover.plist`, then

```bash
cp scripts/com.divvit.discover.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.divvit.discover.plist
```

Cron works too: `0 7 * * * /path/to/Divvit-3.0/scripts/discover-daily.sh`.

`RunAtLoad` is deliberately false — loading the job should not immediately start
spending TwelveLabs minutes. Use `launchctl start com.divvit.discover` to test.

Outputs per run:

| Path | What |
|---|---|
| `data/discover.db` | SQLite corpus — source of truth, accumulates across runs |
| `data/reports/discover-<date>-<run>.xml` | Immutable daily report |
| `data/logs/discover-<date>.log` | Run log, pruned after 30 days |

### Behaviour that matters for unattended running

- **Idempotent.** Re-running the same day is safe. The store dedupes on
  `platform:video_id`, and screened videos are never re-screened.
- **Degrades instead of failing.** No TwelveLabs key, or the API is down, and
  the harvest still runs and still reports; screening is recorded as skipped
  with a reason. One target failing doesn't stop the others.
- **Budgeted.** `minute_budget` is a hard ceiling on TwelveLabs indexed minutes
  per run. The batch is *trimmed* to fit, not refused — a too-generous config
  quietly does less rather than nothing.
- **Retires permanent failures.** A video TwelveLabs rejects for resolution,
  duration, or a broken file is recorded as `unscreenable` so tomorrow's run
  doesn't re-download and re-submit it forever.
- **Schema migrates itself.** New columns are added on open; there is never a
  manual DB step between a `git pull` and the next scheduled run.

### Report structure

```xml
<divvit-discover-run id="…" started-at="…" schema-version="1">
  <config …/>  <harvest …/>  <screening-summary …/>  <corpus …/>
  <format-roi><format archetype="menu_review" …><projection …/></format></format-roi>
  <videos count="164">
    <video canonical-id="youtube:…" rights-status="…">
      <creator followers="456"/>  <metrics views="3752" likes="136"/>
      <scores format-score="87.7" audience-leverage="8.2"/>
      <screening verdict="approved_for_collection" twelvelabs-video-id="…">
        <analysis content-type="review" sentiment="positive">
          <summary>…</summary>  <detected-items><item>…</item></detected-items>
        </analysis>
      </screening>
    </video>
  </videos>
</divvit-discover-run>
```

Reports are immutable. To see what changed, diff two days.

## Architecture

```
queries.py    what to search for      (3 intents x format archetypes)
connectors/   where to search it      (ytdlp, youtube_api)
harvest.py    run / filter / dedupe
store.py      SQLite corpus           (dedupe on platform:video_id)
formats.py    UGC format archetypes   (shared vocabulary)
roi.py        format scoring + ROI projection
screen_bridge.py  corpus -> TwelveLabs screening
```

Every connector returns the same `DiscoveredVideo`, so adding a platform never
ripples past its own module.

### Connectors

| Connector | Auth | Search | Media | Notes |
|---|---|---|---|---|
| `ytdlp` | none | YouTube keyword | **yes** | Only source of actual bytes for screening |
| `youtube_api` | `YOUTUBE_API_KEY` | YouTube keyword | no | Compliant path; richer metrics; ~95 searches/day on default quota |

### Platform status

Measured 2026-07-25 against yt-dlp 2026.07.04. The failure is per-*surface*,
not per-platform, which matters:

| Platform | Keyword / hashtag search | Creator page | Media download | Auth needed |
|---|---|---|---|---|
| YouTube | works | works | works | no |
| TikTok | **fails** (`No working app info is available`) | **works** | works | **no** |
| Instagram | fails | fails | fails | yes — and still unreliable |

**TikTok needs no login.** Only hashtag/keyword search is broken, on request
signing. Creator pages and single videos extract and download fine
unauthenticated — and creator harvesting is the higher-yield surface anyway, so
this costs us little. Harvest TikTok by handle:

```bash
.venv/bin/python -m services.discover.cli harvest creators \
    --platforms tiktok --handles "@thefoodiediaries"
```

**Instagram genuinely needs a session cookie** — yt-dlp says so itself
(*"use --cookies-from-browser ... for the authentication"*). Pass
`--cookies-from-browser chrome`. Expect it to break regularly; Meta actively
fights extraction.

For scale and compliance the durable path is still TikTok's Research API and the
Instagram Graph API — keyed integrations with multi-week approval, worth starting
now. A licensed vendor (Apify, Bright Data, EnsembleData) is the buy option.

### Short-form only

Divvit's medium is Shorts / Reels / TikTok, so the default harvest keeps only
**vertical video ≤ 90s**. Two findings worth keeping:

- YouTube's own "under 4 minutes" search filter (`sp=EgIYAQ%3D%3D`) **excludes
  the Shorts shelf**. It returns 1–3 minute mini-vlogs — shorter long-form, not
  Shorts. Appending `#shorts` to a plain `ytsearch:` is what actually surfaces
  vertical short-form (measured: 29/54/61s vs 68/103/156s).
- Vertical framing is the cheapest reliable way to tell a Short from a landscape
  YouTube video, but resolution is only known *after* enrichment — so the
  vertical gate runs on the post-enrich re-check, and a video whose orientation
  is still unknown after enrichment is dropped rather than assumed.

Expect a **low yield**: roughly 5–10 usable Shorts per city per run, against a
few hundred filtered. Breadth across cities, accumulated daily, is what builds
volume — not depth on one city. `--allow-landscape` and `--max-duration` open
the gate back up if you ever want mini-vlogs.

`prune` drops corpus rows that no longer meet the definition when it tightens
(re-harvesting adds conforming videos but never removes old ones):

```bash
.venv/bin/python -m services.discover.cli prune --dry-run
```

## The ROI model

Raw view counts do not transfer between creators, so the model is built on
**audience leverage**:

```
audience_leverage = views / creator_followers
```

40k views from a 400k-follower account is a weak format riding a big audience
(0.1x). 40k views from a 2k-follower account is a format that *travels* (20x).
Divvit's creators are the small account, so formats are ranked by leverage and
projected onto the follower count of creators a business would actually get.

`format_score` (0–100) is a percentile composite within the corpus cohort —
leverage 0.45, engagement rate 0.35, view velocity 0.20 — renormalized over
whichever components are present. Absent data is `None`, never zero.

Guards that matter: leverage is only recorded above 100 followers (a 13-sub
channel with 12k views scores ~900x and would drag a format median on its own),
and channels over 2M followers are filtered out entirely — they are media
companies, not Divvit creators.

`project_roi()` returns an `assumptions` block on every projection. These are
modeled estimates from scraped public metrics, **not measured campaign
outcomes**, and the UI must say so.

## Rights

Discovery gives us metadata and a link. It does not give us a license. Every
record carries `rights_status`:

| Status | Meaning |
|---|---|
| `unlicensed_reference` | default — link + metrics only, never render the media |
| `internal_eval` | downloaded for model testing, deleted after |
| `creator_licensed` | creator opted in through Divvit |
| `owned` | Divvit or the business owns it |

`is_publicly_displayable()` returns true only for the bottom two, and it is the
gate anything user-facing must call. Harvested video can populate Discover for
businesses (that is a metrics-and-links surface). It **cannot** populate the
consumer app's video feed — that needs a creator opt-in, which is what the Legal
Ownership product is for. `purge_media()` deletes evaluation copies once a
screening batch is done.

## Screening handoff

`screen_bridge.py` selects the top unscreened videos by format score, downloads
them, and runs `screening.py`. Harvested videos have no submitting user, so
`screening.py` gained a **catalog mode**: pass `business=None` and it uses a
prompt that classifies content and sets `venue_match: "n/a"` instead of
verifying a venue. Business mode is unchanged.

Harvested content indexes into `divvit-discover`, deliberately **not** the
`divvit-collection` index that serves real user submissions.

Cost discipline: TwelveLabs bills indexed minutes (600 free). The bridge never
screens the whole corpus — `--limit` plus `--minute-budget`, and it refuses a
batch that would exceed the budget.

Requires `TWELVELABS_API_KEY` in `.env`. The key referenced in the root README
was shared in plaintext and still needs rotating.

## Tests

```bash
.venv/bin/python -m services.discover.tests.test_discover
```

No network, no API keys. Covers the places where a silent wrong answer is
expensive: the store's preserve-on-refresh contract, missing-vs-zero in scoring,
the leverage guards under the ROI projection, the rights gate, and report shape.

## Known limitations

- **YouTube is a weak source for this content.** A 146-video San Diego harvest
  came back with median leverage ~0.1 — that is local TV news and business-owned
  channels, not customer UGC that travels. The cafe UGC Divvit models lives on
  TikTok and Reels. The pipeline is source-agnostic; the source needs fixing.
- Keyword noise filtering catches commercials, stock b-roll, playlists and news
  segments, but not everything. TwelveLabs screening is the precision layer.
- Archetype classification is keyword-based until a video is screened, at which
  point the model's `content_type` takes over.
- SQLite is intentional for pre-launch. `export_rows()` matches the shape the
  Postgres table should take when Discover moves server-side.

## Style extraction — the market model

Discover's ROI model answers *which format wins*. Style extraction answers the
question Create actually needs: **what does that format look like?**

```bash
.venv/bin/python -m services.discover.cli style --limit 15 --json-out data/style_profiles.json
```

Two sources per video, both cheap because the video is already indexed:

- **TwelveLabs Pegasus** — on-screen text verbatim, caption styling, audio
  treatment, shot order, tone.
- **ffmpeg scene detection** — objective cut rhythm. Pegasus says "fast";
  ffmpeg says "13 cuts, median shot 2.75s", which is what sets slot durations.

Measured profiles from the live corpus:

| archetype | text | cut rhythm | audio | caption style |
|---|---|---|---|---|
| menu_review | 71%, ~6 overlays | 13 cuts, 2.75s shots, 68s | voiceover_only | large white, black outline, bottom |
| cafe_vlog | 100%, ~19 overlays | 53 cuts, 1.15s shots, 70s | voiceover_only | medium white, black outline, bottom |
| aesthetic | 100%, ~6 overlays | 29 cuts, 1.55s shots, 48s | ambient_natural | medium white, dark outline, bottom |

### Two findings worth keeping

**Split the analyze calls.** A single 13-field schema reported
`ambient_natural` / `narration=none` for a video that a focused 4-field
audio-only schema correctly called `voiceover_with_music` / `direct_to_camera`.
Pegasus's audio attention degrades when it is simultaneously transcribing
overlays and enumerating shots. Two calls, better answers.

**Hook text must be templatized *and* validated.** Harvested hooks become
reusable patterns — `"TOP 5 INDIAN RESTAURANTS IN LONDON"` →
`"TOP 5 {cuisine} IN {city}"` — so Create reuses the genre convention, not
someone's exact caption. Any template still naming a specific entity
(`"ALOHA POKE & GRILL"`, `"Meet Isaiah, the pizza guy!"`) is rejected: putting
another city's name on a business's own video is worse than shipping no hook.
