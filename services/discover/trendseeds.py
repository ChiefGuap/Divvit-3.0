"""Seed lists for the recurring trend harvest — who and where to look.

The trend corpus needs two properties the default harvest doesn't guarantee:
freshness (these are *current* videos, because a creator's page surfaces their
latest posts first) and density (a food creator's page is nearly all food,
where keyword search was measured at ~75% junk).

Platform reality this encodes (measured 2026-08-16, yt-dlp 2026.07.04):

  * TikTok keyword/hashtag search is broken unauthenticated ("No working app
    info is available"), but creator pages list fine. So TikTok supply is a
    curated handle list. Every handle below was probed with a flat yt-dlp
    extraction before being kept — 30 candidates tried, 18 listable. The ones
    that failed (@thenaughtyfork, @newfork.city, regional aggregator guesses)
    return zero entries, not errors, so a dead handle costs one cheap request.
  * YouTube "#shorts" keyword search works; the queries module already appends
    the hint. ~20% of YouTube downloads later fail with 403 — harvest
    over-collects to absorb that.
  * Instagram needs login cookies or the Graph API — skipped entirely; see the
    trend report's open-gaps section.

Refreshing the handle list is part of the runbook below: probe first, then
seed. A handle that stops resolving should be dropped, not retried forever.

RUNBOOK (repeatable; metadata only — zero TwelveLabs spend):

    # 1. TikTok creator pages (the dense source)
    python -m services.discover.cli harvest creators --platforms tiktok \
        --handles "$(python -c 'from services.discover.trendseeds import handles_arg; print(handles_arg())')" \
        --limit 12 --enrich-limit 150

    # 2. YouTube #shorts trend queries, several cities
    for CITY in "San Diego" "Los Angeles" "New York" "Chicago" "Austin"; do
        python -m services.discover.cli harvest trend --city "$CITY" \
            --limit 6 --max-queries 12 --enrich-limit 40
    done

    # 3. Junk gate + direct style extraction (spends TwelveLabs tokens)
    python -m services.discover.trend_style gate --limit 12
    python -m services.discover.trend_style extract --limit 12
    python -m services.discover.trend_style profiles --json-out data/style_profiles.json
"""

from __future__ import annotations

# TikTok cafe/food-review creators verified listable by yt-dlp without
# authentication (probe date above). Mid-size creators preferred — the harvest
# filter drops anyone over 2M followers as a media company, not a peer.
TIKTOK_FOOD_CREATORS = [
    "@sistersnacking",        # NYC food reviews
    "@eatingnyc",             # NYC cafes/restaurants
    "@foodwithsoy",           # LA food reviews
    "@jeremyjacobowitz",      # brunch / NYC
    "@theviplist",            # NYC restaurant reviews
    "@devourpower",           # NYC food couple
    "@cheatdayeats",          # food travel
    "@foodbabyny",            # NYC eats
    "@hangrydiary",           # food close-ups
    "@morgandrinkscoffee",    # coffee content
    "@coffeebae97",           # coffee / cafe
    "@audreysaurus",          # food + cafe vlogs
    "@chicagofoodauthority",  # Chicago
    "@bayareafoodz",          # Bay Area
    "@mikexingchen",          # food travel/reviews
    "@thefoodiediaries",      # cafe/restaurant finds
    "@eatwithque",            # food reviews
    "@sf.foodie",             # SF
    "@la.foodies",            # LA
]

# Cities for the YouTube #shorts trend sweep. Chosen to spread time zones and
# food scenes; the query templates in queries.py localize each archetype.
TREND_CITIES = ["San Diego", "Los Angeles", "New York", "Chicago", "Austin"]


def handles_arg() -> str:
    """The seed handles as the comma-separated string the CLI expects."""
    return ",".join(TIKTOK_FOOD_CREATORS)
