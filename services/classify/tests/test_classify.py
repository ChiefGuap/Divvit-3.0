"""Tests for the classifier's pure logic — no network, no API keys.

Weighted toward the places where being quietly wrong is expensive:

  * a label that does not survive the round trip to the store (the corpus
    silently stays unlabelled and every run re-does the same work)
  * a re-harvest wiping labels we paid an API call for
  * an ambiguous legacy content_type being mapped instead of re-looked-at
  * low-confidence teacher output leaking into the training set

    .venv/bin/python -m services.classify.tests.test_classify
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.classify.classifier import (                              # noqa: E402
    Classification, ClassifierError, LocalClassifier, classify_cascade,
    classify_from_archetype, classify_from_screening)
from services.classify.dataset import (                                 # noqa: E402
    export_training_set, label_corpus, readiness)
from services.classify.taxonomy import (                                # noqa: E402
    AESTHETIC, CATEGORIES, MENU_ITEM, MONTAGE, REVIEW, VENUE_VIBE,
    from_legacy, prompt_block)
from services.discover.models import DiscoveredVideo                    # noqa: E402
from services.discover.store import CorpusStore                         # noqa: E402

_failures: list[str] = []


def check(condition: bool, label: str) -> None:
    if condition:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}")
        _failures.append(label)


def make_video(vid: str = "v1", content_type: str | None = None,
               twelvelabs_id: str | None = None, **kwargs) -> DiscoveredVideo:
    screening = None
    if content_type or twelvelabs_id:
        screening = {"verdict": "approved_for_collection"}
        if twelvelabs_id:
            screening["video_id"] = twelvelabs_id
        if content_type:
            screening["analysis"] = {"content_type": content_type}
    return DiscoveredVideo(
        platform="youtube", platform_video_id=vid,
        url=f"https://www.youtube.com/watch?v={vid}",
        title=f"video {vid}", duration_seconds=45.0,
        screening=screening, **kwargs)


class FakeTeacher:
    """Stands in for Pegasus. Counts calls so we can assert we didn't overspend."""

    name = "pegasus"

    def __init__(self, category: str = REVIEW, confidence: str = "high",
                 fail: bool = False, available: bool = True):
        self.category = category
        self.confidence = confidence
        self.fail = fail
        self._available = available
        self.calls = 0

    def available(self) -> tuple[bool, str]:
        return (True, "fake") if self._available else (False, "no key")

    def classify(self, video):
        self.calls += 1
        if self.fail:
            raise ClassifierError("boom")
        return Classification(category=self.category, confidence=self.confidence,
                              evidence="fake", source="pegasus")


# ---------------------------------------------------------------- taxonomy

def test_taxonomy() -> None:
    print("\ntaxonomy")
    check(from_legacy("interior") == VENUE_VIBE,
          "legacy interior maps to venue_vibe")
    check(from_legacy("event") == VENUE_VIBE, "legacy event maps to venue_vibe")
    check(from_legacy("vlog") is None,
          "ambiguous 'vlog' returns None rather than a lossy guess")
    check(from_legacy("other") is None, "'other' returns None")
    check(from_legacy(None) is None, "missing content_type returns None")

    block = prompt_block()
    check(all(key in block for key in CATEGORIES),
          "prompt block names every category, so prompt can't drift from code")

    check(classify_from_archetype("ranking_list").category == MONTAGE,
          "keyword archetype maps to a category")
    check(classify_from_archetype("ranking_list").confidence == "low",
          "archetype guesses are always low confidence")
    check(classify_from_archetype("nonsense") is None, "unknown archetype -> None")


# -------------------------------------------------------------- free tiers

def test_free_relabel() -> None:
    print("\nfree relabel")
    result = classify_from_screening(
        {"analysis": {"content_type": "menu_item"}})
    check(result is not None and result.category == MENU_ITEM,
          "screened video relabels without an API call")
    check(result.source == "legacy", "source records it came free")

    check(classify_from_screening({"analysis": {"content_type": "vlog"}}) is None,
          "a vlog is not mapped — it needs a fresh look")
    check(classify_from_screening(None) is None, "unscreened video -> None")
    check(classify_from_screening({}) is None, "empty screening blob -> None")


def test_confidence_semantics() -> None:
    print("\nconfidence")
    check(Classification(REVIEW, "high").is_confident, "high is confident")
    check(Classification(REVIEW, "medium").is_confident, "medium is confident")
    check(not Classification(REVIEW, "low").is_confident, "low is not confident")
    check(Classification(REVIEW, "low", runner_up=MONTAGE).is_ambiguous,
          "low confidence with a runner-up is ambiguous")
    check(not Classification(REVIEW, "high", runner_up=MONTAGE).is_ambiguous,
          "a confident answer with a runner-up is not flagged ambiguous")
    check(Classification.from_dict({"category": REVIEW, "junk": 1}).category == REVIEW,
          "from_dict ignores unknown keys instead of raising")


