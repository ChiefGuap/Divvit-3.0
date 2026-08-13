#!/usr/bin/env bash
# Daily Discover agent entry point.
#
# Wrapped rather than calling python directly from launchd so that the repo
# root, the venv, and the log destination are decided in one place — launchd
# starts with almost no environment and a bare `python` would not resolve.
#
# Install (macOS):
#   cp scripts/com.divvit.discover.plist ~/Library/LaunchAgents/
#   launchctl load ~/Library/LaunchAgents/com.divvit.discover.plist
#
# Or cron:
#   0 7 * * * /path/to/Divvit-3.0/scripts/discover-daily.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

PYTHON="$REPO_ROOT/.venv/bin/python"
CONFIG="${DIVVIT_DISCOVER_CONFIG:-$REPO_ROOT/services/discover/agent_config.json}"
LOG_DIR="$REPO_ROOT/data/logs"
LOG_FILE="$LOG_DIR/discover-$(date -u +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

if [ ! -x "$PYTHON" ]; then
  echo "$(date -u +%FT%TZ) FATAL: no venv at $PYTHON — run: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >> "$LOG_FILE"
  exit 1
fi

if [ ! -f "$CONFIG" ]; then
  echo "$(date -u +%FT%TZ) FATAL: no config at $CONFIG — copy agent_config.example.json" >> "$LOG_FILE"
  exit 1
fi

echo "===== run started $(date -u +%FT%TZ) =====" >> "$LOG_FILE"
# -u keeps the log readable in real time; without it Python buffers stdout
# when it is not a terminal and the log stays empty until the run ends.
"$PYTHON" -u -m services.discover.agent --config "$CONFIG" >> "$LOG_FILE" 2>&1
STATUS=$?
echo "===== run finished $(date -u +%FT%TZ) exit=$STATUS =====" >> "$LOG_FILE"

# Keep 30 days of logs and reports; the SQLite corpus is the durable record.
find "$LOG_DIR" -name 'discover-*.log' -mtime +30 -delete 2>/dev/null
exit $STATUS
