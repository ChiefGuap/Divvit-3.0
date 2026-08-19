"""Tests for the roster lifecycle and the dashboard seed export — no network.

Weighted toward the two failures that are expensive in a sales conversation
and invisible in a passing pipeline:

  1. **A closed cafe in a prospect's ranking.** The roster comes from OSM,
     which has no concept of a business closing, so the only thing standing
     between a shuttered cafe and a league table is the lifecycle filter. It
     has to hold at the store, at the scorer, and in the export.
  2. **A null read as a zero.** `data/roster_export.json` is consumed by
     another service. A cafe with no review signal is not a cafe with zero
     reviews, and a video whose like count we never fetched is not a video
     with no likes. Every absence in this file has to survive as null.

    .venv/bin/python -m services.venues.tests.test_lifecycle
"""

from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.venues.brand_health import score_roster                  # noqa: E402
from services.venues.export import (                                   # noqa: E402
    SCHEMA_VERSION, build_export, load_corpus_videos, write_export)
from services.venues.lifecycle import (                                # noqa: E402
    apply_life_evidence, assess_cafe, run_lifecycle_pass, verdict_from_match,
    verdict_from_reason)
from services.venues.places import PlaceMatch                          # noqa: E402
from services.venues.roster import (                                   # noqa: E402
    CafeRecord, STATUS_ACTIVE, STATUS_CLOSED, STATUS_UNVERIFIABLE)
from services.venues.store import RosterStore                          # noqa: E402

_failures: list[str] = []


def check(condition: bool, label: str) -> None:
    if condition:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}")
        _failures.append(label)


def make_cafe(cafe_id="osm:node:1", name="Coffee Dose", city="Costa Mesa",
              lat=33.6585, lon=-117.8854, **kw) -> CafeRecord:
    return CafeRecord(cafe_id=cafe_id, name=name, city=city, lat=lat, lon=lon,
                      **kw)


# The real strings the live passes wrote into cafe_signals.errors. Parsing
# these is how a lifecycle pass replays a finding without re-billing Places,
# so they are pinned here verbatim rather than paraphrased.
DRIFT_REASON = ("places: matched 'Zinc Cafe & Bar' 27620m away — too far to "
                "be the same business")
CLOSED_REASON = "places: 'Bestea' is CLOSED_PERMANENTLY"
TEMP_REASON = "places: 'Kean Coffee' is CLOSED_TEMPORARILY"
NO_RESULT_REASON = "places: no result for this name and city"
UNRATED_REASON = "places: 'New Cafe' has no ratings yet"


# ------------------------------------------------------------- transitions

def test_verdicts_from_evidence() -> None:
    print("\nlifecycle verdicts")
    closed = verdict_from_reason(CLOSED_REASON)
    check(closed.status == STATUS_CLOSED,
          "a CLOSED_PERMANENTLY businessStatus retires the cafe as closed")
    check(closed.confidence == "high",
          "and at high confidence — it is Google's first-party claim")
    check(closed.evidence.get("business_status") == "CLOSED_PERMANENTLY",
          "the observed status travels as evidence, not just a sentence")

    temp = verdict_from_reason(TEMP_REASON)
    check(temp.status == STATUS_CLOSED and temp.confidence == "medium",
          "a TEMPORARY closure is closed too, but at medium confidence — "
          "temporary closures reverse and the cafe should re-enter later")

    drift = verdict_from_reason(DRIFT_REASON)
    check(drift.status == STATUS_UNVERIFIABLE,
          "a drift refusal is UNVERIFIABLE, not closed — we could not find "
          "it, which is not the same as knowing it is gone")
    check(drift.confidence == "low",
          "and always at low confidence: it is a statement about our "
          "evidence, not about the cafe")
    check(drift.evidence.get("distance_m") == 27620.0
          and drift.evidence.get("location_bias_applied") is True,
          "the refused distance and the bias are recorded, so the refusal "
          "can be re-argued rather than just believed")

    check(verdict_from_reason(NO_RESULT_REASON).status == STATUS_UNVERIFIABLE,
          "an empty Places result is unverifiable, also not closed")

    unrated = verdict_from_reason(UNRATED_REASON)
    check(unrated.status == STATUS_ACTIVE and unrated.confidence == "high",
          "a cafe Google lists but nobody has rated is ACTIVE — the identity "
          "check passed; it is a new cafe, not a dead one")

    check(verdict_from_reason("").status == STATUS_ACTIVE,
          "no evidence never retires a cafe")
    check(verdict_from_reason("places: some future error we cannot parse"
                              ).status == STATUS_ACTIVE,
          "and an unparseable reason is our problem, not proof of a closure")


