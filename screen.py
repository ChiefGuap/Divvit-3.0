#!/usr/bin/env python3
"""Divvit Screening CLI.

Examples:
  # Validate the API key
  python screen.py --check

  # Screen a local video for a business
  python screen.py video.mp4 --business "La Bora" --location "North Park, San Diego" \
      --menu "salt bread,matcha latte" --cuisine "Korean cafe"

  # Screen a hosted video by URL
  python screen.py --url https://example.com/clip.mp4 --business "Reborn Coffee"
"""

import argparse
import json
import os
import sys

from screening import BusinessProfile, ScreeningClient, TwelveLabsError


def load_dotenv(path: str = ".env") -> None:
    if not os.path.exists(path):
        return
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def main() -> int:
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

    p = argparse.ArgumentParser(description="Divvit Screening AI (TwelveLabs)")
    p.add_argument("video", nargs="?", help="Path to a local video file")
    p.add_argument("--url", help="URL of a hosted video (instead of a local file)")
    p.add_argument("--business", help="Business name the user submitted this video for")
    p.add_argument("--location", default="", help="Business location")
    p.add_argument("--cuisine", default="", help="Business type/cuisine")
    p.add_argument("--menu", default="", help="Comma-separated known menu items")
    p.add_argument("--visual-cues", default="", help="Comma-separated visual identifiers (logo, cups...)")
    p.add_argument("--index-name", default="divvit-collection")
    p.add_argument("--json-out", help="Write full result JSON to this file")
    p.add_argument("--check", action="store_true", help="Only validate the API key and exit")
    args = p.parse_args()

    try:
        client = ScreeningClient()
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.check:
        try:
            client.validate_key()
            print("API key valid — connected to TwelveLabs v1.3.")
            return 0
        except TwelveLabsError as exc:
            print(f"API key check FAILED: {exc}", file=sys.stderr)
            return 1

    if not args.business or (not args.video and not args.url):
        p.error("Provide a video (path or --url) and --business. Or use --check.")

    business = BusinessProfile(
        name=args.business,
        location=args.location,
        cuisine=args.cuisine,
        menu_items=[m.strip() for m in args.menu.split(",") if m.strip()],
        visual_cues=[c.strip() for c in args.visual_cues.split(",") if c.strip()],
    )

    try:
        result = client.screen_submission(
            business,
            file_path=args.video,
            url=args.url,
            index_name=args.index_name,
        )
    except TwelveLabsError as exc:
        print(f"screening failed: {exc}", file=sys.stderr)
        return 1

    print("\n===== DIVVIT SCREENING RESULT =====")
    print(result.to_json())
    if args.json_out:
        with open(args.json_out, "w") as fh:
            fh.write(result.to_json())
        print(f"\nwrote {args.json_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
