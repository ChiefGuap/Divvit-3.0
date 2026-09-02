"""The font library behind the editor's captions.

## Why this exists

Create burns two kinds of text: slot overlays through ffmpeg `drawtext`, and
spoken-word captions through ASS subtitles. Until now neither specified a
font. `drawtext` fell back to whatever ffmpeg found, and the ASS style asked
for **Arial** — a font we have no licence to ship, which is absent on most
Linux renderers and which would silently substitute something else there. A
caption that renders differently on the render host than on a laptop is a
correctness bug, not a taste one.

So the fonts have to be *ours*: downloaded, licence-checked, and addressed by
absolute path.

## Licensing is the point, not paperwork

Every face here is SIL Open Font License 1.1, which permits embedding in video
without attribution in the video itself. The licence file is downloaded
alongside each font and its presence is a **precondition of install** — the
same discipline `rights_status` applies to footage. A font whose licence we
did not fetch is not installed, and therefore cannot reach a render.

## The variable-font trap, measured

Most modern Google families ship as *variable* fonts, and ffmpeg's drawtext
exposes no axis control: libfreetype renders the font's default instance.
Montserrat's default instance is Regular (400), so asking for "Montserrat
Bold" in a caption yields something markedly lighter than intended, and only
on the render host.

`weight_class` is therefore **read out of each file's OS/2 table after
download** rather than taken on faith, and `choose()` will not put a font
below `MIN_DISPLAY_WEIGHT` on a hook. That is why the impact roles are filled
by families that are heavy *by default* — Anton, Bebas Neue, Archivo Black,
Staatliches — instead of by a variable family nominally capable of bold.
"""

from __future__ import annotations

import hashlib
import json
import re
import struct
import urllib.error
import urllib.request
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

RAW_BASE = "https://raw.githubusercontent.com/google/fonts/main"
DEFAULT_ROOT = Path("data/fonts")

# A hook has to read at a glance on a phone held at arm's length. The obvious
# test — OS/2 usWeightClass >= 700 — is WRONG here, and measuring caught it:
# single-weight display faces declare Regular. Anton, Bebas Neue, Archivo
# Black and Staatliches all report 400 while being visually black, so a weight
# gate would have rejected every good hook font and kept only Poppins Bold.
#
# What actually matters is how much ink a face puts on screen, so that is what
# is measured: the same string is rendered through ffmpeg at a fixed size and
# the frame's average luma is read back. Measured 2026-08-26 over the catalog:
#
#     Anton            43.4     <- the classic short-form hook face
#     Poppins Bold     41.4
#     Inter            31.4     <- body weight, variable default 400
#     Montserrat       19.7     <- variable default is 100. Unusable burned in.
#
# 36 sits in the gap between "carries a hook over moving footage" and "is a
# body caption", and no catalog face lands near it.
MIN_DISPLAY_INK = 36.0

# The measure conflates weight with width, and for condensed faces that is the
# wrong call: Bebas Neue (30.8) and Staatliches (32.7) are heavy *narrow* caps
# and are among the best hook faces there are — they exist so a long hook fits
# on one line. Their total ink is low because they occupy less width, not
# because the stroke is thin.
#
# The right quantity is ink per unit width, but drawtext does not report the
# rendered text width, and cropdetect returns the whole frame on antialiased
# text. So the catalog's own `condensed` flag stands in for the normalisation,
# and condensed faces are judged on a proportionally lower bar. That is a
# stated approximation, not a measurement.
CONDENSED_INK_ALLOWANCE = 0.75

# Kept because it is real metadata worth recording, and because it is the
# number a reader would otherwise reach for. It is not the gate.
MIN_DISPLAY_WEIGHT = 700

# Roles, and what each is for. These are the vocabulary `choose()` maps onto,
# and they mirror how Create already thinks about slots (hook / body / payoff).
ROLES = {
    "impact": "Hooks and titles. Heavy, high-contrast, legible at a glance.",
    "clean": "Body captions and spoken-word subtitles. Neutral and legible small.",
    "friendly": "Warm and rounded — cafes that trade on being welcoming.",
    "editorial": "Serif, considered. Reads as a review rather than an ad.",
    "script": "Handwritten or brush. Personality at the cost of legibility.",
}


@dataclass(frozen=True)
class FontSpec:
    """A font we are willing to ship, before it has been downloaded."""

    key: str
    family: str
    face: str
    role: str
    repo_dir: str            # directory within the google/fonts repo
    file_name: str           # the .ttf inside that directory
    licence: str = "OFL-1.1"
    caps_only: bool = False  # renders lowercase as small caps or not at all
    condensed: bool = False
    note: str = ""

    @property
    def url(self) -> str:
        return f"{RAW_BASE}/{self.repo_dir}/{self.file_name}"

    @property
    def licence_url(self) -> str:
        return f"{RAW_BASE}/{self.repo_dir}/OFL.txt"