def test_verdict_from_live_match() -> None:
    print("\nlifecycle verdicts from a live Places match")
    operational = PlaceMatch(place_id="p1", name="Coffee Dose", address="",
                             latitude=33.6, longitude=-117.8, rating=4.9,
                             review_count=3554, business_status="OPERATIONAL")
    verdict = verdict_from_match(operational, None)
    check(verdict.status == STATUS_ACTIVE and verdict.confidence == "high",
          "an operational match confirms the cafe is active")

    shut = PlaceMatch(place_id="p2", name="Bestea", address="",
                      latitude=33.6, longitude=-117.8, rating=None,
                      review_count=None,
                      business_status="CLOSED_PERMANENTLY")
    check(verdict_from_match(shut, None).status == STATUS_CLOSED,
          "a closed match retires the cafe even with no rating to lose")

    unrated = PlaceMatch(place_id="p3", name="New Cafe", address="",
                         latitude=33.6, longitude=-117.8, rating=None,
                         review_count=None, business_status="OPERATIONAL")
    check(verdict_from_match(unrated, None).status == STATUS_ACTIVE,
          "an operational place with no rating yet stays active — no review "
          "signal is not the same finding as no business")

    check(verdict_from_match(None, DRIFT_REASON).status == STATUS_UNVERIFIABLE,
          "a rejected match falls through to the recorded reason")


def test_assess_prefers_cheapest_evidence() -> None:
    print("\nevidence precedence")
    cafe = make_cafe()

    class Boom:
        def find(self, *a, **kw):
            raise AssertionError("Places was called when stored evidence "
                                 "already answered the question")

    live = {"google": {"rating": 4.9, "review_count": 3554,
                       "place_id": "p1", "business_status": "OPERATIONAL"}}
    verdict = assess_cafe(cafe, live, Boom())
    check(verdict.status == STATUS_ACTIVE,
          "a stored review signal means the business exists — active")

    verdict = assess_cafe(cafe, {"errors": [DRIFT_REASON]}, Boom())
    check(verdict.status == STATUS_UNVERIFIABLE,
          "a stored reason is replayed without spending a Places call")

    shut = {"google": {"rating": 4.1, "review_count": 90, "place_id": "p9",
                       "business_status": "CLOSED_PERMANENTLY"}}
    check(assess_cafe(cafe, shut, None).status == STATUS_CLOSED,
          "a stored signal that carries a closed status still retires — a "
          "rating is not proof of trading")

    check(assess_cafe(cafe, {"errors": ["youtube search 'x': timeout"]},
                      None).status == STATUS_ACTIVE,
          "a YouTube error is not lifecycle evidence and retires nobody")

    class Cached:
        def __init__(self):
            self.calls = 0

        def find(self, name, city="", latitude=None, longitude=None):
            self.calls += 1
            return None, DRIFT_REASON

    client = Cached()
    verdict = assess_cafe(cafe, {"errors": []}, client)
    check(client.calls == 1 and verdict.status == STATUS_UNVERIFIABLE,
          "only a cafe with no recorded reason falls through to Places — "
          "which is how 27 clobbered rows were recovered for 0 billed calls")


