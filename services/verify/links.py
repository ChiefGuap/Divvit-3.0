"""Resolving a pasted post link into something the gates can judge.

## The constraint everything else follows from

Neither platform returns the **video** after posting. TikTok's public oEmbed
gives a cover frame and an embed player; Instagram gives a thumbnail. So a
pasted link can never be re-screened from its media — which is why screening
happens in-app, before the post, on the original file, and why gate 4 compares
the platform's *cover frame* against the fingerprint taken then.

Verified against the live endpoint 2026-09-01:

    oEmbed returns  author_unique_id, title, thumbnail_url, html, embed_product_id
    oEmbed omits    any timestamp whatsoever

That omission is why `snowflake_created_at` exists. TikTok video IDs are
snowflakes: the top 32 bits are Unix seconds. Measured against three posts
whose real publish time we already held, the decode landed **5-7 seconds
early** every time — the ID is minted when the upload starts, the publish time
is when it goes live. Against a 24-hour window that skew does not matter, and
it is the only timestamp a keyless path can produce.

Instagram is deliberately not implemented here. Its pasted link yields no
timestamp and no caption, so it cannot satisfy the window rule at all; the
answer for Instagram is the venue's connected account, not the creator's link.
Pretending otherwise would mean holding every Instagram claim for review and
calling it verification.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional

TIKTOK_OEMBED = "https://www.tiktok.com/oembed"
USER_AGENT = "divvit-verify/1.0"

PLATFORM_TIKTOK = "tiktok"
PLATFORM_INSTAGRAM = "instagram"

# /@handle/video/<id>, with or without query string or trailing slash.
_TIKTOK_FULL = re.compile(
    r"tiktok\.com/@(?P<handle>[\w.\-]+)/video/(?P<id>\d{6,25})", re.I)
# Short share links: vm.tiktok.com/XXXX, vt.tiktok.com/XXXX. These carry no id
# until resolved, so they are recognised but marked as needing a redirect.
_TIKTOK_SHORT = re.compile(r"(?:vm|vt)\.tiktok\.com/(?P<code>[\w]+)", re.I)
_INSTAGRAM = re.compile(
    r"instagram\.com/(?:p|reel|reels)/(?P<code>[\w\-]+)", re.I)


class LinkError(RuntimeError):
    pass


@dataclass
class ResolvedLink:
    """What a pasted URL is, before anything is fetched."""

    platform: str
    video_id: str = ""
    handle: str = ""
    canonical_url: str = ""
    short_code: str = ""            # set when the link must be redirected first
    needs_redirect: bool = False
    supported: bool = True
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def resolve(url: str) -> ResolvedLink:
    """Canonicalize a pasted URL. Never fetches; pure parsing."""
    raw = (url or "").strip()
    if not raw:
        raise LinkError("no link provided")
    if not raw.startswith(("http://", "https://")):
        raw = "https://" + raw

    m = _TIKTOK_FULL.search(raw)
    if m:
        handle, vid = m.group("handle"), m.group("id")
        return ResolvedLink(
            platform=PLATFORM_TIKTOK, video_id=vid, handle=handle.lower(),
            canonical_url=f"https://www.tiktok.com/@{handle}/video/{vid}")

    m = _TIKTOK_SHORT.search(raw)
    if m:
        return ResolvedLink(
            platform=PLATFORM_TIKTOK, short_code=m.group("code"),
            canonical_url=raw, needs_redirect=True,
            note="short share link — must be followed to a /video/<id> URL first")

    m = _INSTAGRAM.search(raw)
    if m:
        return ResolvedLink(
            platform=PLATFORM_INSTAGRAM, video_id=m.group("code"),
            canonical_url=f"https://www.instagram.com/reel/{m.group('code')}/",
            supported=False,
            note=("Instagram pasted links carry no timestamp and no caption, so "
                  "the 24-hour rule cannot be checked. Use the venue's "
                  "connected account instead."))

    raise LinkError("that does not look like a TikTok or Instagram post link")


def snowflake_created_at(video_id: str) -> Optional[datetime]:
    """Publish time decoded from a TikTok video ID.

    The top 32 bits are Unix seconds. Returns None rather than a wrong answer
    when the id is not a plausible snowflake — a bad timestamp silently
    approving a stale post is worse than having none.
    """
    if not video_id or not video_id.isdigit():
        return None
    seconds = int(video_id) >> 32
    # TikTok launched in 2016; anything before that, or in the future, is not a
    # snowflake we decoded correctly.
    if not (1451606400 <= seconds <= int(datetime.now(timezone.utc).timestamp()) + 86400):
        return None
    return datetime.fromtimestamp(seconds, tz=timezone.utc)


@dataclass
class PostMetadata:
    """What the public endpoint actually gave us. Absent stays None."""

    platform: str
    video_id: str = ""
    handle: str = ""
    author_name: str = ""
    caption: Optional[str] = None
    thumbnail_url: Optional[str] = None
    embed_html: Optional[str] = None
    created_at: Optional[str] = None       # ISO-8601 UTC
    created_at_source: str = "none"        # snowflake | api | none
    live: bool = False
    raw: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _http_json(url: str, timeout: int = 25) -> tuple[int, Optional[dict[str, Any]]]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", "replace")
            try:
                return resp.status, json.loads(body)
            except ValueError:
                return resp.status, None
    except urllib.error.HTTPError as exc:
        return exc.code, None


def fetch_tiktok(link: ResolvedLink,
                 fetch: Optional[Callable[[str], tuple[int, Optional[dict]]]] = None
                 ) -> PostMetadata:
    """Public oEmbed. No key, no app review, no rate-limit agreement.

    A 4xx here means the post is not publicly visible — deleted, private, or
    never existed. That is a *reject*, not an outage. A 5xx or a transport
    failure is an outage and must be raised so the caller can retry, because
    rejecting a genuine claim over our own downtime loses the creator for good.
    """
    fetch = fetch or _http_json
    query = urllib.parse.urlencode({"url": link.canonical_url})
    status, payload = fetch(f"{TIKTOK_OEMBED}?{query}")

    if status >= 500:
        raise LinkError(f"tiktok oembed returned {status} — treat as an outage, not a reject")
    if status >= 400 or not payload:
        return PostMetadata(platform=PLATFORM_TIKTOK, video_id=link.video_id,
                            handle=link.handle, live=False)

    created = snowflake_created_at(link.video_id)
    return PostMetadata(
        platform=PLATFORM_TIKTOK,
        video_id=str(payload.get("embed_product_id") or link.video_id),
        handle=str(payload.get("author_unique_id") or link.handle or "").lower(),
        author_name=str(payload.get("author_name") or ""),
        caption=payload.get("title"),
        thumbnail_url=payload.get("thumbnail_url"),
        embed_html=payload.get("html"),
        created_at=created.isoformat() if created else None,
        created_at_source="snowflake" if created else "none",
        live=True,
        raw={k: payload.get(k) for k in
             ("author_url", "thumbnail_width", "thumbnail_height", "provider_name")},
    )


def fetch(link: ResolvedLink, **kwargs: Any) -> PostMetadata:
    """Dispatch by platform. Instagram intentionally returns an unusable result
    rather than a half-answer that would quietly hold every claim."""
    if link.platform == PLATFORM_TIKTOK:
        if link.needs_redirect:
            raise LinkError(
                "short TikTok links must be expanded to a /video/<id> URL first")
        return fetch_tiktok(link, **kwargs)
    return PostMetadata(platform=link.platform, video_id=link.video_id,
                        handle=link.handle, live=False)