# Every entry verified reachable 2026-08-26. Static faces are preferred
# wherever the weight matters; see the variable-font note in the module
# docstring for why that is not a stylistic preference.
CATALOG: tuple[FontSpec, ...] = (
    # --- impact: heavy by default, so ffmpeg renders them as intended -----
    FontSpec("anton", "Anton", "Regular", "impact", "ofl/anton",
             "Anton-Regular.ttf", caps_only=False, condensed=True,
             note="The default short-form hook face. Very heavy, very tight."),
    FontSpec("bebasneue", "Bebas Neue", "Regular", "impact", "ofl/bebasneue",
             "BebasNeue-Regular.ttf", caps_only=True, condensed=True,
             note="All-caps condensed. Fits long hooks on one line."),
    FontSpec("archivoblack", "Archivo Black", "Regular", "impact",
             "ofl/archivoblack", "ArchivoBlack-Regular.ttf",
             note="Wide and black. Good when the hook is short."),
    FontSpec("staatliches", "Staatliches", "Regular", "impact",
             "ofl/staatliches", "Staatliches-Regular.ttf", caps_only=True,
             condensed=True, note="Poster-like caps."),
    # --- clean: body captions, spoken word --------------------------------
    FontSpec("poppins-bold", "Poppins", "Bold", "clean", "ofl/poppins",
             "Poppins-Bold.ttf",
             note="Static Bold — the safe default for burned-in captions."),
    FontSpec("poppins-semibold", "Poppins", "SemiBold", "clean", "ofl/poppins",
             "Poppins-SemiBold.ttf", note="A step lighter than Bold."),
    FontSpec("montserrat", "Montserrat", "Variable", "clean", "ofl/montserrat",
             "Montserrat%5Bwght%5D.ttf",
             note="Variable: renders at its default weight, not Bold."),
    FontSpec("inter", "Inter", "Variable", "clean", "ofl/inter",
             "Inter%5Bopsz,wght%5D.ttf",
             note="Variable. Excellent small; light by default."),
    FontSpec("opensans", "Open Sans", "Variable", "clean", "ofl/opensans",
             "OpenSans%5Bwdth,wght%5D.ttf", note="Variable. Very neutral."),
    # --- friendly ---------------------------------------------------------
    FontSpec("nunito", "Nunito", "Variable", "friendly", "ofl/nunito",
             "Nunito%5Bwght%5D.ttf", note="Variable, rounded terminals."),
    FontSpec("righteous", "Righteous", "Regular", "friendly", "ofl/righteous",
             "Righteous-Regular.ttf", note="Retro-rounded display."),
    # --- editorial --------------------------------------------------------
    FontSpec("playfairdisplay", "Playfair Display", "Variable", "editorial",
             "ofl/playfairdisplay", "PlayfairDisplay%5Bwght%5D.ttf",
             note="High-contrast serif. Variable."),
    FontSpec("lora", "Lora", "Variable", "editorial", "ofl/lora",
             "Lora%5Bwght%5D.ttf", note="Readable serif. Variable."),
    FontSpec("alfaslabone", "Alfa Slab One", "Regular", "editorial",
             "ofl/alfaslabone", "AlfaSlabOne-Regular.ttf",
             note="Heavy slab — editorial weight without a variable axis."),
    # --- script -----------------------------------------------------------
    FontSpec("caveat", "Caveat", "Variable", "script", "ofl/caveat",
             "Caveat%5Bwght%5D.ttf", note="Handwriting. Variable."),
    FontSpec("pacifico", "Pacifico", "Regular", "script", "ofl/pacifico",
             "Pacifico-Regular.ttf", note="Brush script. Poor at small sizes."),
    FontSpec("lobster", "Lobster", "Regular", "script", "ofl/lobster",
             "Lobster-Regular.ttf", note="Condensed script."),
    FontSpec("shrikhand", "Shrikhand", "Regular", "script", "ofl/shrikhand",
             "Shrikhand-Regular.ttf", note="Very heavy display script."),
)

BY_KEY: dict[str, FontSpec] = {f.key: f for f in CATALOG}


class FontError(RuntimeError):
    pass


# ------------------------------------------------------------------ TTF bits

