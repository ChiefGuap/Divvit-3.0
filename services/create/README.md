# Divvit Create — the editing AI

Collection clips + Discover's format data → one packaged vertical video
(1080x1920, ≤30s) a business can post.

```bash
# plan the cut without rendering (what the dashboard shows for approval)
.venv/bin/python -m services.create.cli plan --business "La Bora" --clips-dir <dir> --manifest <dir>/manifest.json

# plan + render
.venv/bin/python -m services.create.cli build --business "La Bora" --clips-dir <dir> --manifest <dir>/manifest.json --out out.mp4
```

## How a video gets made

1. **Recipe** ([recipes.py](recipes.py)) — the shape of the edit: ordered slots,
   each declaring the `content_type` it accepts (screening's own labels), its
   role (hook / body / payoff), duration bounds, and a moment query.
   Discover picks *which* format (best ROI score) and then **teaches Create what
   that format looks like** — see below. Force a format with `--archetype`,
   ignore the learned styling with `--no-style`.
2. **Library** ([library.py](library.py)) — the rights gate. Only
   `creator_licensed` / `owned` clips exist as far as the assembler is
   concerned. Discover's harvested corpus can *never* appear in output; it
   informs the format, not the footage.
3. **Moments** ([moments.py](moments.py)) — for each slot, TwelveLabs Marengo
   search finds the exact seconds inside the clip ("person reacting positively
   and giving a verdict"). Verified live: the payoff slot of the first eval
   build landed on the clip's actual spoken verdict — *"still really good,
   definitely a must-go place."* Falls back to a front-of-clip heuristic when a
   clip isn't indexed, so Create degrades to a rough cut instead of an error.
4. **Assembly** ([assemble.py](assemble.py)) — plan first (a JSON the dashboard
   can show for approval), then one ffmpeg pass: normalize every segment to
   1080x1920/30fps (landscape gets center-cropped, not letterboxed), burn slot
   overlays, concat with per-segment audio.
   - Slots are filled **scarcest-first**: the slot with the fewest candidate
     clips picks before permissive ones, so a body slot can't eat the only
     `review` clip and starve the payoff.
   - Each clip is used at most once; missing slots shrink the edit (minimum 2
     segments) rather than failing it.
5. **Publish** ([publish.py](publish.py)) — Instagram Reels via the Graph API.

## Learned style — what makes this not a template engine

The hardcoded recipes are scaffolding: shot *intent* per slot, which is genuine
editorial knowledge. Everything measurable comes from Discover's style profiles
(`discover.cli style`) instead of from anyone's taste:

| What | Where it comes from |
|---|---|
| number of slots | median cut count of real videos in the format |
| slot durations | median shot length, measured with ffmpeg scene detection |
| hook overlay text | real harvested hooks, templatized |
| caption size / colour / position | how real videos in the format style theirs |
| target length | median duration of the format |
| music hint | dominant observed audio treatment |

A real build:

```
[create] style learned from 7 real videos (confidence medium):
    cut rhythm : 13.0 cuts, 2.75s shots -> 6 slots @ 1.92-4.4s
    length     : 68.3s
    audio      : voiceover_only
    hook text  : 'TOP 5 Korean cafe IN San Diego'  (from real hooks)
    captions   : Large white text with black outline, centered at the bottom
    tone       : engaging, informative, casual, exciting, appetizing
```

That hook came from `"TOP 5 INDIAN RESTAURANTS IN LONDON"` in the wild,
templatized to `"TOP 5 {cuisine} IN {city}"` and refilled for this business.
Templates that still name a specific entity are rejected upstream, and
`_mentions_other_entity` re-checks the *rendered* string before it goes on
screen — a wrong city name on a business's own video is worse than no hook.

`derived_from` on every learned recipe carries the evidence, so the dashboard
can show a business *why* their video looks the way it does.

Recipes degrade to the scaffold when a profile is thin, so a one-sample profile
never produces a two-second video.

## The clip manifest

`--manifest` maps filenames to metadata; it is where rights honesty lives:

```json
{
  "clip1.mp4": {
    "content_type": "menu_item",
    "rights_status": "creator_licensed",
    "twelvelabs_video_id": "6a65…",
    "duration_seconds": 15
  }
}
```

In production this comes from the `submissions` table
(`ClipLibrary.from_submissions`): only `accepted` rows become clips, because
acceptance is when Legal Ownership transfers rights.

`--internal-eval` admits harvested (`internal_eval`) clips so the editing model
can be tested on real footage. Any library built that way is poisoned for
publishing (`publishable=False`) and the CLI says so on every build.

## Instagram publishing (the end goal)

Meta's constraints, none of which are ours to relax:

- Instagram **Business/Creator** account linked to a Facebook Page
- Meta app with `instagram_content_publish` → **App Review** required
- The API *pulls* the video from a **public HTTPS URL** — you cannot POST bytes.
  So renders must be uploaded to storage (Supabase Storage / S3) first.
- Flow: create media container → poll `status_code` → publish. Implemented.

```bash
export IG_ACCESS_TOKEN=… IG_USER_ID=…
.venv/bin/python -m services.create.cli publish --check          # validate account
.venv/bin/python -m services.create.cli publish --video-url https://… --caption "…"        # DRY RUN
.venv/bin/python -m services.create.cli publish --video-url https://… --caption "…" --live # real post
```

`publish` is **dry-run by default and never auto-fires**: Create prepares the
reel, a human passes `--live`. Posting to a business's audience is the most
visible action in this codebase; the agent stops one step short of it.

## What's deliberately not here yet

- **Music** — needs licensed tracks; the recipe carries a `music_hint` field.
- **Transitions/pacing polish** — hard cuts only. Right for UGC, and simple.
- **Auto-captioning of speech** — TwelveLabs already returns per-moment
  transcriptions; burning them as subtitles is a natural next step.
- **Publish scheduling** — the daily agent could queue approved renders, but
  publishing stays human-triggered until the business approval flow exists.
