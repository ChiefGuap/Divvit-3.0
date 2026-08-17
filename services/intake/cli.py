#!/usr/bin/env python3
"""Divvit intake CLI — submission verification from the command line.

    # submit a video claimed to be about a venue
    python -m services.intake.cli submit clip.mp4 --submitter u1 \\
        --business "La Bora" --location "North Park, San Diego"

    # free gates only — what would dedupe/theft say, spending nothing
    python -m services.intake.cli check-dupe clip.mp4

    # what has been submitted, by whom, with what verdicts
    python -m services.intake.cli history
    python -m services.intake.cli history --submitter u1

    # fingerprint Discover's downloaded corpus videos into the theft index
    python -m services.intake.cli index-corpus
    # ...or one known public video by hand
    python -m services.intake.cli index-corpus --file tiktok.mp4 \\
        --url https://tiktok.com/@handle/video/123 --creator @handle

    # store totals
    python -m services.intake.cli stats
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# Allow `python services/intake/cli.py` as well as `-m`.
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.intake.fingerprint import fingerprint_file       # noqa: E402
from services.intake.pipeline import IntakePipeline            # noqa: E402
from services.intake.store import DEFAULT_DB, IntakeStore      # noqa: E402
from services.intake.venue_check import DirectScreener, VenueGate  # noqa: E402


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def _catalog(path: str | None):
    if not path:
        return None
    from services.venues import BusinessCatalog
    return BusinessCatalog.from_json(path)


def _corpus_store(path: str | None):
    if not path:
        return None
    if not Path(path).exists():
        print(f"note: no Discover corpus at {path} — "
              "venue cross-check will run without corpus context",
              file=sys.stderr)
        return None
    from services.discover.store import CorpusStore
    return CorpusStore(path)


def cmd_submit(args) -> int:
    store = IntakeStore(args.db)
    screener = None
    if not args.no_api:
        screener = DirectScreener()
        ok, why = screener.available()
        if not ok:
            print(f"note: {why} — venue gate will route to review unverified",
                  file=sys.stderr)
            screener = None
    pipeline = IntakePipeline(store, VenueGate(
        screener=screener,
        catalog=_catalog(args.catalog),
        corpus_store=_corpus_store(args.corpus_db)),
        # stdout carries the JSON payload; progress goes to stderr so the
        # output stays pipeable.
        on_status=lambda m: print(m, file=sys.stderr))
    outcome = pipeline.submit(args.file, args.submitter,
                              args.business, args.location)
    print(json.dumps(outcome.to_dict(), indent=2))
    return 0 if outcome.verdict != "unscreenable" else 1


def cmd_check_dupe(args) -> int:
    store = IntakeStore(args.db)
    result = IntakePipeline(store).check_dupe(args.file, args.submitter or "")
    print(json.dumps(result, indent=2))
    return 0


def cmd_history(args) -> int:
    store = IntakeStore(args.db)
    rows = store.submissions(submitter_id=args.submitter, limit=args.limit)
    if not rows:
        print("no submissions")
        return 0
    for row in rows:
        reasons = "; ".join(row.get("reasons") or [])
        print(f"{row['created_at']}  {row['submission_id']}  "
              f"{row['submitter_id']:12s} {row['verdict']:24s} "
              f"{row.get('claimed_business') or '':24s} {reasons}")
    return 0


def cmd_stats(args) -> int:
    print(json.dumps(IntakeStore(args.db).counts(), indent=2))
    return 0


def cmd_index_corpus(args) -> int:
    store = IntakeStore(args.db)

    if args.file:
        fp = fingerprint_file(args.file)
        canonical = args.canonical_id or f"manual:{Path(args.file).stem}"
        store.upsert_corpus_fingerprint(
            canonical_id=canonical, fingerprint=fp, platform=args.platform,
            url=args.url, creator_handle=args.creator, title=args.title)
        print(f"indexed {args.file} as {canonical} "
              f"({fp.n_frames} frames, {fp.duration_seconds:.1f}s)")
        return 0

    # Bulk path: every Discover corpus video with media still on disk.
    corpus = _corpus_store(args.corpus_db)
    if corpus is None:
        print("no corpus store and no --file given; nothing to index")
        return 1
    done = skipped = 0
    for video in corpus.query():
        local = video.local_path
        if not local or not Path(local).exists():
            skipped += 1
            continue
        fp = fingerprint_file(local)
        store.upsert_corpus_fingerprint(
            canonical_id=video.canonical_id, fingerprint=fp,
            platform=video.platform, url=video.url,
            creator_handle=video.creator.handle or "",
            title=video.title or "", business_id=video.business_id or "")
        done += 1
        print(f"  {video.canonical_id} ({fp.n_frames} frames)")
    print(f"indexed {done} corpus video(s); {skipped} had no local media "
          "(Discover deletes evaluation copies — index at download time)")
    return 0


def main() -> int:
    load_dotenv(_REPO_ROOT / ".env")

    ap = argparse.ArgumentParser(prog="intake")
    ap.add_argument("--db", default=str(DEFAULT_DB),
                    help=f"intake store (default {DEFAULT_DB})")
    sub = ap.add_subparsers(dest="command", required=True)

    s = sub.add_parser("submit", help="run a submission through every gate")
    s.add_argument("file")
    s.add_argument("--submitter", required=True)
    s.add_argument("--business", required=True,
                   help='claimed business name, e.g. "La Bora"')
    s.add_argument("--location", default="",
                   help='claimed location, e.g. "North Park, San Diego"')
    s.add_argument("--catalog", help="business catalog JSON (optional)")
    s.add_argument("--corpus-db", default="data/discover.db",
                   help="Discover corpus for venue cross-check")
    s.add_argument("--no-api", action="store_true",
                   help="free gates only; venue gate routes to review")
    s.set_defaults(fn=cmd_submit)

    c = sub.add_parser("check-dupe",
                       help="free gates only — never spends an API call")
    c.add_argument("file")
    c.add_argument("--submitter", default="")
    c.set_defaults(fn=cmd_check_dupe)

    h = sub.add_parser("history", help="list submissions")
    h.add_argument("--submitter")
    h.add_argument("--limit", type=int, default=50)
    h.set_defaults(fn=cmd_history)

    st = sub.add_parser("stats", help="store totals")
    st.set_defaults(fn=cmd_stats)

    i = sub.add_parser("index-corpus",
                       help="fingerprint known public videos for the theft gate")
    i.add_argument("--corpus-db", default="data/discover.db")
    i.add_argument("--file", help="index a single file instead of the corpus")
    i.add_argument("--canonical-id")
    i.add_argument("--platform", default="")
    i.add_argument("--url", default="")
    i.add_argument("--creator", default="")
    i.add_argument("--title", default="")
    i.set_defaults(fn=cmd_index_corpus)

    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