def test_pass_is_idempotent_and_reversible() -> None:
    print("\nlifecycle pass")
    with tempfile.TemporaryDirectory() as tmp:
        store = RosterStore(Path(tmp) / "v.db")
        live = make_cafe("osm:node:live", "Live Cafe")
        shut = make_cafe("osm:node:shut", "Shut Cafe")
        ghost = make_cafe("osm:node:ghost", "Ghost Cafe")
        for cafe in (live, shut, ghost):
            store.upsert_cafe(cafe)
        check(all(c.status == STATUS_ACTIVE for c in store.cafes()),
              "every cafe starts active — OSM alone says nothing is wrong")

        store.set_signals(live.cafe_id, google={"rating": 4.6,
                                                "review_count": 200,
                                                "business_status": "OPERATIONAL"})
        store.set_signals(shut.cafe_id, errors=[CLOSED_REASON])
        store.set_signals(ghost.cafe_id, errors=[DRIFT_REASON])

        first = run_lifecycle_pass(store, now="2026-08-19T00:00:00+00:00")
        check(first["retired"] == 2 and first["changed"] == 2,
              "the first pass retires the closed and the unverifiable cafe")
        check(store.status_counts() == {STATUS_ACTIVE: 1, STATUS_CLOSED: 1,
                                        STATUS_UNVERIFIABLE: 1},
              "and the roster now carries one of each state")

        second = run_lifecycle_pass(store, now="2026-08-19T00:00:00+00:00")
        check(second["changed"] == 0 and second["unchanged"] == 3,
              "re-running changes nothing — the verdict is a pure function "
              "of the stored evidence, so the pass is safely repeatable")

        record = [c for c in store.cafes(include_inactive=True)
                  if c.cafe_id == ghost.cafe_id][0]
        check(record.status_reason and record.status_checked_at,
              "a retired record keeps its reason and the date it was judged")
        check(record.status_evidence.get("distance_m") == 27620.0,
              "and the evidence, so the retirement is a finding not a purge")

        # A temporary closure that lifts, or a rename Google catches up with.
        store.set_signals(ghost.cafe_id, google={"rating": 4.2,
                                                 "review_count": 31,
                                                 "business_status": "OPERATIONAL"})
        third = run_lifecycle_pass(store, now="2026-08-20T00:00:00+00:00")
        check(third["reactivated"] == 1,
              "new evidence reactivates a cafe — retirement is reversible, "
              "which is why the row was kept rather than deleted")

        dry_before = store.status_counts()
        run_lifecycle_pass(store, dry_run=True)
        check(store.status_counts() == dry_before,
              "--dry-run writes nothing")


def test_silence_does_not_acquit() -> None:
    """A live bug before it was a rule.

    A retirement can be recorded by a `--recheck` run, which reaches Places
    for cafes whose stored reason a later write clobbered. The next plain run
    finds no stored reason at all, produces the evidence-free verdict, and —
    before this — silently un-retired 26 cafes on the OC roster.
    """
    print("\nevidence-free verdicts cannot overturn a finding")
    with tempfile.TemporaryDirectory() as tmp:
        store = RosterStore(Path(tmp) / "v.db")
        cafe = make_cafe("osm:node:shut", "Shut Cafe")
        store.upsert_cafe(cafe)
        # Exactly the --recheck state: retired from a live lookup, with no
        # `places:` reason left on cafe_signals to replay next time.
        store.set_signals(cafe.cafe_id, errors=["youtube search 'x': timeout"])
        store.set_status(cafe.cafe_id, STATUS_CLOSED, confidence="high",
                         reason="Google reports it as CLOSED_PERMANENTLY",
                         evidence={"business_status": "CLOSED_PERMANENTLY"},
                         checked_at="2026-08-19T00:00:00+00:00")

        tally = run_lifecycle_pass(store, now="2026-08-20T00:00:00+00:00")
        record = store.cafes(include_inactive=True)[0]
        check(record.status == STATUS_CLOSED,
              "a run that finds NO evidence leaves the retirement standing — "
              "silence is not an acquittal")
        check(tally["held"] == 1 and tally["reactivated"] == 0,
              "and the run reports it as held, not as a reactivation")
        check(record.status_checked_at == "2026-08-19T00:00:00+00:00"
              and record.status_evidence.get("business_status")
              == "CLOSED_PERMANENTLY",
              "the original evidence and its date are left untouched, so the "
              "finding does not silently age into a fresher-looking one")

        # Real counter-evidence still wins — this must not become a one-way
        # door, or a reopened cafe can never come back.
        store.set_signals(cafe.cafe_id,
                          google={"rating": 4.4, "review_count": 60,
                                  "business_status": "OPERATIONAL"})
        again = run_lifecycle_pass(store, now="2026-08-21T00:00:00+00:00")
        check(again["reactivated"] == 1,
              "but positive evidence still reactivates — the rule blocks "
              "absence of evidence, not evidence")


