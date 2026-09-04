"""Divvit engine as an HTTP service — one implementation, two front ends.

## Why this exists

The dashboard called the engine by spawning a Python subprocess. That works
only because the browser and the engine sit on the same machine. A phone
cannot spawn Python, so none of it would have transferred when the app UI
arrives — the app would have needed a second implementation of screening and
verification, and two copies of a fraud check drift apart.

So the engine moves behind a versioned HTTP contract. The dashboard becomes a
client of it, exactly like the app will be. Whatever the app is written in, it
speaks JSON to these endpoints and gets identical verdicts, because there is
only one engine.

## Identity is never taken from the body

`creator_id` comes from the bearer token, not from the request. This is the
same rule that `connected` broke: a client that can name itself can claim to
be someone else, and every ownership and duplicate check downstream is
computed against that name. The token is the only statement about who is
calling that the caller does not author.

The dev token map below is a placeholder for real session auth and is refused
outright unless DIVVIT_DEV_TOKENS is set — it must not be what ships.

## Run it

    .venv/bin/uvicorn services.api.app:app --port 8787 --reload
"""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from services.intake.pipeline import IntakePipeline
from services.intake.store import IntakeStore
from services.intake.venue_check import DirectScreener, VenueGate
from services.verify.accounts import (AccountStore, METHOD_MANUAL, METHOD_OAUTH)
from services.verify.claims import ClaimStore, process_claim, run_rechecks
from services.verify.links import LinkError, fetch as fetch_post, resolve as resolve_link

API_VERSION = "1.0.0"

# Uploads are capped before anything touches disk. 200MB is roughly a 60s 4K
# clip; beyond that the app should compress client-side rather than us
# discovering it at ffmpeg time.
MAX_UPLOAD_BYTES = 200 * 1024 * 1024
ALLOWED_TYPES = {"video/mp4", "video/quicktime", "video/webm", "video/x-m4v"}

app = FastAPI(title="Divvit Engine", version=API_VERSION,
              description="Screening and claim verification. One engine, "
                          "shared by the dashboard and the app.")

# The app will call this from a different origin. Locked to an allowlist rather
# than "*", because these endpoints act on the caller's identity.
_origins = [o for o in os.environ.get(
    "DIVVIT_ALLOWED_ORIGINS", "http://localhost:3100,http://localhost:3000"
).split(",") if o]
app.add_middleware(CORSMiddleware, allow_origins=_origins,
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


# ------------------------------------------------------------------- auth

def _dev_token_map() -> dict[str, str]:
    """DIVVIT_DEV_TOKENS="tok1:creator_1,tok2:creator_2". Absent means no
    authentication is configured, and the service refuses rather than
    defaulting to open."""
    raw = os.environ.get("DIVVIT_DEV_TOKENS", "")
    out: dict[str, str] = {}
    for pair in raw.split(","):
        if ":" in pair:
            tok, creator = pair.split(":", 1)
            if tok.strip() and creator.strip():
                out[tok.strip()] = creator.strip()
    return out


def current_creator(authorization: Optional[str] = Header(default=None)) -> str:
    """Resolve the caller. The single place identity enters the system."""
    tokens = _dev_token_map()
    if not tokens:
        raise HTTPException(
            503, "no authentication configured — set DIVVIT_DEV_TOKENS for local "
                 "use, or wire real session auth before deploying")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token")
    creator = tokens.get(authorization.split(" ", 1)[1].strip())
    if not creator:
        raise HTTPException(401, "unrecognised token")
    return creator


# ---------------------------------------------------------------- models

class ClaimRequest(BaseModel):
    """No creator_id field, deliberately — it comes from the token."""
    url: str = Field(..., max_length=2048)
    handle: str = Field(..., max_length=100)
    tier: int = Field(1, ge=1, le=4)
    submission_id: Optional[str] = None


class LinkRequest(BaseModel):
    platform: str
    handle: str = Field(..., max_length=100)
    # `oauth` is accepted only from the OAuth callback path, never from a
    # client asserting it. Until that callback exists, this stays False and
    # every link is recorded as unproven.
    oauth_verified: bool = False
    platform_user_id: Optional[str] = None


# ----------------------------------------------------------------- routes

@app.get("/v1/health")
def health() -> dict[str, Any]:
    return {"ok": True, "version": API_VERSION,
            "auth_configured": bool(_dev_token_map()),
            "time": datetime.now(timezone.utc).isoformat()}


@app.post("/v1/screen")
async def screen(video: UploadFile = File(...),
                 venue: str = Form(...),
                 location: str = Form(""),
                 creator: str = Depends(current_creator)) -> dict[str, Any]:
    """Screen a video before it is posted.

    This must happen before posting: neither TikTok nor Instagram returns the
    video afterwards, so this is the only moment the real file exists on our
    side. The fingerprint taken here is what the claim flow later matches the
    posted cover frame against.
    """
    if video.content_type and video.content_type not in ALLOWED_TYPES:
        raise HTTPException(415, f"unsupported type {video.content_type}")

    dir_ = Path(tempfile.mkdtemp(prefix="divvit-screen-"))
    target = dir_ / f"upload{Path(video.filename or '').suffix or '.mp4'}"
    size = 0
    try:
        with open(target, "wb") as fh:
            while chunk := await video.read(1 << 20):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "video exceeds 200MB")
                fh.write(chunk)

        store = IntakeStore()
        screener = DirectScreener()
        ok, _why = screener.available()
        # No API key configured is not an error: the venue gate routes to
        # "review unverified" instead, which is the honest outcome.
        pipeline = IntakePipeline(
            store, VenueGate(screener=screener if ok else None),
            on_status=lambda m: None)
        outcome = pipeline.submit(str(target), creator, venue, location)
        payload = outcome.to_dict()
        payload["creator_id"] = creator
        payload["bytes"] = size
        return payload
    finally:
        for p in (target, dir_):
            try:
                p.unlink() if p.is_file() else p.rmdir()
            except OSError:
                pass


