"""
"Dropshipping is dead" carousel — 10 photo slides in a fixed order.

  1. results folder   "Dropshipping is dead"
  2. show kalodata    1) Find a problem solving product on Kalodata
  3. kalodata         Sort by revenue and pick one that's going viral
  4. aliexpress       2) Find the same product on AliExpress
  5. show dropmagic   3) Build your Shopify store with Dropmagic
  6. dropmagic        Store ready in seconds, no coding needed
  7. show youry       4) Get cheap UGC ads from Youry
  8. ugc              AI creators, looks 100% real
  9. insta            5) Post them on Instagram and run ads
 10. result           Thank me later 🤑 (+ optional comment CTA)

Slides 1, 3, 6, 8 and 10 rotate between a few wordings (see SLIDE_LINES).

Slide 1 is a random screenshot from carousel/assets/photos/results; slide 10 uses the
custom "result" photos half of the time and another results screenshot otherwise. The other slides
come from carousel/assets/photos/dead, matched by name: "kalodata.JPG",
"kalodata (2).JPG", … are variants of the same slide and one is picked at random.

Subtitles live in SLIDE_LINES (stroke text, same style as the other EE carousels).
A slide with no lines is exported as a plain photo.
"""

from __future__ import annotations

import json
import random
import re
import shutil
import uuid
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

from PIL import Image

from .ee_best_business import (
    _blank_overlay,
    _composite,
    _draw_stroked_line,
    _fit_font,
    _line_metrics,
    _stroke_width,
)
from .ee_carousel import CarouselResult, _engine
from .ee_steps import draw_pill
from .image_metadata import save_as_iphone_photo

PACK = "dead"
PLACEHOLDER = (16, 16, 18)

RESULTS_FOLDER = "results"
# Share of carousels whose last slide uses the custom "result" photos of the dead pack;
# the rest use any screenshot from the results folder.
CUSTOM_RESULT_SHARE = 0.5

# "folder:<name>" = random photo from carousel/assets/photos/<name>; otherwise a name group in the dead pack.
SLIDE_ORDER = (
    f"folder:{RESULTS_FOLDER}",
    "show kalodata",
    "kalodata",
    "aliexpress",
    "show dropmagic",
    "dropmagic",
    "show youry",
    "ugc",
    "insta",
    "result",
)

# One entry per slide, same order as SLIDE_ORDER: (lines, anchor). anchor: center, top, or low.
# A list instead of a tuple of lines means "pick one of these wordings at random".
SLIDE_LINES: tuple[tuple[tuple[str, ...] | list[tuple[str, ...]], str], ...] = (
    (
        [
            ('"Dropshipping is dead"',),
            ('"Dropshipping is dead"', "they said"),
            ('They said "dropshipping', 'is dead"'),
        ],
        "center",
    ),
    (("1) Find a problem solving", "product on Kalodata"), "top"),
    (
        [
            ("Sort by revenue and pick", "one that's going viral"),
            ("Sort by revenue, pick", "a product going viral"),
            ("Pick one that's already", "selling like crazy"),
        ],
        "top",
    ),
    (("2) Find the same product", "on AliExpress"), "top"),
    (("3) Build your Shopify", "store with Dropmagic"), "top"),
    (
        [
            ("Store ready in seconds,", "no coding needed"),
            ("Full store in seconds,", "zero coding"),
            ("Your store is live", "in seconds"),
        ],
        "top",
    ),
    (("4) Get cheap UGC ads", "from Youry"), "top"),
    (
        [
            ("AI creators, looks", "100% real"),
            ("AI UGC that looks", "100% real"),
            ("No creators needed,", "it's all AI"),
        ],
        "top",
    ),
    (("5) Post them on Instagram", "and run ads"), "top"),
    (
        [
            ("Thank me later 🤑",),
            ("You can thank me later 🤑",),
        ],
        "low",
    ),
)

# Optional CTA box under the last line (None = no CTA), same box as the steps outro.
END_CTAS = (
    None,
    "Comment \u2018AI\u2019 for the full guide",
    "Comment \u2018Ecom\u2019 for the full workflow",
    "Comment \u2018AI\u2019 to get the full workflow",
    "Comment \u2018Ecom\u2019 for the full guide",
)
assert len(SLIDE_LINES) == len(SLIDE_ORDER)

_VARIANT_SUFFIX = re.compile(r"\s*\(\d+\)$")


def _group_key(path: Path) -> str:
    return _VARIANT_SUFFIX.sub("", path.stem).strip().lower()