def test_roster_refresh_does_not_resurrect() -> None:
    print("\nroster refresh vs lifecycle")
    with tempfile.TemporaryDirectory() as tmp:
        store = RosterStore(Path(tmp) / "v.db")
        cafe = make_cafe("osm:node:shut", "Shut Cafe")
        store.upsert_cafe(cafe)
        store.set_status(cafe.cafe_id, STATUS_CLOSED, confidence="high",
                         reason="Google reports it as CLOSED_PERMANENTLY",
                         evidence={"business_status": "CLOSED_PERMANENTLY"})

        # Exactly what `cli roster` does on the next Overpass run: the node is
        # still mapped, so it comes back as a fresh, default-active record.
        store.upsert_cafe(make_cafe("osm:node:shut", "Shut Cafe",
                                    city="Santa Ana"))
        survivors = [c for c in store.cafes(include_inactive=True)
                     if c.cafe_id == cafe.cafe_id]
        check(survivors[0].status == STATUS_CLOSED,
              "an Overpass refresh does not resurrect a closed cafe — OSM is "
              "the stale source the lifecycle exists to correct")
        check(survivors[0].city == "Santa Ana",
              "but it does still refresh the OSM-derived fields")


# ------------------------------------------------------------- exclusion

def test_retired_cafes_never_reach_a_ranking() -> None:
    print("\nexclusion from ranking")
    with tempfile.TemporaryDirectory() as tmp:
        store = RosterStore(Path(tmp) / "v.db")
        youtube = {"video_count": 6, "videos": [
            {"views": 10000, "likes": 900, "comments": 60,
             "published_at": "2026-08-10T00:00:00+00:00"}]}
        google = {"rating": 4.8, "review_count": 900}

        for i, status in enumerate((STATUS_ACTIVE, STATUS_ACTIVE,
                                    STATUS_CLOSED, STATUS_UNVERIFIABLE)):
            cafe = make_cafe(f"osm:node:{i}", f"Cafe {i}")
            store.upsert_cafe(cafe)
            store.set_signals(cafe.cafe_id, youtube=youtube, google=google)
            if status != STATUS_ACTIVE:
                store.set_status(cafe.cafe_id, status, confidence="high",
                                 reason="test")

        active = store.cafes()
        check(len(active) == 2,
              "cafes() returns only the active cafes by default")
        check(len(store.cafes(include_inactive=True)) == 4,
              "and --include-inactive style access still sees all four — the "
              "records are retired, not deleted")

        ranked = [h for h in score_roster(active, store.all_signals())
                  if h.rankable]
        check(len(ranked) == 2,
              "only active cafes are ranked")

        # The belt-and-braces case: a caller that forgets the filter.
        leaky = score_roster(store.cafes(include_inactive=True),
                             store.all_signals())
        check(len(leaky) == 2,
              "score_roster drops retired cafes itself, so a caller that "
              "passes the full roster still cannot rank a closed cafe")
        check(len(score_roster(store.cafes(include_inactive=True),
                               store.all_signals(),
                               include_inactive=True)) == 4,
              "the audit view is opt-in and explicit")

        cohort = {h.assumptions["cohort_size"] for h in leaky}
        check(cohort == {2},
              "and retired cafes are out of the percentile cohort too — "
              "otherwise they pad the distribution and inflate everyone else")

        # Retired cafes must not sit in the queues either.
        store.set_signals("osm:node:9", errors=["x"])
        pending = store.pending_cafes(include_inactive=True)
        check(all(c.status == STATUS_ACTIVE
                  for c in store.pending_cafes()),
              "pending_cafes skips retired cafes — no yt-dlp time is spent "
              "on a cafe nobody can sell to")
        check(len(pending) >= len(store.pending_cafes()),
              "though the audit view can still enumerate them")


