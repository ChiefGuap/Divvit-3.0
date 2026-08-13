"""Divvit Discover daily agent.

One unattended pass: harvest every configured target, score the corpus, push a
budgeted batch through TwelveLabs screening, and write a dated XML report.

Design constraints that shaped this:

* **Idempotent.** Re-running the same day is safe. The store dedupes on
  `platform:video_id`, and already-screened videos are never re-screened (a
  re-screen costs indexed minutes and returns the same answer).
* **Degrades instead of failing.** No TwelveLabs key, or the key stops working,
  and the harvest still runs and still reports — screening is recorded as
  skipped with a reason. An agent that stops collecting because one downstream
  API is down is worse than no agent.
* **Budgeted.** Every run has a hard ceiling on indexed minutes. The batch is
  trimmed to fit rather than refused, so a too-generous config quietly does
  less instead of doing nothing.
* **Bounded blast radius.** One target failing does not stop the others.

    python -m services.discover.agent --config services/discover/agent_config.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.discover.connectors import build_connector                # noqa: E402
from services.discover.harvest import Harvester, HarvestFilters         # noqa: E402
from services.discover.queries import (                                 # noqa: E402
    BusinessTarget, business_queries, category_queries, creator_queries,
    trend_queries)
from services.discover.report import (                                  # noqa: E402
    build_report, default_report_path, write_report)
from services.discover.roi import rank_formats, score_corpus            # noqa: E402
from services.discover.store import CorpusStore                         # noqa: E402

DEFAULT_CONFIG = Path("services/discover/agent_config.json")


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


# ------------------------------------------------------------------- config

@dataclass
class AgentConfig:
    corpus_db: str = "data/discover.db"
    report_dir: str = "data/reports"
    media_dir: str = "data/media"
    connector: str = "ytdlp"
    platforms: list[str] = field(default_factory=lambda: ["youtube"])

    # harvest
    trend_targets: list[dict[str, str]] = field(default_factory=list)
    business_targets: list[dict[str, Any]] = field(default_factory=list)
    # Per-platform, because a YouTube handle is not a TikTok handle. A bare
    # list is still accepted and treated as YouTube.
    creator_handles: dict[str, list[str]] = field(default_factory=dict)
    # Auto-seeding: harvest creators the corpus itself surfaced, not just the
    # handles in this file. This is what stops day 2 from re-running day 1's
    # searches for nothing.
    auto_seed_creators: bool = True
    auto_seed_limit: int = 25
    auto_seed_min_videos: int = 2
    results_per_query: int = 15
    max_queries_per_run: int = 40
    max_age_days: Optional[float] = None
    max_duration_seconds: float = 90.0
    require_vertical: bool = True
    min_views: Optional[int] = None
    pause_seconds: float = 0.4

    # screening
    screening_enabled: bool = True
    videos_per_run: int = 5
    minute_budget: float = 20.0
    index_name: str = "divvit-discover"
    purge_media: bool = True

    # roi assumptions
    roi_videos_planned: int = 10
    roi_reward_cost_usd: float = 15.0
    roi_creator_followers: int = 800
    roi_cpm_usd: float = 12.0

    @staticmethod
    def _normalize_creators(raw: Any) -> dict[str, list[str]]:
        if not raw:
            return {}
        if isinstance(raw, list):
            return {"youtube": [h for h in raw if isinstance(h, str)]}
        return {platform: [h for h in handles if isinstance(h, str)]
                for platform, handles in raw.items()
                if not platform.startswith("_")}

    @classmethod
    def load(cls, path: Path | str) -> "AgentConfig":
        raw = json.loads(Path(path).read_text())
        harvest = raw.get("harvest") or {}
        screening = raw.get("screening") or {}
        roi = raw.get("roi") or {}
        return cls(
            corpus_db=raw.get("corpus_db", cls.corpus_db),
            report_dir=raw.get("report_dir", cls.report_dir),
            media_dir=raw.get("media_dir", cls.media_dir),
            connector=raw.get("connector", cls.connector),
            platforms=raw.get("platforms") or ["youtube"],
            trend_targets=harvest.get("trend") or [],
            business_targets=harvest.get("businesses") or [],
            creator_handles=cls._normalize_creators(harvest.get("creators")),
            auto_seed_creators=harvest.get("auto_seed_creators", True),
            auto_seed_limit=harvest.get("auto_seed_limit", 25),
            auto_seed_min_videos=harvest.get("auto_seed_min_videos", 2),
            results_per_query=harvest.get("results_per_query", cls.results_per_query),
            max_queries_per_run=harvest.get("max_queries_per_run", cls.max_queries_per_run),
            max_age_days=harvest.get("max_age_days"),
            max_duration_seconds=harvest.get("max_duration_seconds", cls.max_duration_seconds),
            require_vertical=harvest.get("require_vertical", True),
            min_views=harvest.get("min_views"),
            pause_seconds=harvest.get("pause_seconds", cls.pause_seconds),
            screening_enabled=screening.get("enabled", True),
            videos_per_run=screening.get("videos_per_run", cls.videos_per_run),
            minute_budget=screening.get("minute_budget", cls.minute_budget),
            index_name=screening.get("index_name", cls.index_name),
            purge_media=screening.get("purge_media", cls.purge_media),
            roi_videos_planned=roi.get("videos_planned", cls.roi_videos_planned),
            roi_reward_cost_usd=roi.get("reward_cost_usd", cls.roi_reward_cost_usd),
            roi_creator_followers=roi.get("creator_followers", cls.roi_creator_followers),
            roi_cpm_usd=roi.get("cpm_usd", cls.roi_cpm_usd),
        )


# -------------------------------------------------------------------- agent

class DiscoverAgent:
    def __init__(self, config: AgentConfig, on_status: Callable[[str], None] = print):
        self.config = config
        self.store = CorpusStore(config.corpus_db)
        self.on_status = on_status
        self.errors: list[str] = []

    def _log(self, message: str) -> None:
        stamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
        self.on_status(f"{stamp} {message}")

    # ------------------------------------------------------------- harvest
    def _build_queries(self) -> list:
        queries = []
        # Creators first — highest yield per query, so they get the budget
        # before keyword search burns it.
        if self.config.auto_seed_creators:
            self.store.refresh_creators()
        for platform in self.config.platforms:
            handles = list(self.config.creator_handles.get(platform) or [])
            if self.config.auto_seed_creators:
                discovered = self.store.top_creators(
                    platform=platform,
                    limit=self.config.auto_seed_limit,
                    min_videos=self.config.auto_seed_min_videos)
                new = [h for h in discovered if h not in handles]
                if new:
                    self._log(f"seeds: +{len(new)} {platform} creators from the corpus")
                handles += new
            if handles:
                queries += creator_queries(handles, [platform],
                                           limit=self.config.results_per_query)
        # Keyword search is YouTube-only — TikTok hashtag search is broken and
        # Instagram needs auth, so pointing trend queries at them just
        # generates guaranteed failures.
        search_platforms = [p for p in self.config.platforms if p == "youtube"]
        for target in self.config.trend_targets:
            queries += trend_queries(
                city=target.get("city", ""), cuisine=target.get("cuisine", ""),
                platforms=search_platforms, limit=self.config.results_per_query,
                archetypes=target.get("archetypes"))
        for target in self.config.business_targets:
            bt = BusinessTarget(
                name=target["name"], business_id=target.get("business_id"),
                city=target.get("city", ""), cuisine=target.get("cuisine", ""),
                competitors=target.get("competitors") or [])
            queries += business_queries(bt, search_platforms,
                                        limit=self.config.results_per_query)
            if bt.competitors:
                queries += category_queries(bt, search_platforms,
                                            limit=self.config.results_per_query)
        return queries[:self.config.max_queries_per_run]

    def harvest(self) -> dict[str, Any]:
        queries = self._build_queries()
        if not queries:
            self._log("harvest: no targets configured, skipping")
            return {"status": "skipped", "reason": "no targets configured"}

        kwargs: dict[str, Any] = {}
        if self.config.connector == "ytdlp":
            kwargs["short_form_only"] = True
        connector = build_connector(self.config.connector, **kwargs)
        ok, why = connector.available()
        if not ok:
            self.errors.append(f"harvest: connector unavailable: {why}")
            self._log(f"harvest: SKIPPED — {why}")
            return {"status": "failed", "reason": why}

        self._log(f"harvest: {len(queries)} queries via {connector.name}")
        harvester = Harvester(
            connector, self.store,
            filters=HarvestFilters(
                max_duration_seconds=self.config.max_duration_seconds,
                min_views=self.config.min_views,
                max_age_days=self.config.max_age_days,
                require_vertical=self.config.require_vertical),
            pause_seconds=self.config.pause_seconds,
            on_status=lambda m: self.on_status(f"  {m}"),
        )
        report = harvester.run(queries)
        self.errors += report.errors[:20]
        self._log(f"harvest: {report.summary()}")
        return {
            "status": "completed",
            "queries_run": report.queries_run,
            "queries_failed": report.queries_failed,
            "found": report.found,
            "new_videos": report.new_rows,
            "filtered_out": report.filtered_out,
            "enriched": report.enriched,
            "duration_seconds": round(report.duration_seconds, 1),
        }

    # ------------------------------------------------------------- screening
    def screen(self) -> dict[str, Any]:
        if not self.config.screening_enabled:
            return {"status": "disabled"}
        if not os.environ.get("TWELVELABS_API_KEY"):
            self._log("screen: SKIPPED — TWELVELABS_API_KEY not set")
            return {"status": "skipped", "reason": "TWELVELABS_API_KEY not set"}

        try:
            from services.discover.screen_bridge import ScreeningBridge, estimate_minutes
            bridge = ScreeningBridge(self.store, media_dir=self.config.media_dir,
                                     index_name=self.config.index_name,
                                     on_status=lambda m: self.on_status(f"  {m}"))
        except Exception as exc:
            self.errors.append(f"screen: bridge unavailable: {exc}")
            self._log(f"screen: SKIPPED — {exc}")
            return {"status": "failed", "reason": str(exc)}

        batch = bridge.select_batch(limit=self.config.videos_per_run)
        if not batch:
            self._log("screen: nothing unscreened")
            return {"status": "completed", "attempted": 0, "screened": 0,
                    "reason": "no unscreened videos"}

        # Trim to the minute budget rather than refusing the batch — a
        # too-generous config should do less, not nothing.
        trimmed, running = [], 0.0
        for video in batch:
            cost = (video.duration_seconds or 60.0) / 60.0
            if running + cost > self.config.minute_budget:
                break
            trimmed.append(video)
            running += cost
        if not trimmed:
            self._log(f"screen: budget {self.config.minute_budget}min too small "
                      f"for the shortest candidate")
            return {"status": "skipped", "reason": "minute budget too small"}

        self._log(f"screen: {len(trimmed)} videos, ~{estimate_minutes(trimmed):.1f} "
                  f"indexed minutes (budget {self.config.minute_budget})")
        try:
            report = bridge.screen_batch(trimmed)
        except Exception as exc:
            self.errors.append(f"screen: {exc}")
            self._log(f"screen: FAILED — {exc}")
            return {"status": "failed", "reason": str(exc)}

        self.errors += report.errors[:20]
        self._log(f"screen: {report.summary()}")

        if self.config.purge_media:
            removed = bridge.purge_media()
            self._log(f"screen: purged {removed} evaluation media files")

        return {
            "status": "completed",
            "attempted": report.attempted,
            "screened": report.screened,
            "failed": report.failed,
            "indexed_minutes": round(report.minutes_indexed, 2),
            "verdicts": report.verdicts,
        }

    # ---------------------------------------------------------------- scores
    def persist_scores(self, videos: list, scores: dict) -> int:
        """Write each video's scores back to the corpus.

        Scores are percentile ranks over the corpus, so they shift as it grows
        — what lands in the DB is this run's snapshot, refreshed every run.
        Persisting them means the dashboard can sort and filter with a plain
        SQL query instead of recomputing the whole cohort on every page load.
        """
        written = 0
        for video in videos:
            score = scores.get(video.canonical_id)
            if not score:
                continue
            self.store.set_fields(video.canonical_id, roi=score.to_dict())
            written += 1
        return written

    # ---------------------------------------------------------------- report
    def build_run_report(self, run_id: str, started_at: str,
                         harvest_stats: dict, screening_stats: dict) -> Path:
        videos = self.store.query()
        scores = score_corpus(videos) if videos else {}
        if scores:
            self._log(f"scores: persisted {self.persist_scores(videos, scores)} rows")
        formats = rank_formats(
            videos, videos_planned=self.config.roi_videos_planned,
            reward_cost_usd=self.config.roi_reward_cost_usd,
            creator_followers=self.config.roi_creator_followers,
            cpm_usd=self.config.roi_cpm_usd) if videos else []

        tree = build_report(
            run_id=run_id,
            started_at=started_at,
            finished_at=datetime.now(timezone.utc).isoformat(),
            config_summary={
                "connector": self.config.connector,
                "platforms": ",".join(self.config.platforms),
                "trend_targets": len(self.config.trend_targets),
                "business_targets": len(self.config.business_targets),
                "index_name": self.config.index_name,
                "roi_cpm_usd": self.config.roi_cpm_usd,
                "roi_creator_followers": self.config.roi_creator_followers,
            },
            harvest_stats=harvest_stats,
            screening_stats=screening_stats,
            videos=videos,
            scores=scores,
            formats=formats,
            corpus_counts=self.store.counts(),
            errors=self.errors,
        )
        path = default_report_path(self.config.report_dir, run_id)
        write_report(tree, path)
        return path

    # ------------------------------------------------------------------ run
    def run_once(self) -> dict[str, Any]:
        run_id = uuid.uuid4().hex[:8]
        started_at = datetime.now(timezone.utc).isoformat()
        self._log(f"=== discover agent run {run_id} ===")

        try:
            harvest_stats = self.harvest()
        except Exception as exc:
            harvest_stats = {"status": "failed", "reason": str(exc)}
            self.errors.append(f"harvest: {exc}\n{traceback.format_exc(limit=3)}")
            self._log(f"harvest: FAILED — {exc}")

        try:
            screening_stats = self.screen()
        except Exception as exc:
            screening_stats = {"status": "failed", "reason": str(exc)}
            self.errors.append(f"screen: {exc}\n{traceback.format_exc(limit=3)}")
            self._log(f"screen: FAILED — {exc}")

        # Re-tally after screening so this run's verdicts feed tomorrow's
        # seeding — and so a creator that keeps getting rejected gets blocked.
        try:
            tallies = self.store.refresh_creators()
            self._log(f"seeds: {tallies['tracked']} creators tracked, "
                      f"{tallies['blocked']} newly blocked")
        except Exception as exc:
            self.errors.append(f"creator refresh: {exc}")

        path = self.build_run_report(run_id, started_at, harvest_stats, screening_stats)
        self._log(f"report: {path}")
        self._log(f"=== run {run_id} done ({len(self.errors)} errors) ===")

        return {"run_id": run_id, "report_path": str(path),
                "harvest": harvest_stats, "screening": screening_stats,
                "errors": len(self.errors)}


# -------------------------------------------------------------------- cli

def main() -> int:
    p = argparse.ArgumentParser(description="Divvit Discover daily agent")
    p.add_argument("--config", default=str(DEFAULT_CONFIG))
    p.add_argument("--no-screen", action="store_true", help="harvest only")
    p.add_argument("--no-harvest", action="store_true", help="screen the existing corpus only")
    p.add_argument("--videos-per-run", type=int, help="override screening batch size")
    p.add_argument("--minute-budget", type=float, help="override indexed-minute ceiling")
    args = p.parse_args()

    load_dotenv(_REPO_ROOT / ".env")

    config_path = Path(args.config)
    if not config_path.exists():
        print(f"error: config not found: {config_path}", file=sys.stderr)
        print("copy services/discover/agent_config.example.json to get started",
              file=sys.stderr)
        return 2

    config = AgentConfig.load(config_path)
    if args.no_screen:
        config.screening_enabled = False
    if args.no_harvest:
        config.trend_targets = []
        config.business_targets = []
    if args.videos_per_run is not None:
        config.videos_per_run = args.videos_per_run
    if args.minute_budget is not None:
        config.minute_budget = args.minute_budget

    result = DiscoverAgent(config).run_once()
    # Non-zero only when the run produced nothing usable; a partial run is a
    # success, because tomorrow's run picks up where this one stopped.
    harvested = result["harvest"].get("status") == "completed"
    screened = result["screening"].get("status") in ("completed", "skipped", "disabled")
    return 0 if (harvested or screened) else 1


if __name__ == "__main__":
    sys.exit(main())
