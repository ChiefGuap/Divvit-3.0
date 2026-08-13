"""yt-dlp connector — keyword/hashtag discovery and media retrieval.

This is the workhorse: no API key, and it is the only connector that can hand
us actual bytes, which TwelveLabs needs to index a video.

Platform reality, measured 2026-07-25 against yt-dlp 2026.07.04:
  * youtube   — keyword search and creator Shorts tabs both work. Reliable.
  * tiktok    — creator pages and single videos work with NO authentication.
                Hashtag/keyword search does NOT (fails on request signing:
                "No working app info is available"). Creator harvesting is the
                working surface, and it is the higher-yield one anyway.
  * instagram — nothing works unauthenticated; yt-dlp itself tells you to pass
                cookies. Needs cookies_from_browser and even then Meta breaks
                the extractor often.

At scale the durable path is TikTok's Research API and the Instagram Graph API,
which are keyed integrations with real approval timelines. This connector is
what lets us collect today.
"""

from __future__ import annotations

import contextlib
import io
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

from ..models import Creator, DiscoveredVideo, SourceQuery, VideoMetrics
from .base import ConnectorError

try:
    import yt_dlp
except ImportError:  # pragma: no cover - dependency check surfaces via available()
    yt_dlp = None

# YouTube's own search filters, base64 protobuf in the `sp` query param.
# Plain `ytsearch:` returns mostly 10-30 minute long-form.
YT_SP_SHORT = "EgIYAQ%3D%3D"  # Duration: under 4 minutes

# Measured, because the obvious approach is wrong: YouTube's "under 4 minutes"
# filter EXCLUDES the Shorts shelf. It returns 1-3 minute mini-vlogs — shorter
# long-form, not Shorts. Appending #shorts to a plain keyword search is what
# actually surfaces vertical short-form (durations came back 29s/54s/61s vs
# 68s/103s/156s for the sp filter).
YT_SHORTS_HINT = "#shorts"


def _parse_date(info: dict[str, Any]) -> Optional[str]:
    ts = info.get("timestamp")
    if ts:
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    raw = info.get("upload_date")  # YYYYMMDD
    if raw and len(str(raw)) == 8:
        try:
            return datetime.strptime(str(raw), "%Y%m%d").replace(
                tzinfo=timezone.utc).isoformat()
        except ValueError:
            return None
    return None