def _pick_photos(gc, rng: random.Random) -> list[Path | None]:
    folder = gc.PHOTOS_DIR / PACK
    photos = gc._collect_images(folder) if folder.is_dir() else []
    groups: dict[str, list[Path]] = {}
    for path in sorted(photos, key=lambda p: p.name.lower()):
        groups.setdefault(_group_key(path), []).append(path)

    from youry import clip_assembler as ca

    results = sorted(gc._collect_images(gc.PHOTOS_DIR / RESULTS_FOLDER), key=lambda p: p.name.lower())
    recent = ca._load_recent()
    picked: list[Path | None] = []
    for key in SLIDE_ORDER:
        if key.startswith("folder:"):
            options, history = sorted(gc._collect_images(gc.PHOTOS_DIR / key.split(":", 1)[1]), key=lambda p: p.name.lower()), "dead:results"
        elif key == "result" and results and (not groups.get(key) or rng.random() >= CUSTOM_RESULT_SHARE):
            options, history = results, "dead:results"
        else:
            options, history = groups.get(key, []), f"dead:{key}"
        drawn = ca.draw_from_deck(rng, options, history, 1, recent, exclude=[p for p in picked if p])
        picked.append(drawn[0] if drawn else None)
    ca.save_recent(recent)
    return picked


def _render_slide(gc, bg: Image.Image, lines: tuple[str, ...], anchor: str, cta: str | None = None) -> Image.Image:
    if not lines:
        return bg.convert("RGB")
    start = 104 if len(lines) == 1 else 86
    font, _size = _fit_font(gc, list(lines), start, 58)
    stroke_w = _stroke_width(font.size)
    heights = [_line_metrics(gc, line, font, stroke_w)[1] for line in lines]
    gap = max(4, stroke_w // 4)
    total = sum(heights) + gap * max(0, len(lines) - 1)
    if anchor == "top":
        y = int(gc.CANVAS_H * 0.10)
    elif anchor == "low":
        y = int(gc.CANVAS_H * 0.58)
    else:
        y = (gc.CANVAS_H - total) // 2
    overlay = _blank_overlay(gc, bg)
    for line, height in zip(lines, heights):
        _draw_stroked_line(gc, overlay, line, font, y)
        y += height + gap
    if cta:
        draw_pill(gc, overlay, cta, y + 40)
    return _composite(bg, overlay)


def build_dead_carousel(out_dir: Path, *, seed: int) -> CarouselResult:
    gc = _engine()
    rng = random.Random(seed)
    rendered = []
    for path, (options, anchor) in zip(_pick_photos(gc, rng), SLIDE_LINES):
        lines = rng.choice(options) if isinstance(options, list) else options
        if path is None:
            bg = Image.new("RGB", (gc.CANVAS_W, gc.CANVAS_H), PLACEHOLDER)
        else:
            bg = gc._load_cover_augmented(path, gc.CANVAS_W, gc.CANVAS_H, "none")
        cta = rng.choice(END_CTAS) if len(rendered) == len(SLIDE_LINES) - 1 else None
        rendered.append(_render_slide(gc, bg, lines, anchor, cta))
    return export_carousel(rendered, out_dir, rng, style="dead")


def export_carousel(rendered: list[Image.Image], out_dir: Path, rng: random.Random, *, style: str) -> CarouselResult:
    """iPhone-signed JPGs (consecutive IMG numbers, a few seconds apart) plus an untouched ZIP."""
    work = out_dir / f"carousel_{uuid.uuid4().hex[:10]}"
    work.mkdir(parents=True, exist_ok=True)
    taken_at = datetime.now().astimezone() - timedelta(minutes=rng.uniform(3, 25))
    first_number = rng.randint(1000, 9990 - len(rendered))
    slides: list[Path] = []
    for index, image in enumerate(rendered):
        slides.append(
            save_as_iphone_photo(
                image,
                work,
                rng=rng,
                taken_at=taken_at + timedelta(seconds=index * rng.uniform(4, 14)),
                file_number=first_number + index,
            )
        )

    zip_path = out_dir / f"ee_dead_{first_number}.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED) as archive:
        for slide in slides:
            archive.write(slide, arcname=slide.name)

    final_slides = []
    for slide in slides:
        target = out_dir / slide.name
        shutil.move(str(slide), target)
        final_slides.append(target)
    shutil.rmtree(work, ignore_errors=True)

    return CarouselResult(
        slides=final_slides,
        zip_path=zip_path,
        hook_preview="Dropshipping is dead",
        avatar_pack="dead",
        avatar="",
        color="stroke",
        style=style,
    )
