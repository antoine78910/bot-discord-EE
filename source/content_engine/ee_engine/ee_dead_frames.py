"""
"Dropshipping is dead" carousel built from workflow video frames (unlimited variations).

Same 10 slides, texts and stroke style as ee_dead, but slides 2-9 are frames grabbed at a
random moment of a random clip from content_engine/workflow (one product per carousel):

  1. results photo      "Dropshipping is dead"
  2. show kalodata      1) Find a problem solving product on Kalodata | tiktok: 1) Find a viral product on TikTok
  3. kalodata products  Sort by revenue and pick one that's going viral | tiktok show: pick one going viral
  4. aliexpress         2) Find the same product on AliExpress
  5. dropmagic          3) Build your Shopify store with Dropmagic
  6. shop               Store ready in seconds, no coding needed
  7. show youry         4) Get cheap UGC ads from Youry      | 4) Make your ads with Youry
  8. ugc                AI creators, looks 100% real         | show workflow (ads grid): 20 winning ads
  9. ig (else meta)     5) Post them on Instagram and run ads| meta: 5) Launch them on Meta
 10. results photo      Thank me later 🤑 (+ optional comment CTA)

Like the workflow video, slides 2-3 are Kalodata or TikTok research and slides 7-9 are
Link to Ad (UGC) or Workflow (static ads).
Each frame is the sharpest of a few random timestamps, so pen/hand motion blur is avoided.
"""

from __future__ import annotations

import random
import shutil
import uuid
from pathlib import Path

from PIL import Image, ImageFilter, ImageStat

from .ee_carousel import CarouselResult, _engine
from .ee_dead import (
    CUSTOM_RESULT_SHARE,
    END_CTAS,
    PACK,
    RESULTS_FOLDER,
    SLIDE_LINES,
    _group_key,
    _render_slide,
    export_carousel,
)
from .ffmpeg_tools import EngineError, probe_duration, run_ffmpeg
from .workflow_video import BROAD_DIR, _clips, _products, normalize

# Each frame slide: candidate steps (clip, source[, frame window]) drawn evenly across their
# variants, text, anchor. Sources: broad | product | any (product clip if it exists, else broad).
# The window is the part of the clip frames are taken from (default FRAME_WINDOW).
RESEARCH = {
    "Kalodata": (
        ([("show kalodata", "broad")], SLIDE_LINES[1]),
        ([("kalodata show product", "any")], SLIDE_LINES[2]),
    ),
    "TikTok": (
        ([("mademebuyit", "broad"), ("tiktok", "broad")], (
            [("1) Find a viral product", "on TikTok"), ("1) Search", "#tiktokmademebuyit")], "top")),
        ([("tiktok show", "any")], (
            [("Pick one that's already", "going viral"), ("This one is making", "thousands per day")], "top")),
    ),
}
COMMON = (
    ([("aliexpress", "product")], SLIDE_LINES[3]),
    ([("show dropmagic", "broad"), ("loading dropmagic", "broad")], SLIDE_LINES[4]),
    ([("shop", "product")], SLIDE_LINES[5]),
)
BRANCHES = {
    "Link to Ad": (
        ([("show youry", "broad")], SLIDE_LINES[6]),
        ([("ugc", "product")], SLIDE_LINES[7]),
        ([("ig", "product")], SLIDE_LINES[8]),
    ),
    "Workflow": (
        ([("show youry", "broad")], (("4) Make your ads with", "Youry workflows"), "top")),
        ([("show workflow", "product", (0.6, 0.95))], (
            [("20 winning ads,", "ready to sell"), ("Get 20 proven ads", "in minutes")], "top")),
        ([("meta", "broad")], (
            [("5) Create a Meta campaign", "and upload them"), ("5) Launch them", "on Meta ads")], "top")),
    ),
}
# Link to Ad without an ig clip for the product: show meta with this text instead.
META_FALLBACK = ([("meta", "broad")], (("5) Post them and", "run Meta ads"), "top"))

FRAME_CANDIDATES = 4
FRAME_WINDOW = (0.12, 0.88)


def _pool(clip: str, source: str, broad: dict, product: dict) -> list[Path]:
    key = normalize(clip)
    if source == "product":
        return product.get(key, [])
    if source == "any":
        return product.get(key) or broad.get(key, [])
    return broad.get(key, [])


def _resolve(slides, broad: dict, product: dict) -> list | None:
    """Per slide: the candidate pools with clips; None when a slide has nothing for this product."""
    resolved = []
    for steps, text in slides:
        pools = [
            (step[0], _pool(step[0], step[1], broad, product), step[2] if len(step) > 2 else FRAME_WINDOW)
            for step in steps
        ]
        pools = [pool for pool in pools if pool[1]]
        if not pools:
            return None
        resolved.append((pools, text))
    return resolved