class YtDlpConnector:
    name = "ytdlp"
    platforms = ("youtube", "tiktok", "instagram")

    def __init__(
        self,
        cookies_from_browser: Optional[str] = None,
        max_filesize_mb: int = 200,
        quiet: bool = True,
        short_form_only: bool = True,
        medium_form: bool = False,
    ):
        self.cookies_from_browser = cookies_from_browser
        self.max_filesize_mb = max_filesize_mb
        self.quiet = quiet
        self.short_form_only = short_form_only
        self.medium_form = medium_form

    # ------------------------------------------------------------ lifecycle
    def available(self) -> tuple[bool, str]:
        if yt_dlp is None:
            return False, "yt-dlp not installed (pip install yt-dlp)"
        return True, f"yt-dlp {yt_dlp.version.__version__}"

    def _opts(self, **extra: Any) -> dict[str, Any]:
        opts: dict[str, Any] = {
            "quiet": self.quiet,
            "no_warnings": self.quiet,
            "noprogress": True,
            "ignoreerrors": True,       # a dead video must not kill the batch
            "extractor_retries": 2,
            "socket_timeout": 30,
        }
        if self.cookies_from_browser:
            opts["cookiesfrombrowser"] = (self.cookies_from_browser,)
        opts.update(extra)
        return opts

    def _extract(self, target: str, opts: dict[str, Any]) -> Optional[dict[str, Any]]:
        # yt-dlp writes to stdout even when quiet; keep harvest output clean.
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                with yt_dlp.YoutubeDL(opts) as ydl:
                    return ydl.extract_info(target, download=False)
        except Exception as exc:  # yt_dlp raises a wide variety of errors
            raise ConnectorError(f"yt-dlp failed on {target!r}: {exc}") from exc

    # --------------------------------------------------------------- search
    def search(self, query: SourceQuery) -> Iterator[DiscoveredVideo]:
        ok, why = self.available()
        if not ok:
            raise ConnectorError(why)

        platform = query.platform.lower()
        target = self._search_target(platform, query)

        # Flat extraction: one request for the whole result page. We only need
        # enough to decide what is worth a full lookup.
        info = self._extract(target, self._opts(
            extract_flat="in_playlist", playlistend=query.limit))
        if not info:
            return

        for entry in (info.get("entries") or []):
            if not entry:
                continue
            video = self._to_video(entry, platform, query)
            if video:
                yield video

    def _search_target(self, platform: str, query: SourceQuery) -> str:
        if platform == "youtube":
            text = query.text.strip()
            # A handle or URL means "harvest this creator", not "search for
            # this phrase". Their Shorts tab is far higher yield than keyword
            # search: everything on it is already vertical short-form.
            if text.startswith("@") or text.startswith("http"):
                base = text if text.startswith("http") else f"https://www.youtube.com/{text}"
                base = base.rstrip("/")
                if self.short_form_only and not base.endswith("/shorts"):
                    base += "/shorts"
                return base
            if self.short_form_only:
                return f"ytsearch{query.limit}:{text} {YT_SHORTS_HINT}"
            if self.medium_form:
                # Under 4 minutes but not Shorts — kept for the rare case we
                # want mini-vlogs. Not the default.
                q = urllib.parse.quote(text)
                return f"https://www.youtube.com/results?search_query={q}&sp={YT_SP_SHORT}"
            return f"ytsearch{query.limit}:{text}"
        if platform == "tiktok":
            text = query.text.strip()
            if text.startswith("http"):
                return text
            # Creator pages work without authentication. Hashtag pages do not
            # (they fail on request signing, "No working app info is
            # available") — so creator harvesting is the only working TikTok
            # surface, which is also the one we'd prefer regardless.
            if text.startswith("@"):
                return f"https://www.tiktok.com/{text}"
            raise ConnectorError(
                f"TikTok keyword/hashtag search is unavailable ({text!r}); "
                "pass a creator handle like '@thefoodiediaries' instead")
        if platform == "instagram":
            if not self.cookies_from_browser:
                raise ConnectorError(
                    "instagram hashtag pages need a logged-in session; pass "
                    "cookies_from_browser (e.g. 'chrome') or use the Graph API")
            return f"https://www.instagram.com/explore/tags/{self._as_tag(query.text)}/"
        raise ConnectorError(f"{self.name} cannot search platform {platform!r}")

    @staticmethod
    def _as_tag(text: str) -> str:
        """'best cafe #sandiego' -> 'bestcafesandiego' — tag pages take one token."""
        return "".join(ch for ch in text if ch.isalnum())

    # --------------------------------------------------------------- enrich
    def enrich(self, video: DiscoveredVideo) -> DiscoveredVideo:
        """Full per-video extraction: likes, comments, follower count, description.

        Flat search does not return these, and the ROI model needs them.
        """
        info = self._extract(video.url, self._opts())
        if not info:
            return video

        video.title = info.get("title") or video.title
        video.description = info.get("description") or video.description
        video.duration_seconds = info.get("duration") or video.duration_seconds
        video.published_at = _parse_date(info) or video.published_at
        video.thumbnail_url = info.get("thumbnail") or video.thumbnail_url
        video.language = info.get("language") or video.language
        video.width = info.get("width") or video.width
        video.height = info.get("height") or video.height
        video.hashtags = list({*(info.get("tags") or []), *video.hashtags})

        video.metrics = VideoMetrics(
            view_count=info.get("view_count"),
            like_count=info.get("like_count"),
            comment_count=info.get("comment_count"),
            share_count=info.get("repost_count"),
        )
        video.creator = Creator(
            handle=info.get("uploader_id") or video.creator.handle,
            display_name=info.get("uploader") or info.get("channel") or video.creator.display_name,
            platform_id=info.get("channel_id") or info.get("uploader_id") or video.creator.platform_id,
            url=info.get("channel_url") or info.get("uploader_url") or video.creator.url,
            follower_count=info.get("channel_follower_count") or video.creator.follower_count,
        )
        video.derive_hashtags()
        return video

    # ------------------------------------------------------------- download
    def download(self, video: DiscoveredVideo, dest_dir: Path) -> Optional[Path]:
        """Pull the media file for screening.

        Internal eval use only — the caller is responsible for setting
        rights_status and for deleting these files after evaluation. Capped at
        720p/`max_filesize_mb`: TwelveLabs does not need more, and it keeps a
        few hundred harvested clips off the wrong side of a disk quota.
        """
        ok, why = self.available()
        if not ok:
            raise ConnectorError(why)

        dest_dir = Path(dest_dir)
        dest_dir.mkdir(parents=True, exist_ok=True)
        stem = video.canonical_id.replace(":", "_").replace("/", "_")

        # Never hand TwelveLabs a file it will reject: it requires at least
        # 360x360, so prefer a >=360p rendition before falling back.
        opts = self._opts(
            format=("best[height<=720][height>=360][ext=mp4]/"
                    "best[height>=360][ext=mp4]/best[height>=360]/"
                    "best[height<=720][ext=mp4]/best"),
            outtmpl=str(dest_dir / f"{stem}.%(ext)s"),
            max_filesize=self.max_filesize_mb * 1024 * 1024,
            noplaylist=True,
            # Unlike search, a failed download must say why. `ignoreerrors`
            # would turn a transient YouTube hiccup into a silent None and we
            # would have no idea which videos we lost or whether to retry.
            ignoreerrors=False,
        )
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                with yt_dlp.YoutubeDL(opts) as ydl:
                    if ydl.download([video.url]) != 0:
                        return None
        except Exception as exc:
            raise ConnectorError(f"download failed for {video.url}: {exc}") from exc

        matches = sorted(dest_dir.glob(f"{stem}.*"))
        return matches[0] if matches else None

    # ---------------------------------------------------------- normalizing
    def _to_video(self, entry: dict[str, Any], platform: str,
                  query: SourceQuery) -> Optional[DiscoveredVideo]:
        vid = entry.get("id")
        if not vid:
            return None
        url = entry.get("url") or entry.get("webpage_url")
        if not url or not url.startswith("http"):
            url = self._url_for(platform, vid, entry)

        video = DiscoveredVideo(
            platform=platform,
            platform_video_id=str(vid),
            url=url,
            title=entry.get("title") or "",
            description=entry.get("description") or "",
            duration_seconds=entry.get("duration"),
            published_at=_parse_date(entry),
            thumbnail_url=entry.get("thumbnail"),
            connector=self.name,
            intent=query.intent,
            business_id=query.business_id,
            source_query=query.text,
            query_tags=dict(query.tags),
            metrics=VideoMetrics(view_count=entry.get("view_count")),
            creator=Creator(
                handle=entry.get("uploader_id") or "",
                display_name=entry.get("uploader") or entry.get("channel") or "",
                platform_id=entry.get("channel_id") or "",
                url=entry.get("channel_url") or entry.get("uploader_url") or "",
                follower_count=entry.get("channel_follower_count"),
            ),
        )
        video.derive_hashtags()
        return video

    @staticmethod
    def _url_for(platform: str, vid: str, entry: dict[str, Any]) -> str:
        if platform == "youtube":
            return f"https://www.youtube.com/watch?v={vid}"
        if platform == "tiktok":
            handle = (entry.get("uploader_id") or entry.get("uploader") or "").lstrip("@")
            return f"https://www.tiktok.com/@{handle}/video/{vid}"
        if platform == "instagram":
            return f"https://www.instagram.com/reel/{vid}/"
        return vid
