"""
Best-business carousel — same stroke-text schema as the reference:

  1. hook question          background: business class
  2. Dropshipping ❌        background: lifestyle (upscale, not over the top)
  3. Trading ❌             background: lifestyle
  4. Affiliate marketing ❌ background: lifestyle
  5. AI Dropshipping ✅     background: business class
     bullets + Comment "AI"

White TikTok Sans Bold with a thick black outline (the font family used on
the JobShift carousel, drawn as on-photo stroke text instead of pills).
Only the hook wording varies. The three rejects and the winner stay fixed.
"""

from __future__ import annotations

import random
import shutil
import uuid
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .ee_carousel import CAPTIONS_FILE, CarouselResult, _engine
from .ee_steps import draw_pill, pill_height
from .ffmpeg_tools import EngineError
from .image_metadata import save_as_iphone_photo
from .video_metadata import pick_iphone

PHOTOS_DIR_NAME = "photos"
BUSINESS_PACK = "business_class"
LIFESTYLE_PACK = "lifestyle"

# Close variants of the reference hook. Two centered lines, same shape.
HOOKS = (
    ("Best business to start", "before 2026?"),
    ("Best business to start", "in 2026?"),
    ("Best business to launch", "before 2026?"),
    ("What business to start", "before 2026?"),
    ("The best business", "to start before 2026?"),
)

REJECTS = ("Dropshipping", "Trading", "Affiliate marketing")
WINNER = "AI Dropshipping"
# One wording is drawn per bullet so the winner slide is never word-for-word the same.
BULLET_VARIANTS = (
    ("- 97% profit margins", "- Up to 97% profit margins"),
    ("- Fully automated", "- 100% automated", "- Runs on autopilot"),
    ("- Low competition", "- Barely any competition"),
    ("- No start-up cost", "- No upfront cost", "- $0 to start"),
    ("- Can start at any age", "- Start at any age", "- Anyone can start"),
)
CTAS = (
    "Check captions",
    "Check captions to get started",
    "ecomefficiency.com to get started",
    "Comment \u2018AI\u2019",
    "Comment \u2018Ecom\u2019",
    "Comment \u2018AI\u2019 for the full guide",
    "Comment \u2018Ecom\u2019 for the full guide",
    "Comment \u2018AI\u2019 to get the full guide",
    "Comment \u2018Ecom\u2019 to get the full guide",
)

WHITE = (255, 255, 255, 255)
STROKE = (0, 0, 0, 255)

SIDE_MARGIN = 44
EMOJI_GAP = 16

# Same letter size as the dead carousel. Short labels must not grow past this,
# or "Trading" renders with a fatter outline than "Dropshipping is dead".
HEADLINE_SIZE = 86
HEADLINE_MIN = 58