def test_selection_prefers_reviewed_cafes() -> None:
    """Task-2 selection: under a capped run, measure the cafes that flip to
    rankable, not the ones that merely come first in cafe_id order."""
    print("\nselection: review-signal-first")
    with tempfile.TemporaryDirectory() as tmp:
        store = RosterStore(Path(tmp) / "v.db")
        reviewed = make_cafe("osm:node:2reviewed", "Reviewed Cafe")
        bare = make_cafe("osm:node:1bare", "Unmeasured Cafe")
        retired = make_cafe("osm:node:3retired", "Closed Cafe")
        done = make_cafe("osm:node:4done", "Already Filmed Cafe")
        for cafe in (reviewed, bare, retired, done):
            store.upsert_cafe(cafe)

        store.set_signals(reviewed.cafe_id, google={"rating": 4.5,
                                                    "review_count": 120},
                          reviews_checked_at="2026-08-18T00:00:00+00:00")
        store.set_signals(retired.cafe_id, google={"rating": 3.9,
                                                   "review_count": 12},
                          reviews_checked_at="2026-08-18T00:00:00+00:00")
        store.set_status(retired.cafe_id, STATUS_CLOSED, confidence="high",
                         reason="test")
        store.set_signals(done.cafe_id, google={"rating": 4.1,
                                                "review_count": 40},
                          youtube={"video_count": 2, "videos": []},
                          video_checked_at="2026-08-18T00:00:00+00:00")

        selected = store.pending_cafes(with_review_signal=True)
        check([c.cafe_id for c in selected] == [reviewed.cafe_id],
              "the selection is exactly the cafes with a review signal and no "
              "video signal yet")
        check(bare.cafe_id not in {c.cafe_id for c in selected},
              "a cafe with neither signal is not selected — it needs the "
              "video pass to also FIND something before it can rank")
        check(retired.cafe_id not in {c.cafe_id for c in selected},
              "and a retired cafe is not selected however good its rating")
        check(done.cafe_id not in {c.cafe_id for c in selected},
              "nor is one the video pass already measured — resume, not "
              "restart, still holds")

        unfiltered = {c.cafe_id for c in store.pending_cafes()}
        check(unfiltered == {reviewed.cafe_id, bare.cafe_id},
              "without the flag the queue is every active unmeasured cafe, "
              "in cafe_id order — the default is unchanged")


# ---------------------------------------------------------------- export

def _seeded_store(tmp: str) -> RosterStore:
    store = RosterStore(Path(tmp) / "v.db")
    rich = make_cafe("osm:node:rich", "Coffee Dose", website="https://x.test",
                     instagram="coffeedose", county="Orange County")
    thin = make_cafe("osm:node:thin", "Quiet Cafe", city="Irvine")
    shut = make_cafe("osm:node:shut", "Shut Cafe", city="Anaheim")
    for cafe in (rich, thin, shut):
        store.upsert_cafe(cafe)

    store.set_signals(
        rich.cafe_id,
        youtube={"video_count": 2, "queries": ['"Coffee Dose" Costa Mesa'],
                 "collected_at": "2026-08-19T04:00:00+00:00",
                 "videos": [
                     {"canonical_id": "youtube:a", "url": "https://y.test/a",
                      "title": "A", "views": 1000, "likes": 20,
                      "comments": 3,
                      "published_at": "2026-08-01T00:00:00+00:00"},
                     # The tail of a search: views only, never enriched.
                     {"canonical_id": "youtube:b", "url": "https://y.test/b",
                      "title": "B", "views": 40, "likes": None,
                      "comments": None, "published_at": None}]},
        google={"provider": "google_places", "rating": 4.9,
                "review_count": 3554, "place_id": "p1",
                "matched_name": "Coffee Dose",
                "business_status": "OPERATIONAL"},
        # Naive, the way SQLite's CURRENT_TIMESTAMP writes it.
        collected_at="2026-08-19 04:00:00",
        video_checked_at="2026-08-19T04:00:00+00:00")
    # Measured and found nothing: a real zero, and no review source answered.
    store.set_signals(thin.cafe_id,
                      youtube={"video_count": 0, "videos": [],
                               "queries": ['"Quiet Cafe" Irvine']},
                      video_checked_at="2026-08-19T04:00:00+00:00")
    store.set_signals(shut.cafe_id, errors=[CLOSED_REASON])
    run_lifecycle_pass(store, now="2026-08-19T05:00:00+00:00")
    return store


