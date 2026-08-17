"""Divvit Discover — social video harvesting and format ROI analysis.

Pipeline:

    queries.py  -> what to search for (business / trend / category)
    connectors/ -> where to search it (yt-dlp, YouTube Data API)
    harvest.py  -> run it, filter it, dedupe it
    store.py    -> keep it (SQLite corpus)
    roi.py      -> score formats, project campaign ROI
    screen_bridge.py -> hand selected videos to TwelveLabs screening

Entry point: `python -m services.discover.cli --help`
"""

from .models import DiscoveredVideo, SourceQuery, Creator, VideoMetrics
from .queries import BusinessTarget, business_queries, category_queries, trend_queries
from .harvest import Harvester, HarvestFilters, HarvestReport
from .store import CorpusStore
from . import formats, roi

__all__ = [
    "DiscoveredVideo", "SourceQuery", "Creator", "VideoMetrics",
    "BusinessTarget", "business_queries", "category_queries", "trend_queries",
    "Harvester", "HarvestFilters", "HarvestReport", "CorpusStore",
    "formats", "roi",
]
