#!/usr/bin/env python3
"""Direct-path style extraction — learn current editing style with ZERO indexing.

`style.py` reads craft signals off videos that screening already indexed. That
was the right economy when screening was paying for the index anyway, but it
chains style learning to the indexing budget: the July profiles were built from
the 9 videos screening happened to approve, and menu_review's n=7 is what a
513-line module's insight rests on.

This module removes the chain. It reuses the inline-base64 `/analyze` pattern
that `services.classify` proved out (22MB file gate, max_tokens >= 512,
temperature 0): a downloaded file is analyzed directly, billed in tokens, and
never enters an index. The pipeline is

    gate     download -> classify is_cafe_content -> DELETE   (~1 call/video)
    extract  download -> visual call + audio call + ffmpeg    (~2 calls/video)
             scene detection -> DELETE

with the classify service's media hygiene throughout: harvested media exists on
disk only for the seconds a call needs it, and is deleted even when the call
fails. Junk is gated BEFORE style spend — the first harvest corpus measured 75%
non-cafe, and two style calls on a lifestyle vlog is the most expensive way to
learn nothing.

Two focused calls, not one broad one, because that lesson was measured: a
13-field schema misreported audio that a 4-field schema got right. The visual
and audio schemas come verbatim from style.py so profiles stay comparable.

Every response's `usage` field lands in a persistent TokenBudget ledger and the
pipeline stops cleanly at the cap — an unattended run can be trusted with an
API key because its worst case is written down in advance.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import requests

from services.classify.classifier import (
    DIRECT_MODEL, MAX_DIRECT_FILE_BYTES, PegasusClassifier)
from services.classify.taxonomy import CATEGORIES
from services.discover.connectors.base import ConnectorError
from services.discover.connectors.ytdlp import YtDlpConnector
from services.discover.models import RIGHTS_INTERNAL_EVAL
from services.discover.store import CorpusStore, DEFAULT_DB
from services.discover.style import (
    AUDIO_PROMPT, AUDIO_STYLE_SCHEMA, VISUAL_PROMPT, VISUAL_STYLE_SCHEMA,
    StyleError, _salvage_json, build_profile, measure_pacing)

BASE_URL = "https://api.twelvelabs.io/v1.3"

# The direct path bills input tokens linearly in video length. Fitted from
# five live calls on this corpus (2026-08-16): tokens ~= 2100 + 296 x seconds,
# and resolution barely moves it (an 11s clip cost 5.6k at 576p — the same fit
# as the 720p calls). Used only to *predict* whether the next video fits the
# remaining budget; actual spend is recorded from `usage`.
TOKENS_PER_VIDEO_SECOND = 300
CALL_OVERHEAD_TOKENS = 2200

# Style needs two calls, and each call pays for the video again. Long videos
# are the expensive ones, so the pipeline prefers short high-engagement clips —
# more samples per budget, and short-form is the product anyway.
MAX_STYLE_DURATION_SECONDS = 75.0

# Free pre-filter before the paid gate. Food creators post lifestyle content
# too — the first gate batch, picked purely by views, measured 50% non-cafe
# (flower bouquets, swim caps, a Bieber party). A title that names food or a
# venue does not *prove* cafe content (that is what the paid gate is for), but
# ordering the batch by this signal spends the gate calls where they are most
# likely to yield a styleable video. Word list borrowed from the templatizer's
# cuisine vocabulary plus obvious menu words.
FOOD_TITLE_HINTS = (
    "cafe", "café", "coffee", "restaurant", "food", "eat", "menu", "brunch",
    "bakery", "matcha", "pizza", "burger", "taco", "ramen", "sushi", "dessert",
    "chicken", "sandwich", "fries", "noodle", "boba", "latte", "croissant",
    "review", "trying", "tried", "snack", "bbq", "wrap", "bar ", "grill",
    "kebab", "pasta", "steak", "seafood", "crab", "shrimp", "wings", "toast",
    "ice cream", "donut", "bagel", "dumpling", "pho", "curry", "cheese",
)


def _food_titled(video: Any) -> bool:
    text = f"{getattr(video, 'title', '') or ''} " \
           f"{' '.join(getattr(video, 'hashtags', None) or [])}".lower()
    return any(hint in text for hint in FOOD_TITLE_HINTS)

DEFAULT_BUDGET_CAP = 200_000
DEFAULT_LEDGER = Path("data/style_tokens.json")

# Pegasus classification category -> Discover format archetype, for grouping
# styled videos into profiles. The classifier watched the video, so its answer
# beats the keyword fallback in formats.classify(); montage maps to the
# ranking/list archetype because fast multi-subject cutting is that genre's
# defining trait, and menu_item's product-forward close-ups are the raw
# material of menu reviews.
CATEGORY_TO_ARCHETYPE = {
    "review": "menu_review",
    "montage": "ranking_list",
    "aesthetic": "aesthetic",
    "venue_vibe": "cafe_vlog",
    "menu_item": "menu_review",
}


# -------------------------------------------------------------------- budget

class BudgetExhausted(RuntimeError):
    pass


@dataclass
class TokenBudget:
    """Persistent spend ledger with a hard cap.

    Spend is recorded from the `usage` field of every response — the number the
    API says it billed, not our estimate. The estimate exists only to refuse a
    call that would likely blow the cap; a refused call costs nothing, an
    over-cap call cannot be un-spent.
    """

    cap: int = DEFAULT_BUDGET_CAP
    ledger_path: Optional[Path] = None
    spent_input: int = 0
    spent_output: int = 0
    calls: int = 0

    def __post_init__(self) -> None:
        if self.ledger_path:
            self.ledger_path = Path(self.ledger_path)
            if self.ledger_path.exists():
                try:
                    saved = json.loads(self.ledger_path.read_text())
                    self.spent_input = int(saved.get("spent_input", 0))
                    self.spent_output = int(saved.get("spent_output", 0))
                    self.calls = int(saved.get("calls", 0))
                except (ValueError, TypeError):
                    pass  # a corrupt ledger starts over; the cap still holds

    @property
    def remaining(self) -> int:
        return max(0, self.cap - self.spent_input)

    def allows(self, estimated_tokens: int) -> bool:
        return estimated_tokens <= self.remaining

    def record(self, usage: Optional[dict[str, Any]]) -> None:
        usage = usage or {}
        self.spent_input += int(usage.get("input_tokens") or 0)
        self.spent_output += int(usage.get("output_tokens") or 0)
        self.calls += 1
        self._save()

    def _save(self) -> None:
        if not self.ledger_path:
            return
        self.ledger_path.parent.mkdir(parents=True, exist_ok=True)
        self.ledger_path.write_text(json.dumps({
            "cap": self.cap, "spent_input": self.spent_input,
            "spent_output": self.spent_output, "calls": self.calls,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, indent=2))

    def summary(self) -> str:
        return (f"{self.spent_input:,}/{self.cap:,} input tokens spent "
                f"({self.calls} calls, {self.remaining:,} remaining)")


def estimate_call_tokens(duration_seconds: Optional[float]) -> int:
    d = duration_seconds if duration_seconds else 45.0
    return int(d * TOKENS_PER_VIDEO_SECOND) + CALL_OVERHEAD_TOKENS


# ------------------------------------------------------------- direct styler

class DirectStyleExtractor:
    """The split visual/audio style calls, run against a local file.

    Mirrors StyleExtractor.analyze() — same prompts, same schemas, same salvage
    path for runaway-emoji truncation — but sources the video inline instead of
    from an index, and reports usage so the budget can hold.
    """

    def __init__(self, api_key: str, timeout: int = 300,
                 model_name: str = DIRECT_MODEL,
                 session: Optional[Any] = None):
        if not api_key:
            raise StyleError("TWELVELABS_API_KEY is required for style extraction")
        self.model_name = model_name
        self.timeout = timeout
        self.session = session or requests.Session()
        if session is None:
            self.session.headers.update({"x-api-key": api_key})
        self.last_usage: dict[str, Any] = {}

    def _analyze_once(self, encoded: str, prompt: str, schema: dict[str, Any],
                      max_tokens: int) -> dict[str, Any]:
        payload = {
            "model_name": self.model_name,
            "video": {"type": "base64_string", "base64_string": encoded},
            "prompt": prompt,
            "temperature": 0,
            "stream": False,
            # The direct path rejects anything under 512 (measured); the
            # visual schema keeps style.py's larger ceiling for overlay lists.
            "max_tokens": max(max_tokens, 512),
            "response_format": {"type": "json_schema", "json_schema": schema},
        }
        resp = self.session.post(f"{BASE_URL}/analyze", json=payload,
                                 timeout=self.timeout)
        if resp.status_code >= 400:
            raise StyleError(f"analyze -> {resp.status_code}: {resp.text[:300]}")
        body = resp.json() or {}
        self.last_usage = body.get("usage") or {}
        data = body.get("data")
        if data is None:
            raise StyleError(f"analyze returned no data: {str(body)[:200]}")
        if isinstance(data, dict):
            return data
        text = str(data).strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:]
        try:
            return json.loads(text)
        except ValueError:
            salvaged = _salvage_json(text)
            if salvaged is not None:
                return salvaged
            raise StyleError(f"could not parse style JSON: {text[:200]}")

    def analyze_file(self, path: Path | str,
                     budget: Optional[TokenBudget] = None) -> dict[str, Any]:
        """Visual + audio style from a local file. Two calls, audio tolerant.

        Returns the merged style dict; records both calls against `budget`.
        The audio call may fail alone — a record with text and shot data but
        unknown audio still feeds the profile.
        """
        path = Path(path)
        if not path.exists():
            raise StyleError(f"no such file: {path}")
        size = path.stat().st_size
        if size == 0:
            raise StyleError(f"{path.name} is empty (video_file_broken)")
        if size > MAX_DIRECT_FILE_BYTES:
            raise StyleError(
                f"{path.name} is {size / 1e6:.1f}MB — over the "
                f"{MAX_DIRECT_FILE_BYTES / 1e6:.0f}MB direct-analyze ceiling")

        encoded = base64.b64encode(path.read_bytes()).decode()
        try:
            style = self._analyze_once(encoded, VISUAL_PROMPT,
                                       VISUAL_STYLE_SCHEMA, 1500)
        finally:
            if budget is not None:
                budget.record(self.last_usage)
                self.last_usage = {}
        try:
            audio = self._analyze_once(encoded, AUDIO_PROMPT,
                                       AUDIO_STYLE_SCHEMA, 512)
            style.update(audio)
        except StyleError as exc:
            style["audio_error"] = str(exc)[:200]
        finally:
            if budget is not None:
                budget.record(self.last_usage)
                self.last_usage = {}
        style["style_source"] = "pegasus-direct"
        return style


# ----------------------------------------------------------------- pipeline

def is_cafe_genuine(video: Any) -> bool:
    """May style tokens be spent on this video? Only after the junk gate said
    it is cafe content. `not_cafe` and `unclassifiable` sit outside CATEGORIES,
    so they fail this check for free — and so does an unclassified video,
    which is the point: no gate verdict, no style spend."""
    cls = getattr(video, "classification", None) or {}
    return cls.get("category") in CATEGORIES


def archetype_for(video: Any) -> str:
    """Format archetype for profile grouping: the classifier's watched verdict
    first, keyword fallback second."""
    cls = getattr(video, "classification", None) or {}
    mapped = CATEGORY_TO_ARCHETYPE.get(cls.get("category") or "")
    if mapped:
        return mapped
    from services.discover.formats import classify
    return classify(video)


@dataclass
class TrendStyleReport:
    attempted: int = 0
    gated: int = 0            # classify calls that returned a verdict
    junk: int = 0             # verdict: not cafe content
    styled: int = 0
    failed: int = 0
    stopped_for_budget: bool = False
    errors: list[str] = field(default_factory=list)

    @property
    def junk_rate(self) -> Optional[float]:
        return round(self.junk / self.gated, 2) if self.gated else None

    def summary(self) -> str:
        junk = f", junk rate {self.junk_rate:.0%}" if self.gated else ""
        stop = " — STOPPED AT BUDGET CAP" if self.stopped_for_budget else ""
        return (f"gated {self.gated}, junk {self.junk}{junk}; "
                f"styled {self.styled}; failed {self.failed}{stop}")


class TrendStylePipeline:
    """Gate junk first, then spend style tokens only on cafe-genuine videos."""

    def __init__(self, store: CorpusStore, budget: TokenBudget,
                 teacher: Optional[PegasusClassifier] = None,
                 styler: Optional[DirectStyleExtractor] = None,
                 connector: Optional[YtDlpConnector] = None,
                 media_dir: Path | str = Path("data/media"),
                 on_status: Callable[[str], None] = print):
        self.store = store
        self.budget = budget
        self.teacher = teacher
        self.styler = styler
        self.connector = connector or YtDlpConnector()
        self.media_dir = Path(media_dir)
        self.on_status = on_status

    # ------------------------------------------------------------ media I/O
    def _fetch(self, video: Any) -> Path:
        path = Path(video.local_path) if video.local_path else None
        if path and path.exists():
            return path
        path = self.connector.download(video, self.media_dir)
        if not path:
            raise ConnectorError(f"no media retrieved for {video.url}")
        self.store.set_fields(video.canonical_id, local_path=str(path),
                              rights_status=RIGHTS_INTERNAL_EVAL)
        return path

    def _discard(self, video: Any, path: Optional[Path]) -> None:
        """Delete the evaluation copy, success or failure — classify's media
        hygiene, kept to the letter."""
        try:
            if path and path.exists():
                path.unlink()
        except OSError:
            pass
        self.store.set_fields(video.canonical_id, local_path=None)

    # ----------------------------------------------------------------- gate
    def gate_candidates(self, limit: int,
                        max_duration: float = 45.0) -> list[Any]:
        """Short, popular, food-titled videos first.

        Short because the token cost of every later call is linear in
        duration; food-titled because the free keyword signal halves the junk
        rate the paid gate has to eat. Both are orderings over the same pool,
        so nothing is permanently excluded — just deferred behind better bets.
        """
        pool = []
        for video in self.store.query(order_by_views=True):
            if video.classification:
                continue
            d = video.duration_seconds
            if d is not None and (d < 4.0 or d > MAX_STYLE_DURATION_SECONDS):
                continue  # never styleable; skip the gate call too
            pool.append(video)
        pool.sort(key=lambda v: (
            not _food_titled(v),
            (v.duration_seconds or MAX_STYLE_DURATION_SECONDS) > max_duration,
            -(v.metrics.view_count or 0)))
        return pool[:limit]

    def run_gate(self, limit: int = 12) -> TrendStyleReport:
        report = TrendStyleReport()
        if self.teacher is None:
            report.errors.append("no classifier configured")
            return report
        for video in self.gate_candidates(limit):
            estimate = estimate_call_tokens(video.duration_seconds)
            if not self.budget.allows(estimate):
                report.stopped_for_budget = True
                self.on_status(f"[gate] budget stop — {self.budget.summary()}")
                break
            report.attempted += 1
            self.on_status(f"[gate] {(video.title or video.url)[:64]}")
            path = None
            # Cleared before the call so a failure records nothing rather than
            # double-counting the previous call's usage.
            self.teacher.last_usage = {}
            try:
                path = self._fetch(video)
                result = self.teacher.classify_file(path)
            except Exception as exc:
                report.failed += 1
                report.errors.append(f"{video.url}: {exc}")
                self.on_status(f"  ! {str(exc)[:160]}")
                self.budget.record(getattr(self.teacher, "last_usage", None))
                continue
            finally:
                self._discard(video, path)
            self.budget.record(getattr(self.teacher, "last_usage", None))
            self.store.set_fields(video.canonical_id,
                                  classification=result.to_dict())
            report.gated += 1
            if result.category not in CATEGORIES:
                report.junk += 1
            self.on_status(f"  = {result.category} ({result.confidence})  "
                           f"[{self.budget.spent_input:,} tok]")
        return report

    # -------------------------------------------------------------- extract
    def style_candidates(self, limit: int) -> list[Any]:
        """Cafe-genuine, unstyled, short enough to afford — best views first.

        The junk gate is structural here, not advisory: a video without a
        cafe-positive classification cannot enter this list, so style tokens
        cannot be spent on junk no matter how the run is driven.
        """
        pool = []
        for video in self.store.query(order_by_views=True):
            if not is_cafe_genuine(video):
                continue
            if video.style:
                continue
            d = video.duration_seconds
            if d is not None and d > MAX_STYLE_DURATION_SECONDS:
                continue
            pool.append(video)
        # Cheapest first, views as the tiebreak: with a hard token cap the
        # variable that decides profile quality is SAMPLE COUNT, and cost is
        # linear in duration, so short clips are how the budget buys the most
        # evidence. Views still order equals — and every candidate here already
        # cleared a popularity-ordered gate.
        pool.sort(key=lambda v: (
            2 * estimate_call_tokens(v.duration_seconds),
            -(v.metrics.view_count or 0)))
        return pool[:limit]

    def run_extract(self, limit: int = 12) -> TrendStyleReport:
        report = TrendStyleReport()
        if self.styler is None:
            report.errors.append("no style extractor configured")
            return report
        for video in self.style_candidates(limit):
            estimate = 2 * estimate_call_tokens(video.duration_seconds)
            if not self.budget.allows(estimate):
                report.stopped_for_budget = True
                self.on_status(f"[style] budget stop — {self.budget.summary()}")
                break
            report.attempted += 1
            self.on_status(f"[style] {(video.title or video.url)[:64]}")
            path = None
            try:
                path = self._fetch(video)
                # Free and local, so it runs first: if the download is broken,
                # ffprobe fails here before any tokens are spent.
                pacing = measure_pacing(path)
                if not pacing.duration_seconds:
                    raise StyleError("unreadable media (ffprobe found no duration)")
                style = self.styler.analyze_file(path, budget=self.budget)
                style["pacing_measured"] = pacing.to_dict()
            except Exception as exc:
                report.failed += 1
                report.errors.append(f"{video.url}: {exc}")
                self.on_status(f"  ! {str(exc)[:160]}")
                continue
            finally:
                self._discard(video, path)
            self.store.set_fields(video.canonical_id, style=style)
            report.styled += 1
            self.on_status(
                f"  hook={style.get('hook_text') or '(none)'!r} "
                f"audio={style.get('audio_style')} "
                f"cuts={style['pacing_measured'].get('cut_count')} "
                f"[{self.budget.spent_input:,} tok]")
        return report

    # --------------------------------------------------------- pacing only
    def run_pacing_only(self, limit: int = 10) -> TrendStyleReport:
        """Free cut-rhythm measurement for cafe-genuine videos the token
        budget could not stretch to.

        ffmpeg scene detection is local and costs nothing, so a video that
        passed the junk gate but missed the two-call style spend can still
        feed the profile's pacing medians. The stored payload carries ONLY
        `pacing_measured` plus a `style_scope` marker — profile aggregation
        keeps these out of the text/audio statistics so a pacing-only record
        never reads as "a video with no hook".
        """
        report = TrendStyleReport()
        for video in self.store.query(order_by_views=True):
            if report.attempted >= limit:
                break
            if not is_cafe_genuine(video) or video.style:
                continue
            report.attempted += 1
            self.on_status(f"[pacing] {(video.title or video.url)[:64]}")
            path = None
            try:
                path = self._fetch(video)
                pacing = measure_pacing(path)
            except Exception as exc:
                report.failed += 1
                report.errors.append(f"{video.url}: {exc}")
                self.on_status(f"  ! {str(exc)[:160]}")
                continue
            finally:
                self._discard(video, path)
            if not pacing.duration_seconds:
                report.failed += 1
                continue
            self.store.set_fields(video.canonical_id, style={
                "pacing_measured": pacing.to_dict(),
                "style_scope": "pacing_only",
            })
            report.styled += 1
            self.on_status(f"  cuts={pacing.cut_count} "
                           f"shot={pacing.median_shot_seconds}s (0 tokens)")
        return report


# ----------------------------------------------------------------- profiles

# Values that mean "this run did not measure it" (an audio call that failed
# on every sample leaves these empty). A refresh must not overwrite July's
# measured value with this run's nothing. A measured ZERO is not in this
# tuple on purpose: pct_with_text=0.0 from four analyzed videos is a finding
# (nobody used overlays), not a gap, and it must beat a stale 0.71.
_EMPTYABLE = ("", None, [], {})


def merge_profile(old: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    """New measurements win; unmeasured fields keep their old value.

    `sample_size` and `confidence` always come from the new profile — they
    describe this measurement, not the best measurement ever taken.
    """
    merged = dict(old)
    for key, value in new.items():
        if key in ("sample_size", "confidence", "archetype"):
            merged[key] = value
        elif value in _EMPTYABLE and old.get(key) not in _EMPTYABLE:
            continue  # new run didn't measure it; keep the old evidence
        else:
            merged[key] = value
    return merged


def _sanitize_hooks(templates: list[str]) -> list[str]:
    """Force every hook template through templatize + the entity gate.

    The July profiles predate the reusability filter and carry raw hooks like
    "ALOHA POKE & GRILL" — another business's name, verbatim. A refresh is the
    moment old data flows forward, so it is also the moment the current rules
    must apply to it: templatize what can be templatized, reject what still
    names an entity, keep order, drop duplicates.
    """
    from services.discover.style import (
        _PLACEHOLDER, _SAFE_CAPS, _WORD, is_reusable_hook, templatize)

    def first_word_entity(template: str) -> bool:
        # is_reusable_hook exempts the sentence-initial word from the stray
        # proper-noun check ("Best ..." is fine), which lets "Seattleite you
        # should know" through — a city demonym in first position. Here every
        # capitalized word must be accounted for; the render-time
        # _mentions_other_entity guard applies the same standard.
        words = _WORD.findall(_PLACEHOLDER.sub(" ", template))
        return any(w[0].isupper() and len(w) > 2 and w.upper() not in _SAFE_CAPS
                   for w in words)

    out: list[str] = []
    for raw in templates or []:
        template = templatize(str(raw))
        if (is_reusable_hook(template) and not first_word_entity(template)
                and template not in out):
            out.append(template)
    return out


def refresh_profiles(old_profiles: dict[str, dict],
                     new_profiles: dict[str, dict]) -> dict[str, dict]:
    """Merge a fresh profile build over an existing style_profiles.json.

    Archetypes only in the old file are carried forward (a refresh that didn't
    sample a format is not evidence the format changed) — but every profile
    that passes through, carried or merged, gets its hook templates
    re-screened against the entity rule as it stands today.
    """
    out = dict(old_profiles)
    for archetype, profile in new_profiles.items():
        if archetype in out:
            out[archetype] = merge_profile(out[archetype], profile)
        else:
            out[archetype] = dict(profile)
    for archetype, profile in out.items():
        profile = dict(profile)
        profile["hook_templates"] = _sanitize_hooks(profile.get("hook_templates"))
        out[archetype] = profile
    return out


def build_direct_profiles(videos: list) -> dict[str, dict[str, Any]]:
    """Style profiles per archetype from direct-styled videos.

    Groups by the watched classification (archetype_for) rather than title
    keywords, and reuses style.build_profile so the profile shape — and the
    hook templatization + entity rejection inside it — is identical to the
    indexed path.

    Pacing-only records (free ffmpeg measurement, no Pegasus calls) join the
    cut-rhythm medians but are excluded from build_profile itself: counting a
    video we never asked about hooks as "no hook" would bias every text and
    audio statistic downward. `sample_size` stays the fully-analyzed count;
    `pacing_sample_size` reports the wider rhythm sample.
    """
    import statistics as _stats

    grouped: dict[str, list] = {}
    for video in videos:
        if not getattr(video, "style", None):
            continue
        grouped.setdefault(archetype_for(video), []).append(video)

    out: dict[str, dict[str, Any]] = {}
    for archetype, group in grouped.items():
        full = [v for v in group
                if (v.style or {}).get("style_scope") != "pacing_only"]
        profile = build_profile(archetype, full).to_dict()

        paced = [((v.style or {}).get("pacing_measured") or {}) for v in group]
        paced = [p for p in paced if p.get("duration_seconds")]
        if paced:
            def med(key):
                vals = [p[key] for p in paced if p.get(key) is not None]
                return round(_stats.median(vals), 2) if vals else None
            profile["median_cuts"] = med("cut_count")
            profile["median_shot_seconds"] = med("median_shot_seconds")
            profile["median_duration_seconds"] = med("duration_seconds")
        profile["pacing_sample_size"] = len(paced)
        out[archetype] = profile
    return out


# ---------------------------------------------------------------------- cli

def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def _pipeline(args) -> TrendStylePipeline:
    _load_dotenv(_REPO_ROOT / ".env")
    api_key = os.environ.get("TWELVELABS_API_KEY", "")
    budget = TokenBudget(cap=args.budget_cap, ledger_path=Path(args.ledger))
    return TrendStylePipeline(
        store=CorpusStore(args.db),
        budget=budget,
        teacher=PegasusClassifier(api_key=api_key),
        styler=DirectStyleExtractor(api_key),
        media_dir=Path(args.media_dir),
    )


def cmd_gate(args) -> int:
    pipe = _pipeline(args)
    report = pipe.run_gate(limit=args.limit)
    print(f"\n[gate] {report.summary()}")
    print(f"[gate] {pipe.budget.summary()}")
    for err in report.errors[:8]:
        print(f"  ! {err[:180]}")
    return 0


def cmd_extract(args) -> int:
    pipe = _pipeline(args)
    report = pipe.run_extract(limit=args.limit)
    print(f"\n[style] {report.summary()}")
    print(f"[style] {pipe.budget.summary()}")
    for err in report.errors[:8]:
        print(f"  ! {err[:180]}")
    return 0


def cmd_pacing(args) -> int:
    pipe = _pipeline(args)
    report = pipe.run_pacing_only(limit=args.limit)
    print(f"\n[pacing] measured {report.styled}/{report.attempted}, "
          f"failed {report.failed} (0 tokens spent)")
    for err in report.errors[:8]:
        print(f"  ! {err[:180]}")
    return 0


def cmd_profiles(args) -> int:
    store = CorpusStore(args.db)
    new_profiles = build_direct_profiles(store.query())
    if not new_profiles:
        print("no styled videos yet — run gate + extract first")
        return 1

    old_profiles: dict[str, dict] = {}
    if args.baseline and Path(args.baseline).exists():
        old_profiles = json.loads(Path(args.baseline).read_text())
        print(f"[profiles] merging over baseline {args.baseline} "
              f"({len(old_profiles)} archetypes)")
    merged = refresh_profiles(old_profiles, new_profiles)

    for archetype, p in sorted(merged.items(),
                               key=lambda kv: -(kv[1].get("sample_size") or 0)):
        fresh = " (refreshed)" if archetype in new_profiles else " (carried from baseline)"
        print(f"\n{archetype}  n={p.get('sample_size')} "
              f"confidence={p.get('confidence')}{fresh}")
        print(f"  cuts {p.get('median_cuts')}  shot {p.get('median_shot_seconds')}s  "
              f"length {p.get('median_duration_seconds')}s  "
              f"audio {p.get('dominant_audio_style')}")
        for hook in (p.get("hook_templates") or [])[:4]:
            print(f"  hook: {hook!r}")

    if args.json_out:
        out = Path(args.json_out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(merged, indent=2))
        print(f"\nwrote {out}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="divvit-trend-style",
        description="Direct-path (zero-indexing) style learning for Create")
    p.add_argument("--db", default=str(DEFAULT_DB))
    p.add_argument("--budget-cap", type=int, default=DEFAULT_BUDGET_CAP,
                   help="hard cap on TwelveLabs input tokens, all runs combined")
    p.add_argument("--ledger", default=str(DEFAULT_LEDGER),
                   help="persistent token-spend ledger path")
    p.add_argument("--media-dir", default="data/media")
    sub = p.add_subparsers(dest="command", required=True)

    g = sub.add_parser("gate", help="classify is_cafe_content before any style spend")
    g.add_argument("--limit", type=int, default=12)
    g.set_defaults(func=cmd_gate)

    e = sub.add_parser("extract", help="split visual/audio style calls on cafe-genuine videos")
    e.add_argument("--limit", type=int, default=12)
    e.set_defaults(func=cmd_extract)

    pc = sub.add_parser("pacing", help="free ffmpeg cut-rhythm for gated videos the budget missed")
    pc.add_argument("--limit", type=int, default=10)
    pc.set_defaults(func=cmd_pacing)

    pr = sub.add_parser("profiles", help="build + merge style profiles from styled videos")
    pr.add_argument("--baseline", help="existing style_profiles.json to refresh over")
    pr.add_argument("--json-out", help="write merged profiles here")
    pr.set_defaults(func=cmd_profiles)
    return p


def main() -> int:
    args = build_parser().parse_args()
    try:
        return args.func(args)
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
