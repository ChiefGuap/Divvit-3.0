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
    Classification, ClassifierError, LocalClassifier, MAX_DIRECT_FILE_BYTES,
    PegasusClassifier, classify_cascade, classify_from_archetype,
    classify_from_screening)
from services.classify.dataset import (                                 # noqa: E402
    export_training_set, label_corpus, readiness)
from services.classify.pipeline import MediaLabeller                    # noqa: E402
from services.classify.verify import (                                  # noqa: E402
    apply_gold, coverage, load_gold, review_queue, sample_for_review,
    save_gold, score_against_gold, verify_by_agreement)
from services.classify.taxonomy import (                                # noqa: E402
    AESTHETIC, CATEGORIES, MENU_ITEM, MONTAGE, NOT_CAFE, REVIEW, VENUE_VIBE,
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
               twelvelabs_id: str | None = None,
               duration_seconds: float = 45.0, **kwargs) -> DiscoveredVideo:
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
        title=f"video {vid}", duration_seconds=duration_seconds,
        screening=screening, **kwargs)


class FakeTeacher:
    """Stands in for Pegasus. Counts calls so we can assert we didn't overspend."""

    name = "pegasus"

    def __init__(self, category: str = REVIEW, confidence: str = "high",
                 fail: bool = False, available: bool = True,
                 error: str = "boom"):
        self.category = category
        self.confidence = confidence
        self.fail = fail
        self.error = error
        self._available = available
        self.calls = 0
        self.last_usage = {"input_tokens": 6000, "output_tokens": 40}

    def available(self) -> tuple[bool, str]:
        return (True, "fake") if self._available else (False, "no key")

    def classify(self, video):
        self.calls += 1
        if self.fail:
            raise ClassifierError(self.error)
        return Classification(category=self.category, confidence=self.confidence,
                              evidence="fake", source="pegasus")

    def classify_file(self, path):
        self.calls += 1
        if self.fail:
            raise ClassifierError(self.error)
        return Classification(category=self.category, confidence=self.confidence,
                              evidence="fake", source="pegasus-direct")


class FakeConnector:
    """Writes a real file so the labeller's delete step is exercised for real."""

    def __init__(self, fail: bool = False):
        self.fail = fail
        self.downloads = 0

    def download(self, video, media_dir):
        self.downloads += 1
        if self.fail:
            return None
        media_dir = Path(media_dir)
        media_dir.mkdir(parents=True, exist_ok=True)
        path = media_dir / f"{video.platform_video_id}.mp4"
        path.write_bytes(b"\x00" * 2048)
        return path


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


# ------------------------------------------------------------ direct path

def test_direct_guards() -> None:
    """The guards must fire before the request, not after uploading 30MB."""
    print("\ndirect analyze guards")
    teacher = PegasusClassifier(api_key="fake")
    with tempfile.TemporaryDirectory() as tmp:
        missing = Path(tmp) / "nope.mp4"
        try:
            teacher.classify_file(missing)
            check(False, "a missing file is refused")
        except ClassifierError as exc:
            check("no such file" in str(exc), "a missing file is refused")

        empty = Path(tmp) / "empty.mp4"
        empty.write_bytes(b"")
        try:
            teacher.classify_file(empty)
            check(False, "an empty file is refused as broken")
        except ClassifierError as exc:
            check("video_file_broken" in str(exc),
                  "an empty file is refused with a retirable reason")

        big = Path(tmp) / "big.mp4"
        big.write_bytes(b"\x00" * (MAX_DIRECT_FILE_BYTES + 1))
        try:
            teacher.classify_file(big)
            check(False, "an oversize file is refused before encoding")
        except ClassifierError as exc:
            check("ceiling" in str(exc),
                  "an oversize file is refused before encoding it")

    check(PegasusClassifier().direct_model_name == "pegasus1.5",
          "the direct path uses the model that accepts inline sources")


class FakeResponse:
    def __init__(self, payload: dict, status: int = 200):
        self._payload = payload
        self.status_code = status
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


class FakeSession:
    """Injected in place of requests.Session so the parse path is testable."""

    def __init__(self, data: dict, usage: dict | None = None):
        self.data = data
        self.usage = usage or {"input_tokens": 5000, "output_tokens": 40}
        self.last_payload: dict = {}

    def post(self, url, **kwargs):
        self.last_payload = kwargs.get("json") or {}
        return FakeResponse({"data": json.dumps(self.data), "usage": self.usage})


