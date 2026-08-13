# Organic Brand Health — Technical Design

**Status:** proposed, awaiting approval
**Author:** CTO
**Date:** 2026-07-28

---

## 1. What we are building, and what we are not

A score from 0–100 that answers one question for a partner venue:

> **How strong is the word of mouth about this business right now?**

Not how many orders they took. Not their SEO rank. **What other people say about them, unprompted, in public.**

That distinction is the whole product. [Owner.com's analytics](https://www.owner.com/reporting-analytics) — the closest comparable — reports sales, order sources, top sellers, Google ranking positions and review counts, and explicitly does **not** compute any composite health index; it surfaces raw metrics plus "opportunities". Their [Reviews Engine](https://www.owner.com/reviews-engine) drives *first-party* review collection after an order.

So the competitive gap is real: **nobody is scoring organic advocacy.** Owner measures what the restaurant did. We measure what customers did about the restaurant.

### Non-goals

- Not a sales or revenue metric. We have no POS data and should not pretend to.
- Not a real-time metric. Word of mouth moves in weeks; daily refresh is enough.
- Not a single global leaderboard. A neighbourhood cafe and a 40-location chain cannot share a scale (see §5).

---

## 2. Definition

**Organic Brand Health** = recency-weighted, peer-normalized composite of five pillars, expressed 0–100, always shipped with a coverage/confidence figure.

The score is only meaningful *relative to comparable venues*. An absolute 500 views is excellent for a 20-seat cafe and catastrophic for a chain. Every underlying metric is therefore converted to a **percentile within a peer cohort** before scoring (§5).

---

## 3. Data sources — measured feasibility

I tested every one of these against live endpoints during Discover work. This is not a wish list.

| Source | What it gives | Status | Notes |
|---|---|---|---|
| **Divvit first-party** | submissions, creators, screening sentiment, detected items | ✅ **works, exclusive** | Our moat. No scraping, no rate limits, highest quality. |
| **Google Places** | rating, review count, review text, coordinates, photos | ⚠️ needs `GOOGLE_MAPS_API_KEY` | Highest-volume public signal. **Priority integration.** |
| **Yelp Fusion** | rating, review count, review text | ⚠️ needs key | Secondary; overlaps Google. |
| **YouTube Data API** | videos mentioning the business, views, likes, comments | ✅ works, keyed | 100 searches/day on default quota. |
| **YouTube via yt-dlp** | same, plus media | ✅ works, no key | Backup / media retrieval. |
| **TikTok creator pages** | a known creator's videos | ✅ works, no auth | Only works if we already know the handle. |
| **TikTok keyword/hashtag** | *finding* mentions of a business | ❌ **broken** | Fails on request signing (`No working app info is available`). Measured 2026-07-25. |
| **Instagram** | anything | ❌ **blocked** | instaloader 403s, gallery-dl 404s, oEmbed returns a login page. Measured 2026-07-25. |

### The constraint that shapes everything

**We cannot currently discover TikTok or Instagram mentions of a business.** We can only read a creator's page once we know their handle. This is the single biggest limitation on brand health coverage, and no amount of clever engineering fixes it — it needs the **TikTok Research API**, the **Instagram Graph API**, or a **licensed vendor** (Apify / Bright Data / EnsembleData).

Consequences for this design:

1. Phase 1 brand health leans on **reviews + first-party + YouTube**, which we can actually see.
2. The score **must** report coverage honestly. A venue scored on 2 of 6 sources gets a confidence band, not a confident number.
3. Creator handles discovered through first-party submissions become TikTok seeds — the same compounding supply loop Discover already uses.

---

## 4. The five pillars

| Pillar | Weight | Why it earns that weight |
|---|---:|---|
| **Advocacy** | 30 | How many *different people* talk about you. The truest word-of-mouth signal and the hardest to fake. |
| **Reach** | 20 | How many people saw it. Matters, but a big number from one creator is weaker than a modest number from twenty. |
| **Sentiment** | 20 | How they felt. A venue with high reach and negative sentiment is in trouble, not health. |
| **Reputation** | 20 | Reviews: rating, volume, recency, owner responsiveness. The signal customers actually check. |
| **Engagement** | 10 | Depth of attention. Comments and saves signal intent; views alone signal a scroll. |

**Momentum is deliberately not a pillar.** Direction is a different question from position, and mixing them hides both. It ships as a separate `momentum` field (−100…+100) driving a trend arrow.

### 4.1 Advocacy (30)

| Metric | Rationale |
|---|---|
| `unique_creators_90d` | 40 people posting once beats 1 person posting 40 times. |
| `new_creators_30d` | Fresh advocacy vs a static fan club. |
| `repeat_creator_rate` | People coming back is loyalty, not just novelty. |
| `creator_concentration` (HHI) | **Inverted.** If 80% of content is one creator, advocacy is fragile. |

Creator concentration uses a Herfindahl index over content-per-creator. High concentration caps the pillar — this is the anti-astroturf guard.

### 4.2 Reach (20)

`organic_impressions_90d`, recency-decayed, plus `median_audience_leverage` (views ÷ creator followers — already built in `services/discover/roi.py`). Leverage matters because it separates "a big account mentioned you" from "content about you travels".

### 4.3 Sentiment (20)

Positive share from two independent streams: TwelveLabs screening `sentiment` on video content, and review-text sentiment. Weighted by reach — a negative video with 50k views matters more than one with 50. Also surfaces `negative_themes` (recurring complaints), which is the most actionable output in the whole product.

### 4.4 Reputation (20)

`avg_rating`, `review_count` (percentile vs cohort), `review_velocity_30d`, `rating_trend_90d`, `response_rate`. Rating alone is a weak signal — a 4.9 from 11 reviews is not a 4.9 from 1,100.

### 4.5 Engagement (10)

`engagement_rate` (likes+comments+shares ÷ views) and `comment_ratio` vs cohort. Comments cost more effort than likes and correlate better with visit intent.

---

## 5. Normalization — the part that makes it honest

### 5.1 Peer cohorts

Every raw metric becomes a percentile within a cohort defined by:

- **category** (cafe / coffee / casual dining / dessert / …)
- **market tier** (metro population band)
- **venue scale** (single location vs multi)

`score_pillar = Σ(percentile(metric, cohort) × metric_weight)`

### 5.2 Bootstrapping cohorts before we have partners

This is where existing work pays off. **The Discover corpus already contains 465 videos across hundreds of real venues.** Those venues' engagement rates, leverage figures and creator counts form a synthetic peer baseline *before a single partner signs*.

Cohorts refresh monthly; a cohort needs **n ≥ 30** to be used, otherwise we fall back to the next-broader cohort and lower the confidence figure.

### 5.3 Recency decay

Exponential, with different half-lives because the signals age differently:

| Signal | Half-life | Reason |
|---|---|---|
| Video content | 30 days | Short-form dies fast; a viral hit from last year is not health today. |
| Reviews | 180 days | Reviews are consulted long after posting. |
| Creator activity | 60 days | Between the two. |

`weight = 0.5 ^ (age_days / half_life)`

### 5.4 Organic vs incentivized — a correctness issue, not a nicety

Divvit **pays users to post**. If rewarded submissions count the same as spontaneous posts, the score measures how much Divvit paid out, not brand health. That would be a metric that goes up when we spend money — worthless to the business and dishonest.

Therefore every content item carries `is_incentivized`, and:

- Organic content: full weight.
- Divvit-incentivized: **0.4 weight** in Advocacy and Reach.
- Reported separately as `organic_share` so a business sees how much of their word of mouth they are renting.

---

## 6. Score computation

```
for each pillar:
    pillar_raw   = Σ(percentile(metric_i, cohort) × w_i)
    pillar_score = 0..100

composite = Σ(pillar_score × pillar_weight) / 100     -> 0..100

momentum  = (composite_30d - composite_prior_90d)     -> -100..+100
coverage  = Σ(source_weight for sources with data) / Σ(all source_weights)
confidence = f(coverage, cohort_size, data_volume)    -> low | medium | high
```

**Display rule:** below `coverage < 0.4` we show a **range**, never a point estimate — "62–78, limited data". A precise-looking number on thin evidence is worse than no number, because the business will act on it.

---

## 7. Architecture

```
services/brandhealth/
  sources/
    base.py            # SourceCollector protocol -> BrandSignal records
    first_party.py     # Divvit submissions + screening  (works today)
    google_places.py   # rating, review count, review text
    yelp.py            # secondary reviews
    youtube.py         # mention discovery (reuses discover/connectors)
    tiktok.py          # creator-page only until Research API
  signals.py           # raw collections -> normalized metric primitives
  cohort.py            # peer baselines, bootstrapped from the Discover corpus
  score.py             # pillars, weights, decay, composite, momentum
  store.py             # SQLite snapshots (time series; mirrors Postgres shape)
  agent.py             # daily refresh, same pattern as discover/agent.py
  report.py            # explainable per-pillar output + XML/JSON
  cli.py
```

**Deliberate reuse:** Discover's connectors, `roi.py` leverage math, screening sentiment, the venue resolver (§ how we know a video is *about* this business), and the daily-agent pattern that already runs unattended.

**Storage:** snapshots, never overwrites. Brand health is a time series; a single current value cannot answer "are we improving", which is the question that renews a subscription.

---

## 8. Data model

```sql
CREATE TABLE brand_health_snapshots (
  id                UUID PRIMARY KEY,
  business_id       UUID REFERENCES businesses(id),
  captured_at       TIMESTAMPTZ,
  composite_score   REAL,          -- 0..100
  momentum          REAL,          -- -100..+100
  coverage          REAL,          -- 0..1
  confidence        TEXT,          -- low | medium | high
  pillar_advocacy   REAL,
  pillar_reach      REAL,
  pillar_sentiment  REAL,
  pillar_reputation REAL,
  pillar_engagement REAL,
  organic_share     REAL,          -- share NOT driven by Divvit rewards
  cohort_key        TEXT,
  cohort_size       INT,
  metrics           JSONB,         -- every raw metric, for explainability
  sources_used      TEXT[]
);

CREATE TABLE brand_signals (       -- the atoms a snapshot is computed from
  id              UUID PRIMARY KEY,
  business_id     UUID,
  source          TEXT,            -- google_places | youtube | first_party | ...
  signal_type     TEXT,            -- video | review | mention
  external_id     TEXT,
  creator_handle  TEXT,
  posted_at       TIMESTAMPTZ,
  views           BIGINT,
  likes           BIGINT,
  comments        BIGINT,
  rating          REAL,
  sentiment       TEXT,
  is_incentivized BOOLEAN DEFAULT false,
  raw             JSONB,
  UNIQUE (source, external_id)
);
```

---

## 9. Explainability — the dashboard contract

A number with no explanation gets ignored or disputed. Every snapshot ships with:

1. **Per-pillar breakdown** with the cohort percentile for each.
2. **Top 3 drivers** — what moved the score, up and down, since last snapshot.
3. **Top 3 actions** — derived, not generic. *"Your reviews are strong (82nd pct) but only 3 different creators posted this quarter — run a campaign."*
4. **Evidence links** — the actual videos and reviews behind the number.

---

## 10. Abuse and failure modes

| Risk | Guard |
|---|---|
| Bought reviews | Velocity anomaly detection; rating-trend discontinuity; recency clustering. |
| One superfan inflating advocacy | Creator concentration (HHI) caps the Advocacy pillar. |
| Divvit rewards inflating the score | `is_incentivized` down-weighting (§5.4) + `organic_share` reported. |
| Thin data producing a confident number | Coverage gate; ranges below 0.4 coverage. |
| Competitor sabotage (negative review bombing) | Anomaly flag + human review queue; never auto-tank a score. |
| Venue misattribution | Reuses the existing venue resolver — confirmed matches only feed the score. |

---

## 11. Cost

| Item | Driver | Notes |
|---|---|---|
| Google Places | per Place Details + Photos call | Cache aggressively; refresh reviews daily, coordinates never. |
| YouTube Data API | 100 units/search | ~95 searches/day free. Budget ~3 searches per business per day → ~30 businesses/day per key. |
| TwelveLabs | indexed minutes | **Zero marginal cost** — sentiment comes from screening we already pay for. |
| Compute | trivial | Scoring is arithmetic over a few hundred rows. |

The binding constraint is YouTube quota, not money. At scale, request a quota increase or shift discovery to a vendor.

---

## 12. Rollout

| Phase | Scope | Depends on | Output |
|---|---|---|---|
| **P0** | First-party + Google Places. Advocacy, Sentiment, Reputation pillars live. Reach/Engagement partial. | `GOOGLE_MAPS_API_KEY` | Real score, coverage ~0.5, confidence medium. |
| **P1** | YouTube mention discovery. Reach + Engagement fully live. Cohort percentiles from Discover corpus. | existing | Coverage ~0.7. |
| **P2** | TikTok Research API / Instagram Graph / vendor. | **external approval — start now** | Coverage ~0.95. |
| **P3** | Momentum trends, anomaly detection, action recommendations. | ≥90 days of snapshots | The renewal driver. |

P0 is buildable immediately and independently of P2.

---

## 13. Open questions for you

1. **Google Maps API key** — do we have a Cloud project? This blocks P0 and is the single highest-value integration in the document.
2. **Yelp** — worth the second key, or is Google enough for v1?
3. **Weights** — I have proposed 30/20/20/20/10. Advocacy is highest because word-of-mouth breadth is the product thesis. Push back if you weigh reviews higher; it is a one-line change and a real strategic choice.
4. **Incentivized down-weighting at 0.4** — defensible but arbitrary. Alternatives: exclude entirely (purist) or report two scores, organic and total.
5. **Score visibility** — do businesses see the raw 0–100 immediately, or a band (Strong / Healthy / Needs Attention) until coverage is high? I lean band-first; a wrong-looking number destroys trust in the metric permanently.
6. **TikTok/Instagram access** — which path: API applications (weeks, compliant) or a vendor (days, paid)? P2 coverage depends entirely on this answer.

---

## 14. What I need to start

**P0 needs only the Google Maps key.** Everything else — first-party collection, scoring, cohorts, storage, the daily agent, explainability — reuses patterns already built and tested in Discover.

Estimated: P0 in one working session, P1 in a second.