def test_export_shape() -> None:
    print("\nexport shape")
    with tempfile.TemporaryDirectory() as tmp:
        store = _seeded_store(tmp)
        payload = build_export(store, corpus_db=Path(tmp) / "missing.db")

        check(payload["schema_version"] == SCHEMA_VERSION,
              "the payload is versioned — it is a contract another service "
              "reads, not an ad-hoc dump")
        ids = {c["cafe_id"] for c in payload["cafes"]}
        check(ids == {"osm:node:rich", "osm:node:thin"},
              "`cafes` is the ACTIVE set only")
        check([c["cafe_id"] for c in payload["retired"]] == ["osm:node:shut"],
              "and the closed cafe is in `retired`, kept as evidence")
        check(payload["counts"]["active"] == len(payload["cafes"])
              and payload["counts"]["retired"] == len(payload["retired"]),
              "the counts agree with the arrays they describe")
        check(payload["counts"]["by_status"][STATUS_CLOSED] == 1,
              "the status breakdown is exported for the dashboard to show")

        rich = next(c for c in payload["cafes"]
                    if c["cafe_id"] == "osm:node:rich")
        for key in ("cafe_id", "name", "city", "lat", "lon", "website",
                    "instagram", "status", "brand_health", "review_signal",
                    "video_signal", "videos", "measured_at"):
            check(key in rich, f"every cafe carries `{key}`")

        check(rich["status"]["state"] == STATUS_ACTIVE
              and rich["status"]["checked_at"],
              "status ships as a block with the date it was assessed")
        check(rich["review_signal"]["place_id"] == "p1"
              and rich["review_signal"]["rating"] == 4.9,
              "the review signal carries the rating and the place_id")
        check(rich["video_signal"]["video_count"] == 2
              and rich["video_signal"]["total_views"] == 1040,
              "the video signal summarizes what was found")
        check(len(rich["videos"]) == 2
              and rich["videos"][0]["views"] == 1000,
              "and the cafe's videos come through, most-viewed first")

        health = rich["brand_health"]
        check(health is not None and "components" in health
              and "assumptions" in health,
              "brand health ships with the full breakdown, not a bare number")
        check(set(health["components"]) ==
              {"social_volume", "engagement_quality", "recency",
               "review_signal"},
              "every weighted component is present, absent ones included")
        check("rankable" in health and "confidence" in health,
              "rankable and confidence travel with the score, so a consumer "
              "cannot show a thin score as a league position by accident")
        check(health["computed_at"] == payload["generated_at"],
              "the score is computed fresh at export time, so its percentiles "
              "match the cohort in this very file — not a stored snapshot "
              "normalized against a different night's roster")

        retired = payload["retired"][0]
        check(retired["status"]["state"] == STATUS_CLOSED
              and retired["status"]["reason"],
              "a retired record exports its state and the reason for it")
        check(retired["brand_health"] is None,
              "and is never scored — it was not in the scoring cohort")


def test_export_never_fabricates() -> None:
    print("\nexport: absent stays null, never 0")
    with tempfile.TemporaryDirectory() as tmp:
        store = _seeded_store(tmp)
        payload = build_export(store, corpus_db=Path(tmp) / "missing.db")
        rich = next(c for c in payload["cafes"]
                    if c["cafe_id"] == "osm:node:rich")
        thin = next(c for c in payload["cafes"]
                    if c["cafe_id"] == "osm:node:thin")

        check(thin["review_signal"] is None,
              "no review source answered -> null, NOT a zero-star cafe")
        check(thin["video_signal"]["video_count"] == 0,
              "but a search that found nothing IS a measured 0 — the one "
              "place a zero is honest")
        check(thin["videos"] == [],
              "and its video list is empty rather than absent")
        check(thin["video_signal"]["total_views"] is None,
              "with no videos there are no views to sum — null, not 0")

        tail = rich["videos"][1]
        check(tail["likes"] is None and tail["comments"] is None,
              "an un-enriched video keeps null likes/comments — yt-dlp's "
              "flat search returns views only, and 0 likes is a claim")
        check(tail["published_at"] is None,
              "an unknown publish date stays null rather than becoming an "
              "epoch that would read as an ancient, dead cafe")
        check(rich["videos"][0]["views"] == 1000,
              "measured values are untouched")

        check(thin["website"] is None and thin["instagram"] is None,
              "OSM's empty strings export as null, not as ''")
        check(rich["instagram"] == "coffeedose",
              "and a real handle survives as a bare handle")

        check(rich["measured_at"] == "2026-08-19T04:00:00+00:00",
              "SQLite's naive timestamp is normalized to ISO-8601 UTC")
        check(rich["status"]["checked_at"].endswith("+00:00")
              and payload["generated_at"].endswith("+00:00"),
              "every timestamp carries an explicit UTC offset")

        blob = json.dumps(payload)
        check('"rating": 0' not in blob and '"review_count": 0' not in blob,
              "no zero-filled review values anywhere in the payload")