def _classifier_with(data: dict) -> tuple[PegasusClassifier, FakeSession]:
    teacher = PegasusClassifier(api_key="fake")
    session = FakeSession(data)
    teacher._session = session
    return teacher, session


def test_not_cafe() -> None:
    """The corpus contains video that is not about food at all.

    Measured on the live corpus: a man dancing in a living room came back
    `venue_vibe` with HIGH confidence, because a five-way forced choice has
    nowhere else to put it. Those rows would teach the student that venue vibe
    means any interior.
    """
    print("\nnot-cafe rejection")
    teacher, _ = _classifier_with({
        "is_cafe_content": False, "category": VENUE_VIBE, "confidence": "high",
        "runner_up": "", "evidence": "a man dancing in a living room"})
    result = teacher.classify_video_id("tl1")
    check(result.category == NOT_CAFE,
          "non-cafe video is parked outside the taxonomy, not forced into it")
    check(result.category not in CATEGORIES,
          "and therefore excluded from training by every existing gate")
    check("living room" in result.evidence, "the evidence says what it saw")

    teacher, _ = _classifier_with({
        "is_cafe_content": True, "category": VENUE_VIBE, "confidence": "high",
        "runner_up": "", "evidence": "the dining room, mid-service"})
    check(teacher.classify_video_id("tl2").category == VENUE_VIBE,
          "genuine cafe content is unaffected")

    # A model that omits the field must not silently become a rejection.
    teacher, _ = _classifier_with({
        "category": REVIEW, "confidence": "high", "runner_up": "",
        "evidence": "someone reviewing a sandwich"})
    check(teacher.classify_video_id("tl3").category == REVIEW,
          "a missing is_cafe_content is not treated as a rejection")

    with tempfile.TemporaryDirectory() as tmp:
        store = CorpusStore(Path(tmp) / "t.db")
        video = make_video("junk")
        store.upsert(video)
        store.set_fields(video.canonical_id, classification=Classification(
            NOT_CAFE, "high", source="pegasus-direct").to_dict())

        out = Path(tmp) / "train.jsonl"
        result = export_training_set(store, out, include_unindexed=True)
        check(result["rows"] == 0, "a not_cafe row never reaches the training set")
        check(readiness(store, minimum=1,
                        include_unindexed=True)["total_confident"] == 0,
              "nor is it counted as progress toward a fine-tune")
        check(coverage(store)["labelled"] == 0,
              "coverage does not claim it as labelled corpus")


def test_usage_reported() -> None:
    print("\ntoken accounting")
    teacher, _ = _classifier_with({
        "is_cafe_content": True, "category": REVIEW, "confidence": "high",
        "runner_up": "", "evidence": "x"})
    teacher.classify_video_id("tl1")
    check(teacher.last_usage.get("input_tokens") == 5000,
          "token usage is captured so a run can report what it spent")

    teacher, session = _classifier_with({
        "is_cafe_content": True, "category": REVIEW, "confidence": "high",
        "runner_up": "", "evidence": "x"})
    teacher.classify_video_id("tl1")
    check(session.last_payload.get("max_tokens") == 512,
          "max_tokens meets the direct path's documented 512 floor")
    check(session.last_payload.get("temperature") == 0,
          "temperature stays at 0 — labels must be reproducible")


def test_pushable() -> None:
    print("\npushable")
    confident = Classification(REVIEW, "high")
    check(not confident.is_pushable,
          "a confident but unverified label is NOT pushable")
    verified_low = Classification(REVIEW, "low", verified=True)
    check(not verified_low.is_pushable,
          "a verified but low-confidence label is NOT pushable")
    both = Classification(REVIEW, "high", verified=True, verified_by="gold")
    check(both.is_pushable, "confident AND verified is pushable")
    check(Classification.from_dict(both.to_dict()).is_pushable,
          "pushability survives the round trip through the store")


# --------------------------------------------------------------- pipeline

