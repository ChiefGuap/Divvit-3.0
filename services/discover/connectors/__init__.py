"""Source connectors for Discover."""

from .base import Connector, ConnectorError
from .ytdlp import YtDlpConnector
from .youtube_api import YouTubeDataConnector

__all__ = ["Connector", "ConnectorError", "YtDlpConnector", "YouTubeDataConnector",
           "build_connector", "CONNECTORS"]

CONNECTORS = {
    "ytdlp": YtDlpConnector,
    "youtube_api": YouTubeDataConnector,
}


def build_connector(name: str, **kwargs) -> Connector:
    if name not in CONNECTORS:
        raise ConnectorError(
            f"unknown connector {name!r}; available: {', '.join(sorted(CONNECTORS))}")
    return CONNECTORS[name](**kwargs)
