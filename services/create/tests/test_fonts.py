"""Tests for the caption font library — no network, no downloads.

Weighted toward the failures that are invisible until a render lands on
someone's timeline:

  * a font shipped without its licence
  * a caption rendered in whatever the host happened to have, because no
    fontfile was passed
  * a hook set in a face too light to read over moving footage — which the
    obvious weight check gets WRONG, since single-weight display faces
    declare Regular while being visually black
  * a person's explicit font choice silently overridden by a heuristic

    .venv/bin/python -m services.create.tests.test_fonts
"""

from __future__ import annotations

import json
import struct
import sys
import tempfile
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.create.assemble import _fontfile_arg                     # noqa: E402
from services.create.fonts import (                                    # noqa: E402
    BY_KEY, CATALOG, CONDENSED_INK_ALLOWANCE, FontLibrary, InstalledFont,
    MIN_DISPLAY_INK, ROLES, apply_font, choose, picker_options, role_for,
    weight_class)
from services.create.recipes import CaptionStyle                       # noqa: E402

_failures: list[str] = []


def check(condition: bool, label: str) -> None:
    if condition:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}")
        _failures.append(label)


def font(key="anton", family="Anton", role="impact", ink=43.4, condensed=False,
         caps_only=False, path="/tmp/x.ttf", weight=400) -> InstalledFont:
    return InstalledFont(
        key=key, family=family, face="Regular", role=role, path=path,
        licence="OFL-1.1", licence_path="/tmp/OFL.txt", bytes=1, sha256="x",
        weight_class=weight, variable=False, caps_only=caps_only,
        condensed=condensed, note="", ink=ink)


class FakeLibrary(FontLibrary):
    def __init__(self, fonts: dict[str, InstalledFont]):
        super().__init__(root="/tmp/never-used")
        self._fonts = fonts

    def installed(self):
        return self._fonts


# ------------------------------------------------------------------ catalog

def test_catalog_integrity() -> None:
    print("\ncatalog")
    check(len({f.key for f in CATALOG}) == len(CATALOG), "keys are unique")
    check(all(f.role in ROLES for f in CATALOG),
          "every font declares a role the picker knows")
    check(all(f.licence == "OFL-1.1" for f in CATALOG),
          "every face is OFL — nothing ships that we cannot licence")
    check(all(f.repo_dir.startswith(("ofl/", "apache/")) for f in CATALOG),
          "every source path is a licensed directory of the fonts repo")
    check(all(f.licence_url.endswith("/OFL.txt") for f in CATALOG),
          "and each carries a licence URL to fetch alongside it")
    for role in ROLES:
        check(any(f.role == role for f in CATALOG), f"role '{role}' has a face")


# ------------------------------------------------------- the weight trap

def test_ink_beats_weight_class() -> None:
    """The bug this module would otherwise have shipped.

    Anton, Bebas Neue, Archivo Black and Staatliches all report OS/2
    usWeightClass 400 while being visually black, because a single-weight
    display family declares Regular. Gating hooks on weight >= 700 would have
    rejected every good hook face and kept only Poppins Bold.
    """
    print("\nink beats declared weight")
    display_face = font(ink=43.4, weight=400)
    check(display_face.display_ready,
          "a heavy display face qualifies on ink despite declaring weight 400")

    variable_light = font(key="montserrat", ink=19.7, weight=100)
    check(not variable_light.display_ready,
          "a variable font rendering at its light default does NOT qualify — "
          "this is the trap: ffmpeg draws the default instance, not Bold")

    condensed = font(key="bebasneue", ink=30.8, condensed=True)
    check(condensed.ink < MIN_DISPLAY_INK,
          "a condensed face falls under the flat ink bar")
    check(condensed.display_ready,
          "but still qualifies, because narrowness is the point of it — it is "
          "judged against the condensed allowance")
    check(font(key="x", ink=MIN_DISPLAY_INK * CONDENSED_INK_ALLOWANCE - 0.1,
               condensed=True).display_ready is False,
          "the allowance is a lower bar, not an exemption")

    unmeasured = font(ink=None, weight=800)
    check(unmeasured.display_ready,
          "with no ink measurement it falls back to the weight class")
    check(font(ink=None, weight=400).display_ready is False,
          "and a light unmeasured font is not promoted")