# ------------------------------------------------------------------ store

def test_store_roundtrip() -> None:
    """The bug this file exists for: a label that does not persist.

    `set_fields` filters to known columns, so a missing `classification`
    column made every write a silent no-op — the corpus stayed unlabelled and
    each run paid to classify the same videos again.
    """
    print("\nstore round trip")
    with tempfile.TemporaryDirectory() as tmp:
        store = CorpusStore(Path(tmp) / "t.db")
        video = make_video("s1", content_type="review")
        store.upsert(video)

        result = Classification(REVIEW, "high", evidence="spoken verdict",
                                source="pegasus")
        store.set_fields(video.canonical_id, classification=result.to_dict())

        back = store.get(video.canonical_id)
        check(back.classification is not None, "classification survives the write")
        check(back.classification["category"] == REVIEW, "category round-trips")
        check(back.classification["evidence"] == "spoken verdict",
              "evidence round-trips, so a label can be audited later")

        # A re-harvest returns a freshly-scraped record with no label on it.
        refreshed = make_video("s1", content_type="review")
        store.upsert(refreshed)
        after = store.get(video.canonical_id)
        check(after.classification is not None,
              "re-harvesting preserves a label we paid an API call for")

    print("  (additive migration)")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "old.db"
        store = CorpusStore(path)
        import sqlite3
        conn = sqlite3.connect(path)
        conn.execute("ALTER TABLE discovered_videos DROP COLUMN classification")
        conn.commit()
        conn.close()
        store = CorpusStore(path)          # re-open must add it back
        video = make_video("m1")
        store.upsert(video)
        store.set_fields(video.canonical_id,
                         classification=Classification(AESTHETIC).to_dict())
        check(store.get(video.canonical_id).classification is not None,
              "a corpus predating the column migrates itself on open")


# --------------------------------------------------------------- labelling

def test_label_corpus() -> None:
    print("\nlabel_corpus")
    with tempfile.TemporaryDirectory() as tmp:
        store = CorpusStore(Path(tmp) / "t.db")
        store.upsert(make_video("free1", content_type="review"))
        store.upsert(make_video("free2", content_type="interior"))
        store.upsert(make_video("paid1", content_type="vlog", twelvelabs_id="tl1"))
        store.upsert(make_video("paid2", content_type="other", twelvelabs_id="tl2"))
        store.upsert(make_video("unreachable"))       # not screened, not indexed

        teacher = FakeTeacher(category=MONTAGE)
        report = label_corpus(store, limit=10, teacher=teacher,
                              on_status=lambda _: None)

        check(report.from_screening == 2, "both screened videos relabel for free")
        check(teacher.calls == 2,
              "the teacher is spent only on what the free pass could not resolve")
        check(report.labelled == 4, "four videos end up labelled")
        check(report.by_category.get(MONTAGE) == 2, "teacher labels are recorded")
        check(store.get("youtube:unreachable").classification is None,
              "an unindexed video is left alone rather than guessed at")

        # Second run: everything resolvable is already done, so nothing is spent.
        teacher2 = FakeTeacher()
        again = label_corpus(store, limit=10, teacher=teacher2,
                             on_status=lambda _: None)
        check(teacher2.calls == 0 and again.labelled == 0,
              "re-running spends nothing — labels are not recomputed")

    print("  (limits and failures)")
    with tempfile.TemporaryDirectory() as tmp:
        store = CorpusStore(Path(tmp) / "t.db")
        for i in range(5):
            store.upsert(make_video(f"p{i}", content_type="vlog",
                                    twelvelabs_id=f"tl{i}"))

        teacher = FakeTeacher()
        label_corpus(store, limit=2, teacher=teacher, on_status=lambda _: None)
        check(teacher.calls == 2, "--limit is a hard ceiling on API calls")

    with tempfile.TemporaryDirectory() as tmp:
        store = CorpusStore(Path(tmp) / "t.db")
        store.upsert(make_video("f1", content_type="vlog", twelvelabs_id="tl1"))

        report = label_corpus(store, teacher=FakeTeacher(fail=True),
                              on_status=lambda _: None)
        check(report.failed == 1 and report.labelled == 0,
              "a teacher error is recorded, not raised")

        report = label_corpus(store, teacher=FakeTeacher(available=False),
                              on_status=lambda _: None)
        check(report.errors and "unavailable" in report.errors[0],
              "no API key degrades to a reported skip")

        report = label_corpus(store, teacher=None, on_status=lambda _: None)
        check(report.errors and "no teacher" in report.errors[0],
              "running with no teacher at all says so")