def test_export_joins_the_video_corpus() -> None:
    print("\nexport: videos from discover.db")
    with tempfile.TemporaryDirectory() as tmp:
        corpus = Path(tmp) / "discover.db"
        conn = sqlite3.connect(corpus)
        conn.execute(
            "CREATE TABLE discovered_videos (canonical_id TEXT, platform TEXT,"
            " url TEXT, title TEXT, published_at TEXT, creator TEXT,"
            " metrics TEXT, rights_status TEXT, business_id TEXT)")
        conn.executemany(
            "INSERT INTO discovered_videos VALUES (?,?,?,?,?,?,?,?,?)", [
                ("youtube:c1", "youtube", "https://y.test/c1", "Big",
                 "2026-08-01T00:00:00+00:00", '{"handle": "@ktla"}',
                 '{"view_count": 5000, "like_count": 60, "comment_count": 4}',
                 "unlicensed_reference", "osm:node:rich"),
                ("youtube:c2", "youtube", "https://y.test/c2", "Small",
                 "2026-07-01T00:00:00+00:00", '{"handle": "@who"}',
                 '{"view_count": 12, "like_count": null}',
                 "unlicensed_reference", "osm:node:rich"),
                ("youtube:c3", "youtube", "https://y.test/c3", "Orphan",
                 None, "{}", "{}", None, "osm:node:absent")])
        conn.commit()
        conn.close()

        by_business = load_corpus_videos(corpus)
        check(len(by_business["osm:node:rich"]) == 2,
              "videos are joined on business_id = cafe_id, the shared spine "
              "between the roster and the video corpus")
        check(by_business["osm:node:rich"][0]["canonical_id"] == "youtube:c1",
              "and ordered most-viewed first")
        check(by_business["osm:node:rich"][1]["likes"] is None,
              "a null like_count in the corpus stays null in the export")
        check(by_business["osm:node:rich"][0]["creator"] == "@ktla",
              "the creator handle comes through for attribution")

        store = _seeded_store(tmp)
        payload = build_export(store, corpus_db=corpus)
        rich = next(c for c in payload["cafes"]
                    if c["cafe_id"] == "osm:node:rich")
        check({v["canonical_id"] for v in rich["videos"]} ==
              {"youtube:c1", "youtube:c2"},
              "the corpus is preferred over the summary stored on the signal")
        check(payload["counts"]["videos"] == 2,
              "and the count reflects what was actually attached")

        missing = build_export(store, corpus_db=Path(tmp) / "nope.db")
        rich = next(c for c in missing["cafes"]
                    if c["cafe_id"] == "osm:node:rich")
        check(len(rich["videos"]) == 2,
              "with no corpus the export falls back to the stored summary "
              "rather than silently losing a cafe's videos")


def test_export_writes_the_file() -> None:
    print("\nexport: cli export produces the file")
    with tempfile.TemporaryDirectory() as tmp:
        store = _seeded_store(tmp)
        out, payload = write_export(store, path=Path(tmp) / "d" / "r.json",
                                    corpus_db=Path(tmp) / "nope.db")
        check(out.exists(), "the export path is created and written")
        reloaded = json.loads(out.read_text())
        check(reloaded == payload,
              "what lands on disk is exactly what was built — valid JSON, "
              "round-trips without loss")
        check(reloaded["cafes"] and "cafe_id" in reloaded["cafes"][0],
              "and it is the documented shape, not a stringified blob")


def _youtube_signal(*published: str) -> dict:
    return {"video_count": len(published),
            "videos": [{"canonical_id": f"youtube:v{i}", "views": 1000,
                        "likes": 50, "comments": 5, "published_at": p}
                       for i, p in enumerate(published)]}


