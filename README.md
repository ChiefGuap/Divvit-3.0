# Divvit AI services

Two halves of the same pipeline:

| Service | What it does |
|---|---|
| **Screening AI** (`screening.py`, this file) | Screens user-submitted videos before they reach a business's Collection |
| **[Discover](services/discover/README.md)** (`services/discover/`) | Harvests public cafe/restaurant videos, scores which formats perform, and feeds the best into screening — with a daily agent that runs the whole loop unattended |
| **[Create](services/create/README.md)** (`services/create/`) | Editing AI: assembles Collection clips into a postable vertical video, shaped by Discover's best-performing format, moments picked by TwelveLabs search; Instagram Reels publish path (dry-run by default) |
| **[Classify](services/classify/README.md)** (`services/classify/`) | The five-category video model (`review`, `montage`, `aesthetic`, `venue_vibe`, `menu_item`) — Pegasus labels the corpus as teacher so a local VideoMAE student can be trained on it |

---

# Divvit Screening AI (The Collection intake)

Screens every user-submitted video before it reaches a business's Collection:

1. **Genuine content check** — is this really cafe/restaurant content (not spam, screen recordings, or unrelated footage)?
2. **Content-type label** — `review`, `vlog`, `interior`, `menu_item`, `event`, `other` (matches The Collection's filter categories).
3. **Venue verification** — is the video about the *specific* business it was submitted to? Evidence-based: signage, cups/packaging, menu boards, spoken mentions, distinctive interior.

Bonus signals extracted in the same call (they feed Dashboard metrics for free): detected menu items (→ "trending menu items"), sentiment (→ Brand Impact), and quality flags (slop/fraud screening).

## Verdicts

| Verdict | Meaning |
|---|---|
| `approved_for_collection` | Passes all checks → show to the business in The Collection |
| `needs_review` | Real content but venue unverifiable, low confidence, or flagged (repost/AI/watermark) → ops queue |
| `rejected` | Not food content, wrong business, or inappropriate → auto-reject, notify user |
| `unscreenable` | TwelveLabs permanently rejected the file (resolution/duration/corrupt) — set by Discover, never a judgement about content |

## Two modes

- **Business mode** (`business=<BusinessProfile>`) — the submission path. Verifies
  the video is about that specific business.
- **Catalog mode** (`business=None`) — used by Discover on harvested videos, which
  have no submitting user and no claimed venue. Same schema and classifier;
  `venue_match` comes back `"n/a"` and any business the model *does* recognize
  from signage or speech lands in `venue_evidence`.

## How it works (TwelveLabs v1.3)

- One index, `divvit-collection`, with **two models**:
  - `pegasus1.2` — generative video understanding; does the screening via a single `/analyze` call with a strict JSON schema (`response_format: json_schema`), temperature 0.
  - `marengo3.0` — embeddings/search; every indexed video is instantly semantically searchable, which is the backbone of The Collection browse/filter and later Discover/Create.
- Flow: `POST /tasks` (upload) → poll until `ready` → `POST /analyze` (structured screening) → verdict logic in `ScreeningClient.decide()`.
- `analyze_direct()` (Pegasus 1.5, video-by-URL, no indexing) is included as an experimental cheap pre-screen — verify it works on our plan before relying on it.

## Run it

```bash
pip install -r requirements.txt

# 1. validate the key
python screen.py --check

# 2. screen a video
python screen.py sample.mp4 \
  --business "La Bora" \
  --location "North Park, San Diego" \
  --cuisine "Korean cafe" \
  --menu "salt bread,matcha latte" \
  --json-out result.json
```

Indexing a short clip typically takes 1–5 minutes; the analyze call returns in seconds.

## Integration notes (backend)

- **Where it plugs in**: consumer app upload → store raw file (e.g. Supabase Storage / S3) → enqueue screening job with `(video_url, business_id)` → run `screen_submission()` → write `ScreeningResult` to a `submissions` table with the verdict → Dashboard reads from there. Keep the TwelveLabs `video_id` and `index_id` on the row; you'll need them for search and Create later.
- **Business profiles matter**: venue verification quality scales directly with what we store per business (menu items, logo/cup descriptions, interior notes). Add these fields to business onboarding.
- **Cost model**: TwelveLabs bills by indexed minutes. Free tier = 600 min total. At scale, consider the direct pegasus1.5 pre-screen to reject junk *before* paying to index, and only index approved/likely videos into Marengo.
- **Failure handling**: `wait_for_task` raises on `failed`/timeout — route those to `needs_review`, never silently drop a user's submission (reward trust is the product).

## ⚠️ Security

The API key in `.env` was shared in plaintext chat. **Rotate it** at <https://playground.twelvelabs.io/dashboard/api-keys> and store the new one in your secret manager before anything ships.
