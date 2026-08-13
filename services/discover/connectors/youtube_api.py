"""YouTube Data API v3 connector.

The compliant, contractual path to YouTube discovery — this is what Discover
should run on in production. It is also strictly better data than scraping:
`videos.list` returns like/comment counts and `channels.list` returns
subscriber counts in bulk, which the ROI model depends on.

Quota (default 10,000 units/day):
    search.list    100 units   <- the expensive one, 1 per query
    videos.list      1 unit    <- batched 50 at a time
    channels.list    1 unit    <- batched 50 at a time

That is ~95 keyword searches/day, or ~4,750 fully-enriched videos. Budget
queries accordingly; `estimate_quota()` prices a plan before we spend it.

Set YOUTUBE_API_KEY. Media download is not part of this API — pair with the
yt-dlp connector when the screening pipeline needs actual bytes.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Iterator, Optional

import requests

from ..models import Creator, DiscoveredVideo, SourceQuery, VideoMetrics
from .base import ConnectorError

API_ROOT = "https://www.googleapis.com/youtube/v3"

# Quota costs, for estimate_quota()
COST_SEARCH = 100
COST_LIST = 1

ISO_DURATION = re.compile(
    r"P(?:(?P<days>\d+)D)?T(?:(?P<h>\d+)H)?(?:(?P<m>\d+)M)?(?:(?P<s>\d+)S)?")


def _duration_seconds(iso: str) -> Optional[float]:
    if not iso:
        return None
    m = ISO_DURATION.match(iso)
    if not m:
        return None
    p = {k: int(v) if v else 0 for k, v in m.groupdict().items()}
    return float(p["days"] * 86400 + p["h"] * 3600 + p["m"] * 60 + p["s"])


def _chunks(items: list[Any], size: int) -> Iterator[list[Any]]:
    for i in range(0, len(items), size):
        yield items[i:i + size]


class YouTubeDataConnector:
    name = "youtube_api"
    platforms = ("youtube",)

    def __init__(self, api_key: Optional[str] = None, region_code: str = "US",
                 relevance_language: str = "en"):
        self.api_key = api_key or os.environ.get("YOUTUBE_API_KEY", "")
        self.region_code = region_code
        self.relevance_language = relevance_language
        self.session = requests.Session()
        self.quota_spent = 0

    # ------------------------------------------------------------ lifecycle
    def available(self) -> tuple[bool, str]:
        if not self.api_key:
            return False, "YOUTUBE_API_KEY not set"
        return True, "youtube data api v3"

    @staticmethod
    def estimate_quota(num_queries: int, results_per_query: int) -> int:
        """Price a harvest plan before running it."""
        videos = num_queries * results_per_query
        batches = -(-videos // 50)  # ceil
        return num_queries * COST_SEARCH + batches * COST_LIST * 2

    def _get(self, endpoint: str, params: dict[str, Any], cost: int) -> dict[str, Any]:
        params = {**params, "key": self.api_key}
        try:
            resp = self.session.get(f"{API_ROOT}/{endpoint}", params=params, timeout=30)
        except requests.RequestException as exc:
            raise ConnectorError(f"youtube {endpoint} request failed: {exc}") from exc
        self.quota_spent += cost
        if resp.status_code == 403 and "quota" in resp.text.lower():
            raise ConnectorError(
                f"YouTube API quota exhausted (spent ~{self.quota_spent} units this run). "
                "Resets at midnight Pacific.")
        if resp.status_code >= 400:
            raise ConnectorError(f"youtube {endpoint} -> {resp.status_code}: {resp.text[:300]}")
        return resp.json()

    # --------------------------------------------------------------- search
    def search(self, query: SourceQuery, published_after: Optional[str] = None,
               order: str = "relevance", short_form_only: bool = True
               ) -> Iterator[DiscoveredVideo]:
        """One search.list call, then bulk-enrich the whole page in two more.

        Enriching inline is what makes this connector worth its quota: the
        caller gets fully-populated records without an N+1 of per-video calls.
        """
        ok, why = self.available()
        if not ok:
            raise ConnectorError(why)

        params: dict[str, Any] = {
            "part": "snippet",
            "q": query.text,
            "type": "video",
            "maxResults": min(query.limit, 50),
            "order": order,
            "regionCode": self.region_code,
            "relevanceLanguage": self.relevance_language,
            "safeSearch": "moderate",
        }
        if short_form_only:
            params["videoDuration"] = "short"  # < 4 min; Shorts and clips
        if published_after:
            params["publishedAfter"] = published_after

        data = self._get("search", params, COST_SEARCH)
        items = data.get("items") or []
        if not items:
            return

        ids = [i["id"]["videoId"] for i in items if i.get("id", {}).get("videoId")]
        details = self._videos_details(ids)
        channel_ids = [d["snippet"]["channelId"] for d in details.values()
                       if d.get("snippet", {}).get("channelId")]
        followers = self._channel_followers(list(set(channel_ids)))

        for vid in ids:
            detail = details.get(vid)
            if not detail:
                continue
            yield self._to_video(vid, detail, followers, query)

    def _videos_details(self, ids: list[str]) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        for batch in _chunks(ids, 50):
            data = self._get("videos", {
                "part": "snippet,statistics,contentDetails",
                "id": ",".join(batch),
            }, COST_LIST)
            for item in data.get("items") or []:
                out[item["id"]] = item
        return out

    def _channel_followers(self, channel_ids: list[str]) -> dict[str, Optional[int]]:
        out: dict[str, Optional[int]] = {}
        for batch in _chunks(channel_ids, 50):
            data = self._get("channels", {
                "part": "statistics", "id": ",".join(batch),
            }, COST_LIST)
            for item in data.get("items") or []:
                raw = (item.get("statistics") or {}).get("subscriberCount")
                out[item["id"]] = int(raw) if raw is not None else None
        return out

    # --------------------------------------------------------------- enrich
    def enrich(self, video: DiscoveredVideo) -> DiscoveredVideo:
        """Refresh metrics on an existing record — cheap (1 unit per 50)."""
        details = self._videos_details([video.platform_video_id])
        detail = details.get(video.platform_video_id)
        if not detail:
            return video
        channel_id = (detail.get("snippet") or {}).get("channelId")
        followers = self._channel_followers([channel_id]) if channel_id else {}
        refreshed = self._to_video(
            video.platform_video_id, detail, followers,
            SourceQuery(text=video.source_query, intent=video.intent,
                        business_id=video.business_id))
        # keep provenance from the original discovery
        refreshed.discovered_at = video.discovered_at
        refreshed.connector = video.connector or self.name
        refreshed.query_tags = video.query_tags
        refreshed.rights_status = video.rights_status
        refreshed.local_path = video.local_path
        refreshed.screening = video.screening
        return refreshed

    def download(self, video: DiscoveredVideo, dest_dir: Path) -> Optional[Path]:
        raise ConnectorError(
            "the YouTube Data API does not serve media; use the ytdlp connector "
            "to fetch bytes for screening")

    # ---------------------------------------------------------- normalizing
    def _to_video(self, vid: str, detail: dict[str, Any],
                  followers: dict[str, Optional[int]],
                  query: SourceQuery) -> DiscoveredVideo:
        snippet = detail.get("snippet") or {}
        stats = detail.get("statistics") or {}
        content = detail.get("contentDetails") or {}

        def _int(key: str) -> Optional[int]:
            raw = stats.get(key)
            return int(raw) if raw is not None else None

        channel_id = snippet.get("channelId") or ""
        video = DiscoveredVideo(
            platform="youtube",
            platform_video_id=vid,
            url=f"https://www.youtube.com/watch?v={vid}",
            title=snippet.get("title") or "",
            description=snippet.get("description") or "",
            hashtags=list(snippet.get("tags") or []),
            duration_seconds=_duration_seconds(content.get("duration") or ""),
            published_at=snippet.get("publishedAt"),
            thumbnail_url=((snippet.get("thumbnails") or {}).get("high") or {}).get("url"),
            language=snippet.get("defaultAudioLanguage") or snippet.get("defaultLanguage"),
            connector=self.name,
            intent=query.intent,
            business_id=query.business_id,
            source_query=query.text,
            query_tags=dict(query.tags),
            metrics=VideoMetrics(
                view_count=_int("viewCount"),
                like_count=_int("likeCount"),
                comment_count=_int("commentCount"),
            ),
            creator=Creator(
                handle=snippet.get("channelTitle") or "",
                display_name=snippet.get("channelTitle") or "",
                platform_id=channel_id,
                url=f"https://www.youtube.com/channel/{channel_id}" if channel_id else "",
                follower_count=followers.get(channel_id),
            ),
        )
        video.derive_hashtags()
        return video
