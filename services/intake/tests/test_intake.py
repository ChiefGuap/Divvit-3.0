"""Tests for intake — no network, no API keys, no TwelveLabs spend.

Weighted toward the failures that would cost real money or real trust:

  * a re-encoded/trimmed/resized duplicate slipping past dedupe (a reward
    paid twice for one video)
  * two DIFFERENT videos of the same cafe being called duplicates (an honest
    submitter accused of theft)
  * a paid Pegasus call firing after a local gate already decided
  * the theft gate rejecting instead of reviewing (the original creator is
    the likeliest matcher and must not be auto-punished)
  * fingerprints not surviving the store round trip

Video files are synthesized with ffmpeg lavfi sources — three visually
unrelated generators stand in for three different videos, and transformed
copies stand in for re-uploads. Real-clip behaviour is measured separately by
services.intake.calibrate against data/create_clips_eval.

    .venv/bin/python -m services.intake.tests.test_intake
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from screening import BusinessProfile                            # noqa: E402
from services.intake.fingerprint import (                        # noqa: E402
    FingerprintError, MATCH_THRESHOLD, NEAR_THRESHOLD, VideoFingerprint,
    compare, fingerprint_distance, fingerprint_file)
from services.intake.pipeline import IntakePipeline              # noqa: E402
from services.intake.provenance import (                         # noqa: E402
    PASS, REJECT, REVIEW, REASON_OTHER_USER, REASON_RESUBMIT, REASON_UNOWNED,
    check_duplicate, check_public_corpus)
from services.intake.store import IntakeStore                    # noqa: E402
from services.intake.venue_check import (                        # noqa: E402
    VenueGate, cross_check, resolve_claim)
from services.venues import BusinessCatalog, BusinessRecord      # noqa: E402

_failures: list[str] = []


def check(condition: bool, label: str) -> None:
    if condition:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}")
        _failures.append(label)


# ------------------------------------------------------------ video fixtures

_WORKDIR: Path
_VIDEOS: dict[str, Path] = {}

# Three visually unrelated lavfi generators = three different videos.
_SOURCES = {
    "video_a": "testsrc2=size=320x240:rate=25",
    "video_b": "mandelbrot=size=320x240:rate=25",
    "video_c": "testsrc=size=320x240:rate=25",
    "flat_green": "color=c=green:size=320x240:rate=25",
    "flat_blue": "color=c=blue:size=320x240:rate=25",
}

# Transforms of video_a = what a re-upload of the same footage looks like.
_VARIANTS = {
    "a_reencoded": ["-i", "{src}", "-c:v", "libx264", "-crf", "35",
                    "-preset", "veryfast", "-an"],
    "a_resized": ["-i", "{src}", "-vf", "scale=160:-2",
                  "-c:v", "libx264", "-crf", "28", "-an"],
    "a_trimmed": ["-ss", "1.5", "-i", "{src}",
                  "-c:v", "libx264", "-crf", "23", "-an"],
}


def _ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args],
                   check=True, timeout=300)


def build_videos(workdir: Path) -> None:
    for name, source in _SOURCES.items():
        out = workdir / f"{name}.mp4"
        _ffmpeg("-f", "lavfi", "-i", source, "-t", "10",
                "-c:v", "libx264", "-crf", "28", "-an", str(out))
        _VIDEOS[name] = out
    src = str(_VIDEOS["video_a"])
    for name, args in _VARIANTS.items():
        out = workdir / f"{name}.mp4"
        _ffmpeg(*[a.format(src=src) for a in args], str(out))
        _VIDEOS[name] = out


_FP_CACHE: dict[str, VideoFingerprint] = {}


def fp(name: str) -> VideoFingerprint:
    if name not in _FP_CACHE:
        _FP_CACHE[name] = fingerprint_file(_VIDEOS[name])
    return _FP_CACHE[name]


# ------------------------------------------------------------------- fakes

class FakeScreener:
    """Stands in for the paid Pegasus call. Counts spends so tests can
    assert the pipeline never paid when a local gate had already decided."""

    def __init__(self, analysis: dict | None = None, available: bool = True):
        self.analysis = analysis or {
            "is_food_beverage_content": True,
            "content_type": "review", "content_type_confidence": "high",
            "venue_match": "confirmed",
            "venue_evidence": ["LA BORA sign", "spoken mention of La Bora"],
            "detected_items": ["salt bread", "matcha latte"],
            "sentiment": "positive", "quality_flags": [],
            "summary": "a review at the claimed venue",
        }
        self._available = available
        self.calls = 0

    def available(self):
        return (True, "fake") if self._available else (False, "no key")

    def screen_file(self, path, business: BusinessProfile):
        self.calls += 1
        self.last_business = business
        return dict(self.analysis)


class FakeCorpusStore:
    """Duck-types the two CorpusStore.query calls the venue gate makes."""

    def __init__(self, videos: list | None = None):
        self.videos = videos or []

    def query(self, business_id=None, screened_only=False, **kwargs):
        out = self.videos
        if business_id is not None:
            out = [v for v in out if getattr(v, "business_id", None) == business_id]
        if screened_only:
            out = [v for v in out if getattr(v, "screening", None)]
        return list(out)


def corpus_video(cid: str, evidence: list[str], items: list[str],
                 business_id: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        canonical_id=cid, url=f"https://example.com/{cid}",
        business_id=business_id,
        screening={"verdict": "approved_for_collection",
                   "analysis": {"venue_evidence": evidence,
                                "detected_items": items}})


def make_pipeline(tmp: Path, screener: FakeScreener | None = None,
                  corpus_store=None, catalog=None,
                  db: str = "intake.db") -> tuple[IntakePipeline, IntakeStore]:
    store = IntakeStore(tmp / db)
    gate = VenueGate(screener=screener, catalog=catalog,
                     corpus_store=corpus_store)
    return IntakePipeline(store, gate, on_status=lambda _m: None), store


def _catalog() -> BusinessCatalog:
    return BusinessCatalog([
        BusinessRecord(business_id="labora", name="La Bora",
                       city="San Diego", cuisine="Korean cafe",
                       menu_items=["salt bread", "matcha latte"],
                       visual_cues=["terracotta interior"]),
        BusinessRecord(business_id="cauldron", name="The Cauldron Ice Cream",
                       city="Los Angeles",
                       menu_items=["cake pop cone"]),
    ])


# -------------------------------------------------------------------- tests

def test_dedupe_catches_variants() -> None:
    print("fingerprint: same footage under transformation")
    base = fp("video_a")
    for name in ("a_reencoded", "a_resized", "a_trimmed"):
        d = fingerprint_distance(base, fp(name))
        check(d <= MATCH_THRESHOLD,
              f"{name} matches the original (distance {d:.0f} <= "
              f"{MATCH_THRESHOLD:.0f})")
        check(compare(base, fp(name)).verdict == "match",
              f"{name} compares as a match")
    check(compare(base, base).exact, "identical bytes short-circuit on sha256")


def test_different_videos_stay_distinct() -> None:
    print("fingerprint: different videos never match")
    names = ["video_a", "video_b", "video_c"]
    for i, x in enumerate(names):
        for y in names[i + 1:]:
            d = fingerprint_distance(fp(x), fp(y))
            check(d > NEAR_THRESHOLD,
                  f"{x} vs {y} distinct (distance {d:.0f} > "
                  f"{NEAR_THRESHOLD:.0f})")
    # Variants of A must also stay distinct from B and C — a transform must
    # not drag a video toward everything else.
    for variant in ("a_reencoded", "a_trimmed"):
        d = fingerprint_distance(fp(variant), fp("video_b"))
        check(d > NEAR_THRESHOLD, f"{variant} vs video_b distinct ({d:.0f})")


def test_flat_videos_cannot_match() -> None:
    print("fingerprint: featureless footage is never perceptual evidence")
    green, blue = fp("flat_green"), fp("flat_blue")
    check(green.flat_fraction > 0.9, "solid-colour frames are flagged flat")
    result = compare(green, blue)
    check(result.verdict == "distinct",
          "two different solid-colour videos do not 'match' "
          f"(distance {result.distance:.0f})")
    check(compare(green, green).exact,
          "the same flat file still matches by sha256")


def test_fingerprint_roundtrip() -> None:
    print("fingerprint: store round trip")
    original = fp("video_a")
    restored = VideoFingerprint.from_json(original.to_json())
    check(restored.frame_hashes == original.frame_hashes,
          "frame hashes survive JSON")
    check(restored.flat_flags == original.flat_flags, "flat flags survive")
    check(restored.sha256 == original.sha256, "sha256 survives")

    with tempfile.TemporaryDirectory() as tmp:
        store = IntakeStore(Path(tmp) / "intake.db")
        sid = store.record_submission(
            submitter_id="u1", claimed_business="La Bora",
            claimed_location="San Diego", file_name="a.mp4",
            fingerprint=original, gates=[], verdict="needs_review",
            reasons=["x"])
        row = store.submissions()[0]
        check(row["submission_id"] == sid, "submission persisted")
        check(row["fingerprint"].frame_hashes == original.frame_hashes,
              "fingerprint survives the SQLite round trip")
        d = fingerprint_distance(row["fingerprint"], fp("a_reencoded"))
        check(d <= MATCH_THRESHOLD,
              "a restored fingerprint still catches a re-encode")


def test_submitter_vs_thief() -> None:
    print("provenance: resubmit vs theft")
    with tempfile.TemporaryDirectory() as tmp:
        store = IntakeStore(Path(tmp) / "intake.db")
        store.record_submission(
            submitter_id="u1", claimed_business="La Bora",
            claimed_location="", file_name="a.mp4", fingerprint=fp("video_a"),
            gates=[], verdict="approved_for_collection", reasons=[])

        same = check_duplicate(fp("a_reencoded"), store, submitter_id="u1")
        check(same.status == REJECT and same.reason == REASON_RESUBMIT,
              "same submitter re-encoding their own upload -> resubmit")
        check(not same.evidence.get("possible_theft"),
              "a resubmit is not flagged as theft")

        thief = check_duplicate(fp("a_reencoded"), store, submitter_id="u2")
        check(thief.status == REJECT and thief.reason == REASON_OTHER_USER,
              "different submitter uploading the same footage -> rejected")
        check(thief.evidence.get("possible_theft") is True,
              "and flagged as possible theft")
        check(thief.evidence.get("matched_submitter_id") == "u1",
              "with the original submitter recorded")

        clean = check_duplicate(fp("video_b"), store, submitter_id="u2")
        check(clean.status == PASS, "a different video passes")


def test_duplicate_attributed_to_earliest() -> None:
    print("provenance: duplicates attribute to the earliest submission")
    with tempfile.TemporaryDirectory() as tmp:
        store = IntakeStore(Path(tmp) / "intake.db")
        first = store.record_submission(
            submitter_id="u1", claimed_business="x", claimed_location="",
            file_name="a.mp4", fingerprint=fp("video_a"), gates=[],
            verdict="approved_for_collection", reasons=[])
        store.record_submission(
            submitter_id="u2", claimed_business="x", claimed_location="",
            file_name="a2.mp4", fingerprint=fp("a_reencoded"), gates=[],
            verdict="rejected", reasons=[REASON_OTHER_USER])
        result = check_duplicate(fp("a_resized"), store, submitter_id="u3")
        check(result.evidence.get("matched_submission_id") == first,
              "the match points at the first claim, not the latest copy")


def test_theft_against_public_corpus() -> None:
    print("provenance: known public video -> review with ops evidence")
    with tempfile.TemporaryDirectory() as tmp:
        store = IntakeStore(Path(tmp) / "intake.db")

        empty = check_public_corpus(fp("video_a"), store)
        check(empty.status == PASS, "an empty corpus index passes cleanly")

        store.upsert_corpus_fingerprint(
            canonical_id="tiktok:123", fingerprint=fp("video_a"),
            platform="tiktok", url="https://tiktok.com/@maker/video/123",
            creator_handle="@maker", title="my cafe video")

        hit = check_public_corpus(fp("a_reencoded"), store)
        check(hit.status == REVIEW and hit.reason == REASON_UNOWNED,
              "matching a harvested public video -> needs_review, NOT reject")
        check(hit.evidence.get("matched_url") ==
              "https://tiktok.com/@maker/video/123",
              "evidence carries the platform URL")
        check(hit.evidence.get("matched_creator_handle") == "@maker",
              "and the creator handle ops must verify against")

        miss = check_public_corpus(fp("video_c"), store)
        check(miss.status == PASS, "a different video still passes")


def test_gate_ordering_no_paid_call() -> None:
    print("pipeline: local gates fire before any paid call")
    with tempfile.TemporaryDirectory() as tmp:
        screener = FakeScreener()
        pipeline, store = make_pipeline(Path(tmp), screener)

        first = pipeline.submit(_VIDEOS["video_a"], "u1", "La Bora",
                                "North Park, San Diego")
        check(first.verdict == "approved_for_collection",
              "a clean submission reaches the venue gate and approves")
        check(screener.calls == 1, "the clean path costs exactly one call")

        dup = pipeline.submit(_VIDEOS["a_reencoded"], "u2", "La Bora",
                              "North Park, San Diego")
        check(dup.verdict == "rejected"
              and dup.reasons == [REASON_OTHER_USER],
              "a re-encoded duplicate by another user is rejected")
        check(screener.calls == 1,
              "and the rejection cost zero additional paid calls")
        venue_gates = [g for g in dup.gates if g.gate == "venue_verification"]
        check(venue_gates and venue_gates[0].status == "skipped",
              "the venue gate is recorded as skipped, not omitted")

        store.upsert_corpus_fingerprint(
            canonical_id="yt:v", fingerprint=fp("video_b"),
            platform="youtube", url="https://youtube.com/watch?v=v",
            creator_handle="@orig")
        theft = pipeline.submit(_VIDEOS["video_b"], "u3", "La Bora", "")
        check(theft.verdict == "needs_review"
              and theft.reasons == [REASON_UNOWNED],
              "a known public video routes to review")
        check(screener.calls == 1,
              "ownership review also withholds the paid call")

        check(store.counts()["submissions"] == 3,
              "every submission is persisted, rejects included")


def test_unreadable_file() -> None:
    print("pipeline: an unreadable file is unscreenable, not a crash")
    with tempfile.TemporaryDirectory() as tmp:
        garbage = Path(tmp) / "garbage.mp4"
        garbage.write_bytes(b"not a video at all" * 100)
        screener = FakeScreener()
        pipeline, _ = make_pipeline(Path(tmp), screener)
        outcome = pipeline.submit(garbage, "u1", "La Bora", "")
        check(outcome.verdict == "unscreenable", "verdict is unscreenable")
        check(screener.calls == 0, "and nothing was spent on it")
        try:
            fingerprint_file(Path(tmp) / "missing.mp4")
            check(False, "missing file raises")
        except FingerprintError:
            check(True, "missing file raises")


def test_claim_resolution() -> None:
    print("venue: claim resolution")
    claim = resolve_claim("la bora", "North Park, San Diego", _catalog())
    check(claim.in_catalog and claim.business_id == "labora",
          "a claimed name resolves to the catalog record")
    check("salt bread" in claim.profile.menu_items,
          "and the profile is enriched with the catalog's menu")

    bare = resolve_claim("Cafe Nobody Knows", "Austin, TX", _catalog())
    check(not bare.in_catalog, "an unknown venue does not force a match")
    check(bare.profile.name == "Cafe Nobody Knows"
          and bare.profile.location == "Austin, TX",
          "and still yields a usable bare profile")

    no_cat = resolve_claim("La Bora", "San Diego", None)
    check(no_cat.profile.name == "La Bora",
          "no catalog at all still yields a profile")


def test_venue_gate_degrades_without_corpus() -> None:
    print("venue: empty corpus degrades, never fails")
    screener = FakeScreener()
    gate = VenueGate(screener=screener, corpus_store=None)
    result, payload = gate.check(_VIDEOS["video_a"], "La Bora", "San Diego")
    check(result.status == PASS, "screening alone can approve")
    check(payload["corroboration"]["status"] == "no_context",
          "and the payload says the corpus had nothing to add")

    empty = VenueGate(screener=FakeScreener(),
                      corpus_store=FakeCorpusStore([]))
    result2, payload2 = empty.check(_VIDEOS["video_a"], "La Bora", "")
    check(payload2["corroboration"]["status"] == "no_context",
          "an empty corpus store behaves like no corpus store")

    offline = VenueGate(screener=None)
    result3, payload3 = offline.check(_VIDEOS["video_a"], "La Bora", "")
    check(result3.status == REVIEW
          and result3.reason == "screening_unavailable",
          "no screener -> review, the claim is recorded but unverified")
    check(payload3 is None, "and no screening payload is invented")


def test_corroboration() -> None:
    print("venue: corpus corroboration and contradiction")
    unclear = {
        "is_food_beverage_content": True, "content_type": "vlog",
        "content_type_confidence": "high", "venue_match": "unclear",
        "venue_evidence": ["LA BORA on a cup"],
        "detected_items": ["salt bread"], "sentiment": "positive",
        "quality_flags": [], "summary": "",
    }

    # Corpus footage of the same business read the same signage.
    agreeing = FakeCorpusStore([
        corpus_video("yt:1", ["La Bora Cafe"], ["salt bread", "matcha"],
                     business_id="labora")])
    gate = VenueGate(screener=FakeScreener(unclear), catalog=_catalog(),
                     corpus_store=agreeing)
    result, payload = gate.check(_VIDEOS["video_a"], "La Bora", "San Diego")
    check(payload["corroboration"]["status"] == "corroborated",
          "matching signage across independent footage corroborates")
    check(result.status == PASS,
          "corroboration rescues an unclear venue_match")

    # No corpus context: the same unclear analysis stays with a human.
    gate2 = VenueGate(screener=FakeScreener(unclear), catalog=_catalog(),
                      corpus_store=FakeCorpusStore([]))
    result2, _ = gate2.check(_VIDEOS["video_a"], "La Bora", "San Diego")
    check(result2.status == REVIEW,
          "without corroboration, unclear still goes to review")

    # Screening confident, but two corpus videos of this business show
    # entirely different signage and menu.
    confident = dict(unclear, venue_match="confirmed",
                     venue_evidence=["BORA HOUSE neon sign"],
                     detected_items=["burger"])
    disagreeing = FakeCorpusStore([
        corpus_video("yt:2", ["Cauldron Ice Cream"], ["cake pop cone"],
                     business_id="labora"),
        corpus_video("yt:3", ["The Cauldron"], ["ice cream"],
                     business_id="labora")])
    gate3 = VenueGate(screener=FakeScreener(confident), catalog=_catalog(),
                      corpus_store=disagreeing)
    result3, payload3 = gate3.check(_VIDEOS["video_a"], "La Bora", "San Diego")
    check(payload3["corroboration"]["status"] == "contradicted",
          "consistent disagreement is a contradiction")
    check(result3.status == REVIEW,
          "a contradicted approval is downgraded to review")

    # cross_check is also honest about a single-video corpus: one reading
    # is not enough to contradict.
    single = cross_check(confident,
                         [{"canonical_id": "yt:2", "url": "u",
                           "analysis": {"venue_evidence": ["Cauldron"],
                                        "detected_items": []}}])
    check(single["status"] == "neutral",
          "one disagreeing corpus video is neutral, not a contradiction")

    # A rejection is never rescued by corroboration.
    not_food = dict(unclear, is_food_beverage_content=False)
    gate4 = VenueGate(screener=FakeScreener(not_food), catalog=_catalog(),
                      corpus_store=agreeing)
    result4, _ = gate4.check(_VIDEOS["video_a"], "La Bora", "San Diego")
    check(result4.status == REJECT,
          "corroboration never overrides a content rejection")


def test_screening_profile_reaches_screener() -> None:
    print("venue: the screener sees the enriched profile")
    screener = FakeScreener()
    gate = VenueGate(screener=screener, catalog=_catalog())
    gate.check(_VIDEOS["video_a"], "la bora", "North Park, San Diego")
    check(screener.last_business.name == "La Bora",
          "the canonical catalog name is what gets screened against")
    check("salt bread" in screener.last_business.menu_items,
          "with the known menu in the prompt profile")


def main() -> int:
    global _WORKDIR
    with tempfile.TemporaryDirectory() as tmp:
        _WORKDIR = Path(tmp)
        print("building synthetic test videos (ffmpeg lavfi)...")
        build_videos(_WORKDIR)
        for test in (test_dedupe_catches_variants,
                     test_different_videos_stay_distinct,
                     test_flat_videos_cannot_match,
                     test_fingerprint_roundtrip,
                     test_submitter_vs_thief,
                     test_duplicate_attributed_to_earliest,
                     test_theft_against_public_corpus,
                     test_gate_ordering_no_paid_call,
                     test_unreadable_file,
                     test_claim_resolution,
                     test_venue_gate_degrades_without_corpus,
                     test_corroboration,
                     test_screening_profile_reaches_screener):
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