def test_weight_class_parser() -> None:
    print("\nOS/2 parsing")
    # A minimal sfnt with one OS/2 table whose usWeightClass is 800.
    os2 = struct.pack(">HhH", 4, 0, 800) + b"\x00" * 20
    header = struct.pack(">IHHHH", 0x00010000, 1, 0, 0, 0)
    offset = len(header) + 16
    record = struct.pack(">4sIII", b"OS/2", 0, offset, len(os2))
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "f.ttf"
        p.write_bytes(header + record + os2)
        check(weight_class(p) == 800, "usWeightClass is read out of the OS/2 table")
        empty = Path(tmp) / "empty.ttf"
        empty.write_bytes(b"")
        check(weight_class(empty) is None, "a non-font returns None, not a guess")
        check(weight_class(Path(tmp) / "missing.ttf") is None,
              "a missing file returns None rather than raising")


# ---------------------------------------------------------------- selection

def test_role_mapping() -> None:
    print("\nrole selection")
    check(role_for(archetype="ranking_list") == "impact",
          "a ranked list is hook-led, so it maps to impact")
    check(role_for(archetype="menu_review") == "clean",
          "a spoken review is body-led")
    check(role_for(archetype="unknown-thing") == "clean",
          "an unrecognised archetype falls back to the neutral role")
    check(role_for(caption_description="large bold all-caps text") == "impact",
          "the measured caption description outranks the archetype")
    check(role_for(archetype="ranking_list",
                   caption_description="handwritten script") == "script",
          "including when they disagree — the description was read off real "
          "videos, the archetype is only a keyword guess")


def test_choose() -> None:
    print("\nautomatic choice")
    lib = FakeLibrary({
        "anton": font("anton", "Anton", "impact", ink=43.4),
        "light": font("light", "Thin", "impact", ink=12.0),
        "poppins-bold": font("poppins-bold", "Poppins", "clean", ink=41.4),
        "inter": font("inter", "Inter", "clean", ink=31.4),
    })
    check(choose(archetype="ranking_list", library=lib).key == "anton",
          "impact archetype picks the heaviest impact face")
    check(choose(archetype="menu_review", library=lib).key == "poppins-bold",
          "body archetype picks within the clean role")
    check(choose(archetype="ranking_list", slot_role="hook", library=lib).key == "anton",
          "a hook never gets a face too light to carry it")

    thin_only = FakeLibrary({"light": font("light", "Thin", "impact", ink=12.0)})
    picked = choose(archetype="ranking_list", slot_role="hook", library=thin_only)
    check(picked is not None and picked.key == "light",
          "with nothing heavy installed it still returns a font rather than "
          "failing the render")

    check(choose(library=FakeLibrary({})) is None,
          "an empty library returns None — the caller must fall back, not be "
          "handed a font that does not exist")


def test_apply_font() -> None:
    print("\napply to a caption style")
    lib = FakeLibrary({
        "anton": font("anton", "Anton", "impact", ink=43.4, path="/f/Anton.ttf"),
        "caveat": font("caveat", "Caveat", "script", ink=25.2, path="/f/Caveat.ttf"),
    })

    auto = apply_font(CaptionStyle(), archetype="ranking_list", slot_role="hook",
                      library=lib)
    check(auto.font_key == "anton" and auto.font_source == "automatic",
          "the automatic path records that it chose")
    check(auto.font_file == "/f/Anton.ttf" and auto.font_family == "Anton",
          "and sets both the path drawtext needs and the family ASS needs")

    manual = apply_font(CaptionStyle(), archetype="ranking_list",
                        slot_role="hook", manual_key="caveat", library=lib)
    check(manual.font_key == "caveat" and manual.font_source == "manual",
          "an explicit pick wins over the archetype")
    check(not manual and False or manual.font_family == "Caveat",
          "even when it is too light for a hook — overriding a person's stated "
          "choice with a heuristic is worse than letting them ship it")

    missing = apply_font(CaptionStyle(), manual_key="does-not-exist", library=lib)
    check(missing.font_file is None and missing.font_source == "none",
          "an uninstalled key leaves the style unfonted rather than silently "
          "substituting a different face")

    none_installed = apply_font(CaptionStyle(), archetype="ranking_list",
                                library=FakeLibrary({}))
    check(none_installed.font_source == "none",
          "and an empty library is recorded as such")


# ------------------------------------------------------------------ render