def _plan(rng: random.Random, broad: dict) -> tuple[str, str, list]:
    candidates = []
    for folder in _products():
        product = _clips(folder)
        for research, head in RESEARCH.items():
            for branch, tail in BRANCHES.items():
                tail = list(tail)
                if branch == "Link to Ad" and not product.get("ig"):
                    tail[-1] = META_FALLBACK
                slides = _resolve(list(head) + list(COMMON) + tail, broad, product)
                if slides:
                    candidates.append((folder.name, f"{research} · {branch}", slides))
    if not candidates:
        raise EngineError("No product folder in workflow/products has every clip this carousel needs.")
    return rng.choice(candidates)


def _sharpness(image: Image.Image) -> float:
    small = image.convert("L").resize((270, 480))
    return ImageStat.Stat(small.filter(ImageFilter.FIND_EDGES)).mean[0]


def _grab_frame(clip: Path, work: Path, rng: random.Random, window: tuple[float, float]) -> Path:
    duration = max(0.2, probe_duration(clip))
    best, best_score = None, -1.0
    for index in range(FRAME_CANDIDATES):
        at = duration * rng.uniform(*window)
        out = work / f"{uuid.uuid4().hex[:8]}_{index}.jpg"
        run_ffmpeg(["-ss", f"{at:.3f}", "-i", str(clip), "-frames:v", "1", "-q:v", "2", str(out)], timeout=60)
        if not out.is_file():
            continue
        score = _sharpness(Image.open(out))
        if score > best_score:
            best, best_score = out, score
    if best is None:
        raise EngineError(f"Could not read a frame from {clip.name}.")
    return best


def _results_photos(gc, rng: random.Random, recent: dict) -> tuple[Path | None, Path | None]:
    """Slide 1 from the results folder; slide 10 from the custom dead 'result' photos half the time."""
    from youry import clip_assembler as ca

    results = sorted(gc._collect_images(gc.PHOTOS_DIR / RESULTS_FOLDER), key=lambda p: p.name.lower())
    custom = [p for p in gc._collect_images(gc.PHOTOS_DIR / PACK) if _group_key(p) == "result"]
    first = ca.draw_from_deck(rng, results, "dead:results", 1, recent)
    use_custom = custom and (not results or rng.random() < CUSTOM_RESULT_SHARE)
    last = (
        ca.draw_from_deck(rng, custom, "dead:result", 1, recent)
        if use_custom
        else ca.draw_from_deck(rng, results, "dead:results", 1, recent, exclude=first)
    )
    return (first[0] if first else None), (last[0] if last else None)


def _photo_bg(gc, path: Path | None) -> Image.Image:
    if path is None:
        return Image.new("RGB", (gc.CANVAS_W, gc.CANVAS_H), (16, 16, 18))
    return gc._load_cover_augmented(path, gc.CANVAS_W, gc.CANVAS_H, "none")


def _pick_lines(rng: random.Random, options):
    return rng.choice(options) if isinstance(options, list) else options


def build_dead_frames_carousel(out_dir: Path, *, seed: int) -> CarouselResult:
    from youry import clip_assembler as ca

    gc = _engine()
    rng = random.Random(seed)
    broad = _clips(BROAD_DIR)
    product, branch, slides = _plan(rng, broad)

    recent = ca._load_recent()
    first_photo, last_photo = _results_photos(gc, rng, recent)
    clips: list[Path] = []
    windows: list[tuple[float, float]] = []
    for pools, _text in slides:
        weights = [len(paths) for _, paths, _ in pools]
        clip_key, paths, window = rng.choices(pools, weights=weights, k=1)[0]
        deck = f"dead_frames:{paths[0].parent.name}:{clip_key}"
        clips.append(ca.draw_from_deck(rng, paths, deck, 1, recent, exclude=clips)[0])
        windows.append(window)
    ca.save_recent(recent)

    work = out_dir / f"frames_{uuid.uuid4().hex[:10]}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        lines, anchor = SLIDE_LINES[0]
        rendered = [_render_slide(gc, _photo_bg(gc, first_photo), _pick_lines(rng, lines), anchor)]
        for clip, window, (_pools, (lines, anchor)) in zip(clips, windows, slides):
            frame = _grab_frame(clip, work, rng, window)
            bg = gc._load_cover_augmented(frame, gc.CANVAS_W, gc.CANVAS_H, "none")
            rendered.append(_render_slide(gc, bg, _pick_lines(rng, lines), anchor))
        lines, anchor = SLIDE_LINES[9]
        rendered.append(_render_slide(gc, _photo_bg(gc, last_photo), _pick_lines(rng, lines), anchor, rng.choice(END_CTAS)))
    finally:
        shutil.rmtree(work, ignore_errors=True)

    result = export_carousel(rendered, out_dir, rng, style="dead-frames")
    result.hook_preview = f"Workflow · {product} · {branch} · " + ", ".join(c.stem for c in clips)
    return result