def test_recent_video_overturns_unverifiable() -> None:
    """Measured on the live roster: three cafes were retired as unverifiable
    while carrying 2025/2026 video — two of them ranked #2 and #4 in the
    county. A cafe people are still filming is trading, and `unverifiable` is
    a claim about our evidence, not about the cafe.
    """
    print("\nrecent video as counter-evidence")
    now = datetime(2026, 8, 19, tzinfo=timezone.utc)
    unverifiable = verdict_from_reason(DRIFT_REASON)
    check(unverifiable.status == STATUS_UNVERIFIABLE, "baseline is unverifiable")

    fresh = apply_life_evidence(
        unverifiable, {"youtube": _youtube_signal("2026-01-01T00:00:00Z")},
        now=now)
    check(fresh.is_active, "a video from 7 months ago revives the cafe")
    check(fresh.confidence == "medium",
          "at medium confidence — inferred from activity, not confirmed by Google")
    check(fresh.evidence["overturned"]["status"] == STATUS_UNVERIFIABLE,
          "and the overturned verdict is kept, so the reversal is auditable")

    stale = apply_life_evidence(
        unverifiable, {"youtube": _youtube_signal("2019-06-28T00:00:00Z")},
        now=now)
    check(stale.status == STATUS_UNVERIFIABLE,
          "a video from 2019 says nothing about today — retirement stands")

    none = apply_life_evidence(unverifiable, {"youtube": _youtube_signal()},
                               now=now)
    check(none.status == STATUS_UNVERIFIABLE, "no videos, no reprieve")

    closed = verdict_from_reason(CLOSED_REASON)
    still_closed = apply_life_evidence(
        closed, {"youtube": _youtube_signal("2026-06-01T00:00:00Z")}, now=now)
    check(still_closed.status == STATUS_CLOSED,
          "a recent video NEVER reopens a cafe Google says is closed — "
          "first-party status outranks our inference")


def test_life_evidence_survives_a_plain_run() -> None:
    """The revival must not depend on passing --recheck.

    The evidence-free path exists so silence cannot acquit a retired cafe.
    But a recent video is not silence, so it has to reach through that guard —
    without letting it reopen a `closed` one.
    """
    print("\nrevival on the plain path")
    with tempfile.TemporaryDirectory() as tmp:
        store = RosterStore(Path(tmp) / "v.db")
        live = make_cafe("osm:node:live", "Still Filmed Cafe")
        shut = make_cafe("osm:node:shut", "Shut Cafe")
        store.upsert_cafe(live)
        store.upsert_cafe(shut)
        # The clobbered state: no `places:` reason left to replay.
        for cafe in (live, shut):
            store.set_signals(cafe.cafe_id,
                              youtube=_youtube_signal("2026-06-01T00:00:00Z"),
                              errors=["youtube search 'x': timeout"])
        store.set_status(live.cafe_id, STATUS_UNVERIFIABLE, "low",
                         "drift refusal", {"source": "google_places"})
        store.set_status(shut.cafe_id, STATUS_CLOSED, "high",
                         "CLOSED_PERMANENTLY", {"source": "google_places"})

        run_lifecycle_pass(store, now="2026-08-19T00:00:00Z")
        check(store.get_cafe(live.cafe_id).status == STATUS_ACTIVE,
              "an unverifiable cafe with recent video revives without --recheck")
        check(store.get_cafe(shut.cafe_id).status == STATUS_CLOSED,
              "a closed cafe with recent video stays closed")

        # And it is stable: a second run must not oscillate.
        run_lifecycle_pass(store, now="2026-08-19T00:00:00Z")
        check(store.get_cafe(live.cafe_id).status == STATUS_ACTIVE,
              "and the revival is stable across re-runs")


def main() -> int:
    for test in (test_verdicts_from_evidence, test_verdict_from_live_match,
                 test_assess_prefers_cheapest_evidence,
                 test_pass_is_idempotent_and_reversible,
                 test_silence_does_not_acquit,
                 test_roster_refresh_does_not_resurrect,
                 test_retired_cafes_never_reach_a_ranking,
                 test_selection_prefers_reviewed_cafes,
                 test_export_shape, test_export_never_fabricates,
                 test_export_joins_the_video_corpus,
                 test_export_writes_the_file,
                 test_recent_video_overturns_unverifiable,
                 test_life_evidence_survives_a_plain_run):
        test()
    print()
    if _failures:
        print(f"FAILED: {len(_failures)}")
        for f in _failures:
            print(f"  - {f}")
        return 1
    print("all tests passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