# ------------------------------------------------------------------ export

def test_export_and_readiness() -> None:
    print("\nexport + readiness")
    with tempfile.TemporaryDirectory() as tmp:
        store = CorpusStore(Path(tmp) / "t.db")

        def labelled(vid, category, confidence, tl_id="tl", runner_up=""):
            video = make_video(vid, twelvelabs_id=tl_id)
            store.upsert(video)
            store.set_fields(video.canonical_id, classification=Classification(
                category, confidence, runner_up=runner_up, source="pegasus").to_dict())

        labelled("a", REVIEW, "high")
        labelled("b", REVIEW, "medium")
        labelled("c", MONTAGE, "low", runner_up=REVIEW)
        labelled("d", AESTHETIC, "high", tl_id=None)      # never indexed

        out = Path(tmp) / "train.jsonl"
        result = export_training_set(store, out)
        rows = [json.loads(line) for line in out.read_text().splitlines()]

        check(result["rows"] == 2,
              "low-confidence and unindexed rows are excluded by default")
        check(result["skipped_low_confidence"] == 1, "the low row is counted, not hidden")
        check(all(r["label"] in CATEGORIES for r in rows), "labels are in-vocabulary")
        check(all(r["label_index"] == CATEGORIES.index(r["label"]) for r in rows),
              "label_index matches the taxonomy order the model head will use")
        check(all(r["media_url"].startswith("http") for r in rows),
              "media is a URL, not a local path — harvested footage is rights-gated")

        loose = export_training_set(store, Path(tmp) / "all.jsonl",
                                    confident_only=False, include_unindexed=True)
        check(loose["rows"] == 4, "the loose export includes everything labelled")

        r = readiness(store, minimum=3)
        check(r["total_confident"] == 2,
              "readiness counts what the export would emit, never more")
        check(readiness(store, minimum=3, include_unindexed=True)[
                  "total_confident"] == 3,
              "and matches the looser export when asked for the same thing")
        check(r["categories"][REVIEW]["have"] == 2, "per-category counts are right")
        check(r["categories"][REVIEW]["need"] == 1, "the gap is reported per category")
        check(not r["ready_to_train"],
              "a corpus strong in one category is not ready to train")
        check(r["bottleneck"] in (MONTAGE, AESTHETIC, VENUE_VIBE, MENU_ITEM),
              "the bottleneck is an empty category, not the full one")


# ----------------------------------------------------------------- cascade

def test_cascade() -> None:
    print("\ncascade")
    teacher = FakeTeacher()
    video = make_video("c1", content_type="review")
    result = classify_cascade(video, teacher=teacher)
    check(result.classification.category == REVIEW, "screening resolves it")
    check(not result.spent_api_call and teacher.calls == 0,
          "the free tier short-circuits before any spend")

    teacher = FakeTeacher(category=AESTHETIC)
    video = make_video("c2", content_type="vlog", twelvelabs_id="tl1")
    result = classify_cascade(video, teacher=teacher)
    check(result.spent_api_call and result.classification.category == AESTHETIC,
          "an ambiguous legacy type falls through to the teacher")

    video = make_video("c3", content_type="vlog", twelvelabs_id="tl1")
    result = classify_cascade(video, teacher=FakeTeacher(), allow_api=False)
    check(result.classification is None and not result.spent_api_call,
          "allow_api=False never spends, even with a working teacher")

    video = make_video("c4", roi={"archetype": "ranking_list"})
    result = classify_cascade(video, teacher=None)
    check(result.classification.category == MONTAGE, "archetype is the last resort")
    check(any("not a trustworthy label" in n for n in result.notes),
          "and the result says so, so nothing downstream trusts it")


def test_student_stub() -> None:
    print("\nstudent")
    ok, why = LocalClassifier().available()
    check(not ok and "training set" in why,
          "the untrained student explains itself instead of failing obscurely")
    try:
        LocalClassifier().classify(make_video())
        check(False, "an untrained student refuses to classify")
    except ClassifierError:
        check(True, "an untrained student refuses to classify")


def main() -> int:
    for test in (test_taxonomy, test_free_relabel, test_confidence_semantics,
                 test_store_roundtrip, test_label_corpus,
                 test_export_and_readiness, test_cascade, test_student_stub):
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