def test_media_pipeline() -> None:
    print("\nmedia pipeline")
    with tempfile.TemporaryDirectory() as tmp:
        store = CorpusStore(Path(tmp) / "t.db")
        media = Path(tmp) / "media"
        store.upsert(make_video("m1"))
        store.upsert(make_video("m2"))

        teacher = FakeTeacher(category=AESTHETIC)
        connector = FakeConnector()
        labeller = MediaLabeller(store, teacher=teacher, connector=connector,
                                 media_dir=media, on_status=lambda _: None)
        report = labeller.run(limit=10)

        check(report.labelled == 2, "unindexed videos get labelled at last")
        check(connector.downloads == 2, "each was downloaded")
        check(report.input_tokens == 12000, "token spend is reported, not hidden")
        check(not list(media.glob("*.mp4")) if media.exists() else True,
              "evaluation copies are deleted after classifying")
        check(all(store.get(f"youtube:m{i}").local_path is None for i in (1, 2)),
              "and the corpus no longer claims to have the file")
        check(store.get("youtube:m1").classification["category"] == AESTHETIC,
              "the label is persisted")

        again = labeller.run(limit=10)
        check(again.attempted == 0, "a second run re-labels nothing")

    print("  (failures)")
    with tempfile.TemporaryDirectory() as tmp:
        store = CorpusStore(Path(tmp) / "t.db")
        store.upsert(make_video("bad"))
        labeller = MediaLabeller(
            store, teacher=FakeTeacher(fail=True, error="video_file_broken: nope"),
            connector=FakeConnector(), media_dir=Path(tmp) / "media",
            on_status=lambda _: None)
        report = labeller.run(limit=5)
        check(report.retired == 1 and report.failed == 0,
              "a permanently broken video is retired, not retried forever")
        check(labeller.candidates(limit=5) == [],
              "and drops out of the candidate pool")

    with tempfile.TemporaryDirectory() as tmp:
        store = CorpusStore(Path(tmp) / "t.db")
        store.upsert(make_video("transient"))
        media = Path(tmp) / "media"
        labeller = MediaLabeller(
            store, teacher=FakeTeacher(fail=True, error="503 upstream"),
            connector=FakeConnector(), media_dir=media, on_status=lambda _: None)
        report = labeller.run(limit=5)
        check(report.failed == 1 and report.retired == 0,
              "a transient failure is not mistaken for a permanent one")
        check(not list(media.glob("*.mp4")) if media.exists() else True,
              "a failed label still deletes the downloaded file")

    with tempfile.TemporaryDirectory() as tmp:
        store = CorpusStore(Path(tmp) / "t.db")
        store.upsert(make_video("tiny", duration_seconds=2.0))
        labeller = MediaLabeller(store, teacher=FakeTeacher(),
                                 connector=FakeConnector(),
                                 media_dir=Path(tmp) / "m",
                                 on_status=lambda _: None)
        check(labeller.candidates(limit=5) == [],
              "a video under the 4s floor is never even fetched")


# ----------------------------------------------------------- verification

def test_gold() -> None:
    print("\ngold")
    with tempfile.TemporaryDirectory() as tmp:
        store = CorpusStore(Path(tmp) / "t.db")

        def add(vid, predicted):
            video = make_video(vid, twelvelabs_id="tl")
            store.upsert(video)
            store.set_fields(video.canonical_id, classification=Classification(
                predicted, "high", source="pegasus").to_dict())
            return video.canonical_id

        right1 = add("g1", REVIEW)
        right2 = add("g2", MONTAGE)
        wrong = add("g3", REVIEW)          # actually aesthetic

        gold = {right1: REVIEW, right2: MONTAGE, wrong: AESTHETIC,
                "youtube:absent": REVIEW}

        report = score_against_gold(store, gold)
        check(report.checked == 3, "only videos present in the corpus are scored")
        check(report.unlabelled == 1, "a gold entry with no prediction is counted")
        check(report.correct == 2 and abs(report.accuracy - 2 / 3) < 1e-9,
              "accuracy is measured against human truth")
        check(report.confusion[AESTHETIC][REVIEW] == 1,
              "the confusion matrix records what it was mistaken for")
        check(report.per_category[REVIEW]["precision"] == 0.5,
              "precision catches a category the model over-predicts")
        check(report.per_category[REVIEW]["recall"] == 1.0,
              "recall is reported separately from precision")
        check(report.mistakes[0]["gold"] == AESTHETIC,
              "every mistake is listed so it can be looked at")

        stats = apply_gold(store, gold)
        check(stats["corrected"] == 1 and stats["confirmed"] == 2,
              "applying gold reports corrections separately from confirmations")
        fixed = Classification.from_dict(store.get(wrong).classification)
        check(fixed.category == AESTHETIC, "human truth overwrites the model")
        check(fixed.verified and fixed.verified_by == "gold",
              "and the label is marked verified")
        check(fixed.is_pushable, "a gold-verified label is pushable")
        check("model said review" in fixed.evidence,
              "the overwritten model answer is kept, so the error can be studied")

        rows = sample_for_review(store, size=3)
        check(len(rows) == 3 and all("gold" in r for r in rows),
              "the review sample has a blank field for a human to fill in")
        check(all(r["url"] for r in rows),
              "and a URL, because a human has to watch the video")

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "gold.json"
        save_gold({"youtube:x": REVIEW, "youtube:y": "nonsense"}, path)
        loaded = load_gold(path)
        check(loaded == {"youtube:x": REVIEW},
              "loading gold drops out-of-vocabulary labels")
        check(load_gold(Path(tmp) / "missing.json") == {},
              "a missing gold file is empty, not an error")


