"""Instagram publishing (Reels) via the Meta Graph API.

The end-goal path from the product doc: Create assembles a video, the business
approves it, and it goes out on their own Instagram Business account.

Hard requirements Meta imposes (none of these are ours to relax):
  * An Instagram **Business/Creator** account linked to a Facebook Page.
  * A Meta app with `instagram_content_publish` permission, which means App
    Review before any account other than the app's own testers can use it.
  * The video must be reachable by **public HTTPS URL** — the API pulls the
    file; you cannot POST bytes. So the render has to be uploaded to storage
    (Supabase Storage / S3) first, and `video_url` points there.
  * Flow: create media container -> poll status -> publish container.

Design stance: this module NEVER publishes on its own. `dry_run=True` is the
default and the CLI keeps it that way unless a human passes --live. Posting to
a business's real audience is the single most externally-visible thing this
codebase can do; the agent can prepare everything and must stop there.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Optional

import requests

GRAPH = "https://graph.facebook.com/v21.0"


class PublishError(RuntimeError):
    pass


@dataclass
class PublishResult:
    dry_run: bool
    container_id: Optional[str] = None
    media_id: Optional[str] = None
    detail: str = ""


class InstagramPublisher:
    def __init__(self, access_token: str, ig_user_id: str, timeout: int = 60):
        self.access_token = access_token
        self.ig_user_id = ig_user_id
        self.timeout = timeout
        self.session = requests.Session()

    def _post(self, path: str, **params: Any) -> dict[str, Any]:
        params["access_token"] = self.access_token
        resp = self.session.post(f"{GRAPH}/{path}", data=params, timeout=self.timeout)
        data = resp.json() if resp.content else {}
        if resp.status_code >= 400 or "error" in data:
            raise PublishError(str(data.get("error") or resp.text)[:400])
        return data

    def _get(self, path: str, **params: Any) -> dict[str, Any]:
        params["access_token"] = self.access_token
        resp = self.session.get(f"{GRAPH}/{path}", params=params, timeout=self.timeout)
        data = resp.json() if resp.content else {}
        if resp.status_code >= 400 or "error" in data:
            raise PublishError(str(data.get("error") or resp.text)[:400])
        return data

    # ------------------------------------------------------------ publish
    def publish_reel(self, video_url: str, caption: str,
                     dry_run: bool = True,
                     share_to_feed: bool = True,
                     poll_seconds: int = 10,
                     timeout_seconds: int = 600) -> PublishResult:
        """Container -> poll -> publish. `video_url` must be public HTTPS."""
        if dry_run:
            return PublishResult(
                dry_run=True,
                detail=f"DRY RUN — would publish reel from {video_url} "
                       f"with caption {caption[:80]!r} to IG user {self.ig_user_id}")

        container = self._post(
            f"{self.ig_user_id}/media",
            media_type="REELS",
            video_url=video_url,
            caption=caption,
            share_to_feed="true" if share_to_feed else "false")
        container_id = container["id"]

        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            status = self._get(container_id, fields="status_code")
            code = status.get("status_code")
            if code == "FINISHED":
                break
            if code == "ERROR":
                raise PublishError(f"container {container_id} failed processing")
            time.sleep(poll_seconds)
        else:
            raise PublishError(f"container {container_id} not ready after "
                               f"{timeout_seconds}s")

        published = self._post(f"{self.ig_user_id}/media_publish",
                               creation_id=container_id)
        return PublishResult(dry_run=False, container_id=container_id,
                             media_id=published.get("id"),
                             detail="published")

    def account_check(self) -> dict[str, Any]:
        """Cheap validation that the token and IG user id are usable."""
        return self._get(self.ig_user_id, fields="id,username,followers_count")