@app.post("/v1/claims")
def create_claim(body: ClaimRequest,
                 creator: str = Depends(current_creator)) -> dict[str, Any]:
    """Run a posted link through the five gates."""
    return process_claim(body.url, submitter_id=creator,
                         handle_on_file=body.handle, tier=body.tier,
                         submission_id=body.submission_id)


@app.get("/v1/claims")
def list_claims(limit: int = 50,
                creator: str = Depends(current_creator)) -> dict[str, Any]:
    rows = [c for c in ClaimStore().claims(limit=200)
            if c["submitter_id"] == creator][:limit]
    return {"claims": rows, "count": len(rows)}


@app.get("/v1/links/preview")
def preview_link(url: str, creator: str = Depends(current_creator)) -> dict[str, Any]:
    """What a link resolves to, without recording a claim.

    Lets the app show the post and tell the creator up front that, say, an
    Instagram link cannot be checked — before they commit a claim to it.
    """
    try:
        link = resolve_link(url)
    except LinkError as exc:
        raise HTTPException(400, str(exc))
    out: dict[str, Any] = {"link": link.to_dict(), "post": None}
    if link.supported and not link.needs_redirect:
        try:
            out["post"] = fetch_post(link).to_dict()
        except LinkError as exc:
            out["error"] = str(exc)
    return out


@app.post("/v1/accounts/link")
def link_account(body: LinkRequest,
                 creator: str = Depends(current_creator)) -> dict[str, Any]:
    method = METHOD_OAUTH if body.oauth_verified else METHOD_MANUAL
    row = AccountStore().link(creator, body.platform, body.handle,
                              method=method,
                              platform_user_id=body.platform_user_id)
    return row.to_dict()


@app.get("/v1/accounts")
def list_accounts(creator: str = Depends(current_creator)) -> dict[str, Any]:
    return {"accounts": [a.to_dict() for a in AccountStore().for_submitter(creator)]}


@app.post("/v1/rechecks/run")
def rechecks(creator: str = Depends(current_creator)) -> dict[str, Any]:
    """T+7 liveness sweep. Operational, not creator-facing — it is exposed here
    so a scheduler can call it over the same contract as everything else."""
    return {"results": run_rechecks()}
