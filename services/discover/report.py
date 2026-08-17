"""XML report artifact for a Discover agent run.

SQLite is the source of truth; this is the daily deliverable — one file per run
that captures what was harvested, what TwelveLabs said about it, and what the
ROI model concluded. XML because it is diffable, self-describing, and something
a non-engineer can open, and because the screening verdicts are naturally
nested (analysis inside verdict inside video).

Reports are immutable once written. To see what changed, diff two days.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from .models import DiscoveredVideo
from .roi import FormatStats, RoiProjection, VideoScores


def _set(el: ET.Element, key: str, value: Any) -> None:
    """Attributes only when we actually have a value — absent means unknown,
    which is different from zero and must stay different in the output."""
    if value is None or value == "":
        return
    if isinstance(value, bool):
        value = "true" if value else "false"  # XML convention, not Python's
    elif isinstance(value, float):
        value = f"{value:.4f}".rstrip("0").rstrip(".")
    el.set(key, str(value))


def _text_child(parent: ET.Element, tag: str, text: Optional[str]) -> None:
    if text:
        ET.SubElement(parent, tag).text = text


def _list_child(parent: ET.Element, wrapper: str, item_tag: str,
                items: Optional[list]) -> None:
    if not items:
        return
    node = ET.SubElement(parent, wrapper)
    for item in items:
        ET.SubElement(node, item_tag).text = str(item)


def video_element(video: DiscoveredVideo,
                  scores: Optional[VideoScores] = None) -> ET.Element:
    el = ET.Element("video")
    _set(el, "canonical-id", video.canonical_id)
    _set(el, "platform", video.platform)
    _set(el, "url", video.url)
    _set(el, "intent", video.intent)
    _set(el, "business-id", video.business_id)
    _set(el, "rights-status", video.rights_status)
    _set(el, "duration-seconds", video.duration_seconds)
    _set(el, "published-at", video.published_at)
    _set(el, "discovered-at", video.discovered_at)
    _set(el, "source-query", video.source_query)

    _text_child(el, "title", video.title)

    creator = ET.SubElement(el, "creator")
    _set(creator, "handle", video.creator.handle)
    _set(creator, "display-name", video.creator.display_name)
    _set(creator, "url", video.creator.url)
    _set(creator, "followers", video.creator.follower_count)

    metrics = ET.SubElement(el, "metrics")
    _set(metrics, "views", video.metrics.view_count)
    _set(metrics, "likes", video.metrics.like_count)
    _set(metrics, "comments", video.metrics.comment_count)
    _set(metrics, "shares", video.metrics.share_count)
    _set(metrics, "collected-at", video.metrics.collected_at)

    if scores:
        sc = ET.SubElement(el, "scores")
        _set(sc, "archetype", scores.archetype)
        _set(sc, "format-score", scores.format_score)
        _set(sc, "audience-leverage", scores.audience_leverage)
        _set(sc, "engagement-rate", scores.engagement_rate)
        _set(sc, "view-velocity", scores.view_velocity)

    _list_child(el, "hashtags", "hashtag", video.hashtags[:20])

    if video.screening:
        el.append(_screening_element(video.screening))
    return el


def _screening_element(screening: dict[str, Any]) -> ET.Element:
    node = ET.Element("screening")
    _set(node, "verdict", screening.get("verdict"))
    _set(node, "mode", screening.get("mode"))
    _set(node, "twelvelabs-video-id", screening.get("video_id"))
    _set(node, "twelvelabs-index-id", screening.get("index_id"))
    _list_child(node, "reasons", "reason", screening.get("reasons"))

    analysis = screening.get("analysis") or {}
    if analysis:
        a = ET.SubElement(node, "analysis")
        _set(a, "food-beverage-content", analysis.get("is_food_beverage_content"))
        _set(a, "content-type", analysis.get("content_type"))
        _set(a, "content-type-confidence", analysis.get("content_type_confidence"))
        _set(a, "venue-match", analysis.get("venue_match"))
        _set(a, "sentiment", analysis.get("sentiment"))
        _text_child(a, "summary", analysis.get("summary"))
        _list_child(a, "venue-evidence", "evidence", analysis.get("venue_evidence"))
        _list_child(a, "detected-items", "item", analysis.get("detected_items"))
        _list_child(a, "quality-flags", "flag", analysis.get("quality_flags"))
    return node


def build_report(
    run_id: str,
    started_at: str,
    finished_at: str,
    config_summary: dict[str, Any],
    harvest_stats: dict[str, Any],
    screening_stats: dict[str, Any],
    videos: list[DiscoveredVideo],
    scores: Optional[dict[str, VideoScores]] = None,
    formats: Optional[list[tuple[FormatStats, RoiProjection]]] = None,
    corpus_counts: Optional[dict[str, Any]] = None,
    errors: Optional[list[str]] = None,
) -> ET.ElementTree:
    root = ET.Element("divvit-discover-run")
    _set(root, "id", run_id)
    _set(root, "started-at", started_at)
    _set(root, "finished-at", finished_at)
    _set(root, "schema-version", "1")

    cfg = ET.SubElement(root, "config")
    for key, value in config_summary.items():
        _set(cfg, key.replace("_", "-"), value)

    h = ET.SubElement(root, "harvest")
    for key, value in harvest_stats.items():
        _set(h, key.replace("_", "-"), value)

    s = ET.SubElement(root, "screening-summary")
    for key, value in screening_stats.items():
        if key == "verdicts":
            continue
        _set(s, key.replace("_", "-"), value)
    for name, count in (screening_stats.get("verdicts") or {}).items():
        v = ET.SubElement(s, "verdict")
        _set(v, "name", name)
        _set(v, "count", count)

    if corpus_counts:
        c = ET.SubElement(root, "corpus")
        _set(c, "total", corpus_counts.get("total"))
        _set(c, "screened", corpus_counts.get("screened"))
        _set(c, "downloaded", corpus_counts.get("downloaded"))
        for group, tag in (("by_platform", "platform"), ("by_intent", "intent"),
                           ("by_rights", "rights")):
            for name, count in (corpus_counts.get(group) or {}).items():
                node = ET.SubElement(c, tag)
                _set(node, "name", name)
                _set(node, "count", count)

    if formats:
        f_root = ET.SubElement(root, "format-roi")
        for stats, projection in formats:
            f = ET.SubElement(f_root, "format")
            _set(f, "archetype", stats.archetype)
            _set(f, "label", stats.label)
            _set(f, "sample-size", stats.sample_size)
            _set(f, "confidence", stats.confidence)
            _set(f, "mean-format-score", stats.mean_format_score)
            _set(f, "median-views", stats.median_views)
            _set(f, "median-leverage", stats.median_leverage)
            _set(f, "median-engagement-rate", stats.median_engagement_rate)
            _set(f, "breakout-rate", stats.breakout_rate)

            p = ET.SubElement(f, "projection")
            _set(p, "videos-planned", projection.videos_planned)
            _set(p, "views-per-video", projection.projected_views_per_video)
            _set(p, "impressions", projection.projected_impressions)
            _set(p, "emv-usd", projection.projected_emv_usd)
            _set(p, "cost-usd", projection.campaign_cost_usd)
            _set(p, "roi-multiple", projection.roi_multiple)
            _set(p, "cost-per-1k-impressions-usd", projection.cost_per_1k_impressions_usd)
            _set(p, "basis", (projection.assumptions or {}).get("basis"))
            # Projections are modeled, not measured. The caveat ships with the
            # data so it cannot get separated from it downstream.
            _text_child(p, "note", (projection.assumptions or {}).get("note"))
            _text_child(f, "brief", projection.brief)

    v_root = ET.SubElement(root, "videos")
    _set(v_root, "count", len(videos))
    for video in videos:
        v_root.append(video_element(video, (scores or {}).get(video.canonical_id)))

    _list_child(root, "errors", "error", (errors or [])[:50])

    ET.indent(root, space="  ")
    return ET.ElementTree(root)


def write_report(tree: ET.ElementTree, path: Path | str) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tree.write(path, encoding="utf-8", xml_declaration=True)
    return path


def default_report_path(report_dir: Path | str, run_id: str) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return Path(report_dir) / f"discover-{stamp}-{run_id}.xml"
