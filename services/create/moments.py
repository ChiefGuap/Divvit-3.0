"""Moment selection — find the exact seconds of a clip that fill a slot.

Two tiers, used in order:

  1. **Marengo search** (`/search`): the slot's `moment_query` against the
     indexed clip. Returns ranked start/end spans — verified working on our
     index; results even carry the transcription of the span.
  2. **Heuristic fallback** when a clip was never indexed: take from the front
     of the clip, skipping the first second (phones-lifting-into-position
     footage), clamped to the slot's duration bounds.

The fallback matters because Create must degrade to "rough but working cut"
rather than "error" when TwelveLabs is down or a clip skipped indexing.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import requests

BASE_URL = "https://api.twelvelabs.io/v1.3"


@dataclass
class Moment:
    clip_id: str
    start: float
    end: float
    source: str = "search"     # "search" | "fallback"
    transcription: str = ""

    @property
    def duration(self) -> float:
        return self.end - self.start


class MomentFinder:
    def __init__(self, api_key: str, index_id: Optional[str] = None,
                 timeout: int = 60):
        self.api_key = api_key
        self.index_id = index_id
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({"x-api-key": api_key})

    # ------------------------------------------------------------- search
    def search_moments(self, query: str, video_id: Optional[str] = None,
                       limit: int = 5) -> list[dict[str, Any]]:
        """Ranked spans for a text query. The v1.3 endpoint requires
        multipart/form-data — regular form encoding is rejected."""
        if not self.index_id:
            return []
        form = {
            "index_id": (None, self.index_id),
            "query_text": (None, query),
            "search_options": (None, "visual"),
            "page_limit": (None, str(limit)),
        }
        if video_id:
            form["filter"] = (None, '{"id":["%s"]}' % video_id)
        try:
            resp = self.session.post(f"{BASE_URL}/search", files=form,
                                     timeout=self.timeout)
            if resp.status_code >= 400:
                return []
            return list(resp.json().get("data") or [])
        except requests.RequestException:
            return []

    # --------------------------------------------------------------- pick
    @staticmethod
    def _score(moment: Moment, rank: int, clip, min_seconds: float,
               max_seconds: float, wants_speech: bool) -> float:
        """Rank candidate moments. Higher is better.

        Search rank alone is not enough: the top hit is often a 1.5s sliver, or
        sits in the first second of the clip where the camera is still being
        raised. This trades a little semantic relevance for moments that
        actually cut well.
        """
        score = 100.0 - rank * 8.0

        # Prefer a moment that fills the slot rather than one we have to stretch.
        target = (min_seconds + max_seconds) / 2
        score -= abs(moment.duration - target) * 6.0

        # The first second of UGC is usually the phone coming up; the last
        # second is usually it going down.
        if moment.start < 1.0:
            score -= 12.0
        if clip.duration_seconds and moment.end > clip.duration_seconds - 0.5:
            score -= 8.0

        # Speech matters for review/payoff beats and hurts nothing elsewhere.
        if wants_speech and moment.transcription:
            score += 15.0
        elif wants_speech:
            score -= 10.0

        return score

    def pick(self, clip, query: str, min_seconds: float, max_seconds: float,
             wants_speech: bool = False,
             avoid: Optional[list[tuple[float, float]]] = None) -> Moment:
        """Best moment in `clip` for `query`, honoring duration bounds.

        Scores every candidate the search returns instead of taking the first,
        and skips spans that overlap something already used from this clip so
        two segments never show the same action twice.
        """
        if clip.twelvelabs_video_id:
            hits = self.search_moments(query, video_id=clip.twelvelabs_video_id)
            scored: list[tuple[float, Moment]] = []
            for rank, hit in enumerate(hits):
                moment = self._shape(clip, hit, min_seconds, max_seconds)
                if not moment:
                    continue
                if avoid and any(moment.start < b and a < moment.end
                                 for a, b in avoid):
                    continue
                scored.append((self._score(moment, rank, clip, min_seconds,
                                           max_seconds, wants_speech), moment))
            if scored:
                scored.sort(key=lambda pair: pair[0], reverse=True)
                return scored[0][1]
        return self._fallback(clip, min_seconds, max_seconds)

    def _shape(self, clip, hit: dict[str, Any], min_seconds: float,
               max_seconds: float) -> Optional[Moment]:
        start = float(hit.get("start") or 0.0)
        end = float(hit.get("end") or 0.0)
        if end <= start:
            return None
        # Trim an over-long span from the end (search spans run 6-10s);
        # stretch an under-short one forward if the clip allows.
        if end - start > max_seconds:
            end = start + max_seconds
        if end - start < min_seconds:
            end = start + min_seconds
            if clip.duration_seconds and end > clip.duration_seconds:
                end = clip.duration_seconds
                start = max(0.0, end - min_seconds)
        if end - start < min_seconds * 0.8:  # clip simply too short
            return None
        return Moment(clip_id=clip.clip_id, start=round(start, 2),
                      end=round(end, 2), source="search",
                      transcription=hit.get("transcription") or "")

    @staticmethod
    def _fallback(clip, min_seconds: float, max_seconds: float) -> Moment:
        duration = clip.duration_seconds or max_seconds + 1.0
        start = 1.0 if duration > min_seconds + 1.0 else 0.0
        end = min(start + max_seconds, duration)
        if end - start < min_seconds:
            start, end = 0.0, min(duration, max_seconds)
        return Moment(clip_id=clip.clip_id, start=round(start, 2),
                      end=round(end, 2), source="fallback")