def test_agreement() -> None:
    print("\nagreement")
    with tempfile.TemporaryDirectory() as tmp:
        store = CorpusStore(Path(tmp) / "t.db")

        def add(vid, predicted):
            video = make_video(vid)
            store.upsert(video)
            store.set_fields(video.canonical_id, classification=Classification(
                predicted, "high", source="pegasus-direct").to_dict())

        add("a1", REVIEW)
        add("a2", REVIEW)

        report = verify_by_agreement(
            store, limit=10, second=FakeTeacher(category=REVIEW),
            media_dir=Path(tmp) / "m", connector=FakeConnector(),
            on_status=lambda _: None)
        check(report.agreed == 2 and report.disagreed == 0,
              "a concurring second model confirms the label")
        confirmed = Classification.from_dict(store.get("youtube:a1").classification)
        check(confirmed.verified and confirmed.verified_by == "agreement",
              "and the label records how it was verified")
        check(confirmed.category == REVIEW, "the original label is unchanged")

        rerun = verify_by_agreement(
            store, limit=10, second=FakeTeacher(category=REVIEW),
            media_dir=Path(tmp) / "m", connector=FakeConnector(),
            on_status=lambda _: None)
        check(rerun.checked == 0, "already-verified labels are not re-checked")

    with tempfile.TemporaryDirectory() as tmp:
        store = CorpusStore(Path(tmp) / "t.db")
        video = make_video("d1")
        store.upsert(video)
        store.set_fields(video.canonical_id, classification=Classification(
            REVIEW, "high", source="pegasus-direct").to_dict())

        report = verify_by_agreement(
            store, limit=10, second=FakeTeacher(category=MONTAGE),
            media_dir=Path(tmp) / "m", connector=FakeConnector(),
            on_status=lambda _: None)
        check(report.disagreed == 1, "a dissenting model is recorded")
        disputed = Classification.from_dict(store.get("youtube:d1").classification)
        check(disputed.category == REVIEW,
              "a disputed label keeps its original value — a newer model is "
              "not automatically a righter one")
        check(not disputed.verified, "and stays unverified")
        check(not disputed.is_pushable, "so it is not pushable")
        check(report.conflicts[0]["second"] == MONTAGE,
              "the conflict is queued with both answers")


def test_coverage_and_queue() -> None:
    print("\ncoverage + review queue")
    with tempfile.TemporaryDirectory() as tmp:
        store = CorpusStore(Path(tmp) / "t.db")

        def add(vid, **kw):
            video = make_video(vid)
            store.upsert(video)
            if kw:
                store.set_fields(video.canonical_id,
                                 classification=Classification(**kw).to_dict())

        add("c1", category=REVIEW, confidence="high", verified=True,
            verified_by="gold")
        add("c2", category=MONTAGE, confidence="high")
        add("c3", category=AESTHETIC, confidence="low", runner_up=REVIEW)
        add("c4")                                     # unlabelled

        c = coverage(store)
        check(c["total"] == 4 and c["labelled"] == 3, "coverage counts labelled")
        check(c["verified"] == 1 and c["pushable"] == 1,
              "verified and pushable are reported separately from labelled")
        check(c["by_verification"] == {"gold": 1},
              "and broken down by how they were verified")

        queue = review_queue(store)
        ids = {r["canonical_id"] for r in queue}
        check("youtube:c3" in ids, "an ambiguous label is queued for a human")
        check("youtube:c1" not in ids, "a verified label is not")
        check("youtube:c2" not in ids,
              "nor is a confident unambiguous one — the queue is not everything")
        check(any("close call" in r["why"] for r in queue),
              "the queue says why each row is there")


def main() -> int:
    for test in (test_taxonomy, test_free_relabel, test_confidence_semantics,
                 test_store_roundtrip, test_label_corpus,
                 test_export_and_readiness, test_cascade, test_student_stub,
                 test_direct_guards, test_not_cafe, test_usage_reported,
                 test_pushable, test_media_pipeline,
                 test_gold, test_agreement, test_coverage_and_queue):
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
