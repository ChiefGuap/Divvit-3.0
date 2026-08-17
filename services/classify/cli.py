#!/usr/bin/env python3
"""Divvit classify CLI — build the labelled set the student model needs.

    # what the five categories are
    python -m services.classify.cli taxonomy

    # what a labelling run would cost, without spending anything
    python -m services.classify.cli label --dry-run

    # the free pass only: relabel everything already screened, no API calls
    python -m services.classify.cli label --no-api

    # spend the teacher on up to 25 indexed videos
    python -m services.classify.cli label --limit 25

    # where the corpus stands, and what it would export
    python -m services.classify.cli readiness
    python -m services.classify.cli export --out data/training/classify.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path

# Allow `python services/classify/cli.py` as well as `-m`.
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.classify.classifier import (                     # noqa: E402
    Classification, PegasusClassifier, classify_from_archetype,
    classify_from_screening)
from services.classify.dataset import (                        # noqa: E402
    MIN_PER_CATEGORY, export_training_set, label_corpus, readiness)
from services.classify.taxonomy import (                       # noqa: E402
    CATEGORIES, TAXONOMY, UNCLASSIFIED)
from services.discover.store import CorpusStore, DEFAULT_DB    # noqa: E402


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def _stored(video) -> Classification | None:
    raw = getattr(video, "classification", None)
    return Classification.from_dict(raw) if raw else None


def _bar(have: int, need: int, width: int = 24) -> str:
    filled = 0 if need <= 0 else min(width, round(width * have / need))
    return "#" * filled + "." * (width - filled)


# --------------------------------------------------------------- commands

def cmd_taxonomy(args) -> int:
    for i, key in enumerate(CATEGORIES, 1):
        c = TAXONOMY[key]
        print(f"\n{i}. {c.label}  ({c.key})")
        print(f"   {c.definition}")
        print(f"   vs neighbour: {c.distinguisher}")
        print(f"   Create uses it as: {c.create_role}")
    print()
    return 0


def cmd_label(args) -> int:
    store = CorpusStore(args.db)

    if args.dry_run:
        return _label_plan(store, args)

    teacher = None if args.no_api else PegasusClassifier()
    if teacher:
        ok, why = teacher.available()
        print(f"[classify] teacher: {'ready' if ok else 'unavailable'} — {why}")

    report = label_corpus(store, limit=args.limit, teacher=teacher,
                          relabel=args.relabel)
    print(f"\n[classify] {report.summary()}")
    for err in report.errors[:10]:
        print(f"    ! {err}")

    if args.json_out:
        Path(args.json_out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json_out).write_text(json.dumps({
            "attempted": report.attempted, "labelled": report.labelled,
            "from_screening": report.from_screening, "from_api": report.from_api,
            "failed": report.failed, "by_category": report.by_category,
            "errors": report.errors,
        }, indent=2))
        print(f"[classify] wrote {args.json_out}")
    return 0


def _label_plan(store: CorpusStore, args) -> int:
    """What a run would do, and what it would cost — without doing it.

    Costs are counted in API calls rather than dollars because TwelveLabs bills
    indexed minutes and these videos are already indexed; the marginal cost of
    a label is one analyze call on footage screening already paid for.
    """
    already = free = paid = unreachable = 0
    free_spread: Counter[str] = Counter()

    for video in store.query():
        if _stored(video) and not args.relabel:
            already += 1
            continue
        from_screening = classify_from_screening(getattr(video, "screening", None))
        if from_screening:
            free += 1
            free_spread[from_screening.category] += 1
        elif (getattr(video, "screening", None) or {}).get("video_id"):
            paid += 1
        else:
            unreachable += 1

    billable = min(paid, args.limit)
    print(f"[plan] already labelled     {already}")
    print(f"[plan] free (from screening) {free}"
          + (f"  -> {dict(free_spread)}" if free_spread else ""))
    print(f"[plan] would cost API calls  {billable}"
          + (f"  (of {paid} eligible, capped by --limit {args.limit})"
             if paid > billable else ""))
    print(f"[plan] not indexed, unreachable by the teacher {unreachable}")
    if unreachable:
        print("\n       Unindexed videos cannot be labelled at any price until they\n"
              "       go through `discover.cli screen`. That is the real bottleneck,\n"
              "       not the classifier.")
    return 0


def cmd_readiness(args) -> int:
    store = CorpusStore(args.db)
    r = readiness(store, minimum=args.minimum,
                  include_unindexed=args.include_unindexed)

    print(f"\nlabelled with confidence: {r['total_confident']}"
          f"   (need {r['minimum_per_category']} per category)\n")
    for key in CATEGORIES:
        c = r["categories"][key]
        mark = "ready" if c["ready"] else f"need {c['need']} more"
        print(f"  {c['label']:<22} {c['have']:>4}  {_bar(c['have'], args.minimum)}  {mark}")

    print()
    if r["ready_to_train"]:
        print("  ready to fine-tune.")
    else:
        print(f"  not ready — bottleneck is {r['bottleneck']}.")

    if args.json_out:
        Path(args.json_out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json_out).write_text(json.dumps(r, indent=2))
        print(f"\n  wrote {args.json_out}")
    return 0


def cmd_export(args) -> int:
    store = CorpusStore(args.db)
    result = export_training_set(
        store, args.out,
        confident_only=not args.all_confidence,
        include_unindexed=args.include_unindexed)
    print(f"[export] {result['rows']} rows -> {result['path']}")
    print(f"[export] by category: {result['by_category'] or 'none'}")
    if result["skipped_low_confidence"]:
        print(f"[export] skipped {result['skipped_low_confidence']} low-confidence "
              "labels (--all-confidence includes them, at the cost of teaching "
              "the student the teacher's guesses)")
    return 0 if result["rows"] else 1


def cmd_stats(args) -> int:
    store = CorpusStore(args.db)
    by_category: Counter[str] = Counter()
    by_source: Counter[str] = Counter()
    by_confidence: Counter[str] = Counter()
    ambiguous = indexed_unlabelled = 0
    total = 0

    for video in store.query():
        total += 1
        result = _stored(video)
        if not result:
            by_category[UNCLASSIFIED] += 1
            if (getattr(video, "screening", None) or {}).get("video_id"):
                indexed_unlabelled += 1
            continue
        by_category[result.category] += 1
        by_source[result.source or "unknown"] += 1
        by_confidence[result.confidence] += 1
        if result.is_ambiguous:
            ambiguous += 1

    print(f"\ncorpus: {total} videos")
    print(f"labelled: {total - by_category[UNCLASSIFIED]}\n")
    for key in CATEGORIES:
        print(f"  {TAXONOMY[key].label:<22} {by_category.get(key, 0):>4}")
    print(f"  {'unclassified':<22} {by_category[UNCLASSIFIED]:>4}"
          f"   ({indexed_unlabelled} of them indexed, so labellable now)")
    print(f"\n  by source     {dict(by_source) or '-'}")
    print(f"  by confidence {dict(by_confidence) or '-'}")
    print(f"  ambiguous     {ambiguous}  (low confidence with a close runner-up)\n")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="classify", description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", default=str(DEFAULT_DB), help="corpus SQLite path")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("taxonomy", help="print the five categories").set_defaults(
        func=cmd_taxonomy)

    p = sub.add_parser("label", help="classify corpus videos and persist labels")
    p.add_argument("--limit", type=int, default=25,
                   help="ceiling on teacher API calls in this run")
    p.add_argument("--relabel", action="store_true",
                   help="re-classify videos that already carry a label")
    p.add_argument("--no-api", action="store_true",
                   help="free pass only — relabel from existing screening")
    p.add_argument("--dry-run", action="store_true",
                   help="report what the run would do and cost, then stop")
    p.add_argument("--json-out")
    p.set_defaults(func=cmd_label)

    p = sub.add_parser("readiness", help="per-category gap to a fine-tune")
    p.add_argument("--minimum", type=int, default=MIN_PER_CATEGORY)
    p.add_argument("--include-unindexed", action="store_true",
                   help="count labels the default export would drop")
    p.add_argument("--json-out")
    p.set_defaults(func=cmd_readiness)

    p = sub.add_parser("export", help="write the training JSONL")
    p.add_argument("--out", default="data/training/classify.jsonl")
    p.add_argument("--all-confidence", action="store_true",
                   help="include low-confidence labels")
    p.add_argument("--include-unindexed", action="store_true")
    p.set_defaults(func=cmd_export)

    sub.add_parser("stats", help="label distribution in the corpus").set_defaults(
        func=cmd_stats)
    return parser


def main(argv: list[str] | None = None) -> int:
    load_dotenv(_REPO_ROOT / ".env")
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