def test_drawtext_argument() -> None:
    print("\ndrawtext wiring")
    style = CaptionStyle()
    check(_fontfile_arg(style) == "",
          "no font chosen means no fontfile= — an explicit fallback to "
          "ffmpeg's default, not a broken filter")

    style.font_file = "/fonts/anton/Anton-Regular.ttf"
    arg = _fontfile_arg(style)
    check(arg.startswith("fontfile='") and arg.endswith("':"),
          "a chosen font becomes a quoted fontfile= option")

    # The variable fonts on disk really are named like this.
    style.font_file = "/fonts/montserrat/Montserrat[wght].ttf"
    check("Montserrat[wght].ttf" in _fontfile_arg(style),
          "square brackets in a variable font's filename survive escaping")

    style.font_file = "/f/wei:rd/Anton.ttf"
    check(r"\\:" in _fontfile_arg(style) or r"\:" in _fontfile_arg(style),
          "a colon in the path is escaped — it separates options in a filter "
          "graph and would otherwise truncate the filename")


# ------------------------------------------------------------------ install

def test_install_requires_a_licence() -> None:
    print("\ninstall")
    real_font = b"\x00\x01\x00\x00" + b"\x00" * 200

    with tempfile.TemporaryDirectory() as tmp:
        def fetch(url: str) -> bytes:
            if url.endswith("OFL.txt"):
                raise RuntimeError("404")
            return real_font

        lib = FontLibrary(root=Path(tmp), fetch=fetch)
        report = lib.install(keys=["anton"])
        check(report.failed == ["anton"] and not report.installed,
              "a font whose licence cannot be fetched is NOT installed")
        check(any("licence" in e for e in report.errors),
              "and the reason names the licence")
        check(lib.installed() == {},
              "nothing unlicensed reaches the manifest")

    with tempfile.TemporaryDirectory() as tmp:
        lib = FontLibrary(root=Path(tmp), fetch=lambda url: real_font)
        report = lib.install(keys=["anton"])
        check(report.installed == ["anton"], "a licensed font installs")
        installed = lib.installed()
        check("anton" in installed, "and lands in the manifest")
        check(Path(installed["anton"].licence_path).exists(),
              "with its licence file written beside it")

        again = lib.install(keys=["anton"])
        check(again.skipped == ["anton"] and not again.installed,
              "re-running skips what is present rather than re-downloading")

        Path(installed["anton"].path).unlink()
        check(lib.installed() == {},
              "a manifest entry whose file has gone is not reported installed")

    with tempfile.TemporaryDirectory() as tmp:
        lib = FontLibrary(root=Path(tmp), fetch=lambda url: b"<html>404</html>")
        report = lib.install(keys=["anton"])
        check(report.failed == ["anton"],
              "an error page served instead of a font is rejected on its magic "
              "bytes, not written to disk as a .ttf")

    with tempfile.TemporaryDirectory() as tmp:
        lib = FontLibrary(root=Path(tmp), fetch=lambda url: real_font)
        report = lib.install(keys=["not-in-catalog"])
        check(report.failed == ["not-in-catalog"],
              "an unknown key fails loudly instead of downloading nothing quietly")


def test_picker_options() -> None:
    print("\npicker payload")
    lib = FakeLibrary({
        "anton": font("anton", "Anton", "impact", ink=43.4, condensed=True,
                      caps_only=True),
        "inter": font("inter", "Inter", "clean", ink=31.4),
    })
    rows = picker_options(lib)
    check(len(rows) == 2, "every installed font is offered")
    by_key = {r["key"]: r for r in rows}
    check(by_key["anton"]["hook_ready"] is True and by_key["inter"]["hook_ready"] is False,
          "the picker can warn that a face is body-only before it is chosen")
    check(by_key["anton"]["caps_only"] is True,
          "and that a face has no lowercase, which changes what the hook reads like")
    check(all(r["licence"] for r in rows),
          "every option carries its licence — the person picking is choosing "
          "what ships in a public video")


def main() -> int:
    for test in (test_catalog_integrity, test_ink_beats_weight_class,
                 test_weight_class_parser, test_role_mapping, test_choose,
                 test_apply_font, test_drawtext_argument,
                 test_install_requires_a_licence, test_picker_options):
        test()
    print()
    if _failures:
        print(f"FAILED: {len(_failures)}")
        for f in _failures:
            print(f"  - {f}")
        return 1
    print("all tests passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