def _bold_font(gc, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    path = gc.FONTS_DIR / "TikTokSans-Bold.ttf"
    try:
        return ImageFont.truetype(str(path), size)
    except (OSError, IOError):
        return gc.get_tiktok_font(size)


def _stroke_width(size: int) -> int:
    """Chunky TikTok outline, close to the reference sticker text."""
    return max(6, int(round(size * 0.09)))


def _line_metrics(gc, text: str, font, stroke_w: int) -> tuple[int, int]:
    """Ink size plus the outline, so lines never collide and never clip the edge."""
    emoji_size = int(getattr(font, "size", 64) * 0.92)
    width, height = gc._measure_mixed(text, font, emoji_size)
    if any(is_emoji for _part, is_emoji in gc._split_text_runs(text)):
        width += EMOJI_GAP
    if stroke_w:
        width += stroke_w * 2
        height += stroke_w
    return width, height


def _fit_font(gc, lines: list[str], start: int, minimum: int):
    max_width = gc.CANVAS_W - SIDE_MARGIN * 2
    size = start
    font = _bold_font(gc, size)
    while size > minimum:
        stroke_w = _stroke_width(size)
        widest = max(_line_metrics(gc, line, font, stroke_w)[0] for line in lines)
        if widest <= max_width:
            break
        size -= 2
        font = _bold_font(gc, size)
    return font, size


def _draw_stroked_line(
    gc,
    overlay: Image.Image,
    text: str,
    font,
    y: int,
    *,
    x: int | None = None,
    fill: tuple = WHITE,
    stroke: bool = True,
) -> int:
    """Draw one line. x=None centers it. Returns the y of the next line."""
    stroke_w = _stroke_width(font.size) if stroke else 0
    emoji_size = int(font.size * 0.92)
    _width, line_h = _line_metrics(gc, text, font, stroke_w)
    if x is None:
        x = (gc.CANVAS_W - _width) // 2 + stroke_w
    draw = ImageDraw.Draw(overlay)

    cursor = x
    emoji_slots: list[tuple[int, Image.Image | None, int]] = []
    for part, is_emoji in gc._split_text_runs(text):
        if is_emoji:
            if cursor != x:
                cursor += EMOJI_GAP
            em = gc._load_apple_emoji(part, emoji_size)
            slot_w = em.size[0] if em is not None else emoji_size
            emoji_slots.append((cursor, em, slot_w))
            cursor += slot_w
            continue
        left, top, right, bottom = gc._text_bbox(part, font)
        tw = right - left
        th = bottom - top
        ty = y + (line_h - th) // 2 - top
        tx = cursor - left
        if stroke:
            draw.text(
                (tx, ty),
                part,
                font=font,
                fill=fill,
                stroke_width=stroke_w,
                stroke_fill=STROKE,
            )
        else:
            draw.text((tx, ty), part, font=font, fill=fill)
        cursor += tw

    for slot_x, em, _slot_w in emoji_slots:
        if em is None:
            continue
        ey = y + (line_h - em.size[1]) // 2
        overlay.paste(em, (slot_x, ey), em)
    return y + line_h


def _blank_overlay(gc, bg: Image.Image) -> Image.Image:
    return Image.new("RGBA", (gc.CANVAS_W, gc.CANVAS_H), (0, 0, 0, 0))


def _composite(bg: Image.Image, overlay: Image.Image) -> Image.Image:
    return Image.alpha_composite(bg.convert("RGBA"), overlay).convert("RGB")


def _render_centered_lines(gc, bg: Image.Image, lines: list[str], start_size: int, minimum: int) -> Image.Image:
    font, _size = _fit_font(gc, lines, start_size, minimum)
    stroke_w = _stroke_width(font.size)
    heights = [_line_metrics(gc, line, font, stroke_w)[1] for line in lines]
    gap = max(4, stroke_w // 4)
    total = sum(heights) + gap * max(0, len(lines) - 1)
    y = (gc.CANVAS_H - total) // 2
    overlay = _blank_overlay(gc, bg)
    for line, height in zip(lines, heights):
        _draw_stroked_line(gc, overlay, line, font, y)
        y += height + gap
    return _composite(bg, overlay)


def _render_winner(gc, bg: Image.Image, bullets: tuple[str, ...], cta: str) -> Image.Image:
    title = f"{WINNER} ✅"
    title_font, _ = _fit_font(gc, [title], HEADLINE_SIZE, HEADLINE_MIN)
    bullet_font, _ = _fit_font(gc, list(bullets), 70, 48)

    title_stroke = _stroke_width(title_font.size)
    bullet_stroke = _stroke_width(bullet_font.size)
    title_h = _line_metrics(gc, title, title_font, title_stroke)[1]
    bullet_h = [_line_metrics(gc, line, bullet_font, bullet_stroke)[1] for line in bullets]
    button_h = pill_height(gc, cta)

    title_gap = 36
    bullet_gap = 8
    button_gap = 52
    total = (
        title_h
        + title_gap
        + sum(bullet_h)
        + bullet_gap * max(0, len(bullets) - 1)
        + button_gap
        + button_h
    )
    y = max(int(gc.CANVAS_H * 0.08), (gc.CANVAS_H - total) // 2)

    overlay = _blank_overlay(gc, bg)
    _draw_stroked_line(gc, overlay, title, title_font, y)
    y += title_h + title_gap
    # Dashes share one left edge; the whole column stays centered.
    column_w = max(_line_metrics(gc, line, bullet_font, bullet_stroke)[0] for line in bullets)
    bullet_x = (gc.CANVAS_W - column_w) // 2 + bullet_stroke
    for line, height in zip(bullets, bullet_h):
        _draw_stroked_line(gc, overlay, line, bullet_font, y, x=bullet_x)
        y += height + bullet_gap
    y += button_gap - bullet_gap

    draw_pill(gc, overlay, cta, y)
    return _composite(bg, overlay)


def _cover(gc, path: Path) -> Image.Image:
    return gc._load_cover_augmented(path, gc.CANVAS_W, gc.CANVAS_H, "none")


def _pack_photos(gc, pack: str) -> list[Path]:
    folder = gc.PHOTOS_DIR / pack
    return gc._collect_images(folder)


def build_best_business_carousel(out_dir: Path, *, seed: int) -> CarouselResult:
    gc = _engine()
    # Captions file is irrelevant here; _engine() still points the shared
    # module at the EE captions so a later tools carousel in the same process
    # keeps the right file.
    gc.CAPTIONS_FILE = CAPTIONS_FILE
    rng = random.Random(seed)

    business = _pack_photos(gc, BUSINESS_PACK)
    lifestyle = _pack_photos(gc, LIFESTYLE_PACK)
    if not business:
        raise EngineError(
            f"No business class photos in carousel/assets/photos/{BUSINESS_PACK}."
        )
    if not lifestyle:
        raise EngineError(
            f"No lifestyle photos in carousel/assets/photos/{LIFESTYLE_PACK}."
        )

    from youry import clip_assembler as ca

    hook = HOOKS[rng.randrange(len(HOOKS))]
    recent = ca._load_recent()
    business_picks = ca.draw_from_deck(rng, business, "best_business:business", 2, recent)
    lifestyle_picks = ca.draw_from_deck(rng, lifestyle, "best_business:lifestyle", len(REJECTS), recent)
    ca.save_recent(recent)

    slides_img = [
        _render_centered_lines(
            gc, _cover(gc, business_picks[0]), list(hook), HEADLINE_SIZE, HEADLINE_MIN
        ),
    ]
    for label, photo in zip(REJECTS, lifestyle_picks):
        slides_img.append(
            _render_centered_lines(
                gc, _cover(gc, photo), [f"{label} ❌"], HEADLINE_SIZE, HEADLINE_MIN
            )
        )
    bullets = tuple(rng.choice(options) for options in BULLET_VARIANTS)
    cta = rng.choice(CTAS)
    slides_img.append(_render_winner(gc, _cover(gc, business_picks[1]), bullets, cta))

    work = out_dir / f"carousel_{uuid.uuid4().hex[:10]}"
    work.mkdir(parents=True, exist_ok=True)
    taken_at = datetime.now().astimezone() - timedelta(minutes=rng.uniform(3, 25))
    first_number = rng.randint(1000, 9990 - len(slides_img))
    device = pick_iphone(rng)
    slides: list[Path] = []
    for index, image in enumerate(slides_img):
        slides.append(
            save_as_iphone_photo(
                image,
                work,
                rng=rng,
                taken_at=taken_at + timedelta(seconds=index * rng.uniform(4, 14)),
                file_number=first_number + index,
                device=device,
            )
        )

    zip_path = out_dir / f"ee_best_business_{first_number}.zip"
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
        hook_preview=" ".join(hook),
        avatar_pack="best-business",
        avatar=business_picks[0].name,
        color="stroke",
        style="best-business",
    )