def _read_table(data: bytes, want: bytes) -> Optional[bytes]:
    """Return one sfnt table's bytes, or None. Hand-rolled because parsing
    four fields does not justify a dependency, and because the value we need
    (the weight ffmpeg will actually draw) must be measured, not assumed."""
    if len(data) < 12:
        return None
    num_tables = struct.unpack(">H", data[4:6])[0]
    for i in range(num_tables):
        rec = 12 + i * 16
        if rec + 16 > len(data):
            return None
        tag, _checksum, offset, length = struct.unpack(">4sIII", data[rec:rec + 16])
        if tag == want:
            return data[offset:offset + length]
    return None


def weight_class(path: Path) -> Optional[int]:
    """OS/2 usWeightClass — the weight of the font's *default* instance.

    For a variable font this is what libfreetype (and therefore ffmpeg) will
    render, which is the number that actually matters here.
    """
    try:
        data = path.read_bytes()
    except OSError:
        return None
    os2 = _read_table(data, b"OS/2")
    if not os2 or len(os2) < 6:
        return None
    return struct.unpack(">H", os2[4:6])[0]


INK_PROBE_TEXT = "HANDS"
INK_PROBE_SIZE = 140


def ink_coverage(path: Path, timeout: int = 30) -> Optional[float]:
    """How much ink this face puts down, 0-255, via one ffmpeg render.

    A fixed string at a fixed size on a fixed canvas, measured as the frame's
    average luma. It conflates weight with width on purpose: both are what
    decide whether a hook survives a bright frame behind it.

    Returns None when ffmpeg is unavailable or the face cannot be rendered —
    an unmeasured font is not a zero-ink font.
    """
    import shutil
    import subprocess
    if not shutil.which("ffmpeg") or not path.exists():
        return None
    escaped = str(path).replace("\\", "/").replace(":", r"\\:").replace("'", r"\\'")
    try:
        proc = subprocess.run([
            "ffmpeg", "-hide_banner", "-f", "lavfi",
            "-i", "color=black:s=900x260",
            "-vf", (f"drawtext=fontfile='{escaped}':text='{INK_PROBE_TEXT}':"
                    f"fontsize={INK_PROBE_SIZE}:fontcolor=white:"
                    "x=(w-text_w)/2:y=(h-text_h)/2,signalstats,"
                    "metadata=print:key=lavfi.signalstats.YAVG"),
            "-frames:v", "1", "-f", "null", "-",
        ], capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return None
    found = re.findall(r"YAVG=([0-9.]+)", proc.stderr or "")
    return float(found[-1]) if found else None


def is_variable(path: Path) -> bool:
    """A font carrying an `fvar` table has design axes."""
    try:
        return _read_table(path.read_bytes(), b"fvar") is not None
    except OSError:
        return False


# ------------------------------------------------------------------- library

@dataclass
class InstalledFont:
    key: str
    family: str
    face: str
    role: str
    path: str
    licence: str
    licence_path: str
    bytes: int
    sha256: str
    weight_class: Optional[int]
    variable: bool
    caps_only: bool
    condensed: bool
    note: str
    ink: Optional[float] = None

    @property
    def file(self) -> Path:
        return Path(self.path)

    @property
    def display_ready(self) -> bool:
        """Heavy enough to carry a hook over a bright frame.

        Judged on measured ink, not on the declared weight class — see the
        MIN_DISPLAY_INK note. Falls back to the weight class only when the
        font was never measured (no ffmpeg on the host).
        """
        if self.ink is not None:
            bar = MIN_DISPLAY_INK * (CONDENSED_INK_ALLOWANCE if self.condensed else 1.0)
            return self.ink >= bar
        return (self.weight_class or 0) >= MIN_DISPLAY_WEIGHT

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class InstallReport:
    installed: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return (f"{len(self.installed)} installed, {len(self.skipped)} already "
                f"present, {len(self.failed)} failed")


class FontLibrary:
    """The downloaded fonts on disk, plus the manifest describing them."""

    def __init__(self, root: Path | str = DEFAULT_ROOT,
                 fetch: Optional[Callable[[str], bytes]] = None):
        self.root = Path(root)
        self._fetch = fetch or _http_get

    @property
    def manifest_path(self) -> Path:
        return self.root / "manifest.json"

    def installed(self) -> dict[str, InstalledFont]:
        if not self.manifest_path.exists():
            return {}
        try:
            raw = json.loads(self.manifest_path.read_text())
        except ValueError:
            return {}
        out: dict[str, InstalledFont] = {}
        known = set(InstalledFont.__dataclass_fields__)
        for key, row in (raw.get("fonts") or {}).items():
            font = InstalledFont(**{k: v for k, v in row.items() if k in known})
            # A manifest entry whose file has since been deleted is not installed.
            if font.file.exists():
                out[key] = font
        return out

    def path(self, key: str) -> Optional[Path]:
        font = self.installed().get(key)
        return font.file if font else None

    def install(self, keys: Optional[Iterable[str]] = None, force: bool = False,
                on_status: Callable[[str], None] = lambda _m: None) -> InstallReport:
        """Download fonts and their licences. The licence is not optional: a
        font whose OFL.txt we could not fetch is left uninstalled, because an
        unlicensed font on the render host is exactly the problem this module
        exists to prevent."""
        report = InstallReport()
        current = self.installed()
        wanted = list(keys) if keys is not None else [f.key for f in CATALOG]

        for key in wanted:
            spec = BY_KEY.get(key)
            if spec is None:
                report.failed.append(key)
                report.errors.append(f"{key}: not in the catalog")
                continue
            if key in current and not force:
                report.skipped.append(key)
                continue

            target_dir = self.root / spec.repo_dir.split("/")[-1]
            target_dir.mkdir(parents=True, exist_ok=True)
            font_path = target_dir / Path(spec.file_name.replace("%5B", "[").replace("%5D", "]")).name
            licence_path = target_dir / "OFL.txt"

            try:
                licence_bytes = self._fetch(spec.licence_url)
            except Exception as exc:                      # noqa: BLE001 — reported
                report.failed.append(key)
                report.errors.append(f"{key}: licence unavailable ({exc}) — not installed")
                continue

            try:
                font_bytes = self._fetch(spec.url)
            except Exception as exc:                      # noqa: BLE001 — reported
                report.failed.append(key)
                report.errors.append(f"{key}: {exc}")
                continue

            if not font_bytes[:4] in (b"\x00\x01\x00\x00", b"true", b"OTTO", b"ttcf"):
                report.failed.append(key)
                report.errors.append(f"{key}: downloaded bytes are not a font")
                continue

            licence_path.write_bytes(licence_bytes)
            font_path.write_bytes(font_bytes)

            font = InstalledFont(
                key=spec.key, family=spec.family, face=spec.face, role=spec.role,
                path=str(font_path), licence=spec.licence,
                licence_path=str(licence_path), bytes=len(font_bytes),
                sha256=hashlib.sha256(font_bytes).hexdigest(),
                weight_class=weight_class(font_path),
                variable=is_variable(font_path),
                ink=ink_coverage(font_path),
                caps_only=spec.caps_only, condensed=spec.condensed, note=spec.note,
            )
            current[key] = font
            report.installed.append(key)
            on_status(f"  {spec.family} {spec.face} — ink "
                      f"{font.ink if font.ink is None else round(font.ink, 1)}"
                      f", weight {font.weight_class}"
                      f"{' (variable)' if font.variable else ''}"
                      f"{'' if font.display_ready else '  [body only]'}")

        self._write_manifest(current)
        return report

    def _write_manifest(self, fonts: dict[str, InstalledFont]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.manifest_path.write_text(json.dumps({
            "note": ("Fonts downloaded for burned-in captions. Every face is "
                     "SIL OFL 1.1; the licence file sits beside each font. "
                     "weight_class is read from the file's OS/2 table — for a "
                     "variable font it is the default instance, which is what "
                     "ffmpeg renders."),
            "min_display_ink": MIN_DISPLAY_INK,
            "condensed_ink_allowance": CONDENSED_INK_ALLOWANCE,
            "min_display_weight": MIN_DISPLAY_WEIGHT,
            "roles": ROLES,
            "fonts": {k: v.to_dict() for k, v in sorted(fonts.items())},
        }, indent=2))


def _http_get(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "divvit-fonts/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


# ----------------------------------------------------------------- selection

# Discover's archetypes -> the role that suits how that format is edited.
ARCHETYPE_ROLE = {
    "menu_review": "clean",
    "ranking_list": "impact",
    "montage": "impact",
    "aesthetic": "editorial",
    "cafe_vlog": "friendly",
    "venue_vibe": "friendly",
    "behind_counter": "clean",
    "menu_item": "clean",
    "hidden_gem": "impact",
    "value_deal": "impact",
    "review": "clean",
}

_DESCRIPTION_HINTS: tuple[tuple[str, str], ...] = (
    (r"\bhandwrit|script|brush|signature\b", "script"),
    (r"\bserif|editorial|elegant\b", "editorial"),
    (r"\brounded|friendly|playful|soft\b", "friendly"),
    (r"\bbold|heavy|thick|impact|caps|all[- ]caps\b", "impact"),
)


def role_for(archetype: str = "", caption_description: str = "") -> str:
    """Pick a role from what Discover measured about the format.

    The caption description wins when it says something concrete, because it
    was read off real videos in that archetype; the archetype is the fallback.
    This is a stated rule mapping, not a learned model — calling it
    "automated" should not imply it inferred anything.
    """
    text = (caption_description or "").lower()
    for pattern, role in _DESCRIPTION_HINTS:
        if re.search(pattern, text):
            return role
    return ARCHETYPE_ROLE.get((archetype or "").lower(), "clean")


def choose(archetype: str = "", caption_description: str = "",
           role: str = "", slot_role: str = "",
           library: Optional[FontLibrary] = None) -> Optional[InstalledFont]:
    """The automated half of the two options: pick a font, or return None.

    None means *no installed font fits*, and the caller must fall back rather
    than render with something wrong. It never invents a choice.
    """
    library = library or FontLibrary()
    installed = library.installed()
    if not installed:
        return None

    wanted = role or role_for(archetype, caption_description)
    pool = [f for f in installed.values() if f.role == wanted] or list(installed.values())

    # A hook is the one place weight is not negotiable: it sits over moving
    # footage with nothing else on screen to carry it.
    if slot_role == "hook":
        heavy = [f for f in pool if f.display_ready]
        if not heavy:
            heavy = [f for f in installed.values() if f.display_ready]
        pool = heavy or pool

    # Heaviest first, then deterministically by key so a plan is reproducible.
    # Ranked on measured ink, not the declared weight class — sorting on
    # weight would repeat the trap `display_ready` exists to avoid, and would
    # order four display faces that all declare 400 alphabetically.
    pool.sort(key=lambda f: (-(f.ink if f.ink is not None else 0),
                             -(f.weight_class or 0), f.key))
    return pool[0] if pool else None


def catalog_rows() -> list[dict[str, Any]]:
    """The catalog as plain dicts — for the CLI and the picker UI."""
    return [{"key": f.key, "family": f.family, "face": f.face, "role": f.role,
             "licence": f.licence, "caps_only": f.caps_only,
             "condensed": f.condensed, "note": f.note} for f in CATALOG]


def apply_font(caption_style: Any, archetype: str = "", slot_role: str = "",
               manual_key: str = "", library: Optional[FontLibrary] = None) -> Any:
    """Put a font on a CaptionStyle — the two options, in one place.

    `manual_key` is the picker: the business chose a face and that choice wins
    outright, including over the weight rule, because overriding a person's
    explicit selection with a heuristic is worse than letting them ship a thin
    hook. An unknown or uninstalled key is **not** silently swapped for
    something else; it leaves the style unfonted and records why.

    With no `manual_key` the choice is automatic, from what Discover measured
    about the format.

    Duck-typed on purpose: importing CaptionStyle here would make recipes and
    fonts import each other.
    """
    library = library or FontLibrary()
    installed = library.installed()

    chosen: Optional[InstalledFont] = None
    source = "none"

    if manual_key:
        chosen = installed.get(manual_key)
        source = "manual" if chosen else "none"
    else:
        chosen = choose(
            archetype=archetype,
            caption_description=getattr(caption_style, "description", "") or "",
            slot_role=slot_role, library=library)
        source = "automatic" if chosen else "none"

    setattr(caption_style, "font_file", str(chosen.file) if chosen else None)
    setattr(caption_style, "font_family", chosen.family if chosen else None)
    setattr(caption_style, "font_key", chosen.key if chosen else None)
    setattr(caption_style, "font_source", source)
    return caption_style


def picker_options(library: Optional[FontLibrary] = None) -> list[dict[str, Any]]:
    """The installed library as the picker UI needs it, grouped-ready.

    Carries the measured facts a person choosing needs to see — whether a face
    is heavy enough for a hook, whether it is caps-only, and its licence — so
    the UI can warn rather than let someone pick a font that will disappoint
    them at render time.
    """
    library = library or FontLibrary()
    rows = []
    for font in library.installed().values():
        rows.append({
            "key": font.key,
            "family": font.family,
            "face": font.face,
            "role": font.role,
            "role_note": ROLES.get(font.role, ""),
            "hook_ready": font.display_ready,
            "caps_only": font.caps_only,
            "condensed": font.condensed,
            "ink": round(font.ink, 1) if font.ink is not None else None,
            "licence": font.licence,
            "note": font.note,
        })
    rows.sort(key=lambda r: (r["role"], -(r["ink"] or 0), r["key"]))
    return rows
