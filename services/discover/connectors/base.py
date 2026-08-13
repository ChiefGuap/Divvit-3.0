"""Connector interface.

A connector knows how to talk to exactly one source. It owes the rest of the
system three things and nothing else:

    search(query)   -> DiscoveredVideo records (metadata only)
    enrich(video)   -> the same record with full metrics filled in
    download(video) -> a local media file, for screening only

Search is deliberately allowed to be cheap and shallow: most harvested videos
get filtered out on metadata before we ever spend a network round-trip (or a
TwelveLabs indexing minute) on them.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterator, Optional, Protocol, runtime_checkable

from ..models import DiscoveredVideo, SourceQuery


class ConnectorError(RuntimeError):
    """Recoverable connector failure — the harvester logs it and moves on.

    One dead query must never take down a harvest run.
    """


@runtime_checkable
class Connector(Protocol):
    name: str
    platforms: tuple[str, ...]

    def available(self) -> tuple[bool, str]:
        """(usable, human-readable reason). Checked before a run so we fail
        loudly on a missing key instead of silently harvesting nothing."""
        ...

    def search(self, query: SourceQuery) -> Iterator[DiscoveredVideo]:
        ...

    def enrich(self, video: DiscoveredVideo) -> DiscoveredVideo:
        ...

    def download(self, video: DiscoveredVideo, dest_dir: Path) -> Optional[Path]:
        ...
