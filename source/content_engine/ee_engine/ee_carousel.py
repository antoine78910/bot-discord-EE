"""
EE carousel (5 slides) on top of the JobShift carousel engine.

  1. avatar photo + hook
  2. photo + step 1 (find a winner)      + find_app logo card
  3. photo + step 2 (AI store)           + create_store_app logo card
  4. photo + step 3 (AI UGC)             + create_ai_ugc_app logo card
  5. photo + recap (Ecom Efficiency CTA) + allinoneapp (EE) logo card

Slides are exported as IMG_####.JPG with an iPhone 15 Pro EXIF signature,
plus a ZIP with the untouched files (Discord previews are recompressed).
"""

from __future__ import annotations

import random
import shutil
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

from . import ENGINE_ROOT
from .ffmpeg_tools import EngineError
from .image_metadata import save_as_iphone_photo

CAPTIONS_FILE = ENGINE_ROOT / "carousel" / "ee_carousel_captions.txt"
LOGOS_DIR = ENGINE_ROOT / "variator" / "assets"
DEFAULT_AVATAR_PACK = "femme_noir"
DEFAULT_COLOR = "purple"

EE_STYLES = {
    "purple": {
        "box_bg": (226, 214, 255),
        "box_text": (98, 44, 214),
        "highlight_text": (255, 255, 255),
        "emphasis_bg": (255, 255, 255),
        "emphasis_text": (0, 0, 0),
    },
}

STEP_SLIDES = (
    ("step1", "find_app"),
    ("step2", "create_store_app"),
    ("step3", "create_ai_ugc_app"),
    ("recap", "allinoneapp"),
)

FONT_BOOST = 1.25
CARD_GAP = 70
CARD_MAX = 540
CARD_RADIUS = 64
LOGO_FILL = 0.66


@dataclass
class CarouselResult:
    slides: list[Path]
    zip_path: Path
    hook_preview: str
    avatar_pack: str
    avatar: str
    color: str

    def to_json(self) -> dict:
        return {
            "type": "carousel",
            "slides": [str(p) for p in self.slides],
            "zip": str(self.zip_path),
            "hook": self.hook_preview,
            "avatar_pack": self.avatar_pack,
            "avatar": self.avatar,
            "color": self.color,
        }


def _engine():
    from carousel import generate_carousel as gc

    gc.CAPTIONS_FILE = CAPTIONS_FILE
    for name, style in EE_STYLES.items():
        gc.TIKTOK_STYLE.setdefault(name, style)
    return gc


def avatar_packs() -> list[str]:
    return _engine()._list_avatar_packs()


def color_names() -> list[str]:
    return sorted(_engine().TIKTOK_STYLE)


def _logo_paths(folder: str) -> list[Path]:
    root = LOGOS_DIR / folder
    if not root.is_dir():
        return []
    return sorted(
        p for p in root.iterdir()
        if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
    )


def _trim_logo(path: Path) -> Image.Image:
    """Crop the white/transparent margin around a 2000x2000 logo canvas."""
    logo = Image.open(path).convert("RGBA")
    rgb = Image.new("RGB", logo.size, (255, 255, 255))
    rgb.paste(logo, mask=logo.split()[3])
    ink = rgb.point(lambda v: 255 if v < 238 else 0).convert("L")
    bbox = ink.getbbox()
    if bbox:
        pad = int(max(bbox[2] - bbox[0], bbox[3] - bbox[1]) * 0.06)
        bbox = (
            max(0, bbox[0] - pad),
            max(0, bbox[1] - pad),
            min(logo.width, bbox[2] + pad),
            min(logo.height, bbox[3] + pad),
        )
        logo = logo.crop(bbox)
    return logo


def _logo_card(logo_path: Path, size: int) -> Image.Image:
    """White rounded app-icon card with a soft shadow, logo centered."""
    shadow_pad = int(size * 0.12)
    canvas = Image.new("RGBA", (size + shadow_pad * 2, size + shadow_pad * 2), (0, 0, 0, 0))

    shadow = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(shadow).rounded_rectangle(
        [shadow_pad, shadow_pad + int(size * 0.03), shadow_pad + size, shadow_pad + size + int(size * 0.03)],
        radius=CARD_RADIUS,
        fill=120,
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(int(size * 0.05)))
    canvas.paste(Image.new("RGBA", canvas.size, (0, 0, 0, 255)), mask=shadow)

    card = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=CARD_RADIUS, fill=255)

    logo = _trim_logo(logo_path)
    inner = int(size * LOGO_FILL)
    scale = min(inner / logo.width, inner / logo.height)
    logo = logo.resize((max(1, int(logo.width * scale)), max(1, int(logo.height * scale))), Image.Resampling.LANCZOS)
    card.paste(logo, ((size - logo.width) // 2, (size - logo.height) // 2), logo)

    canvas.paste(card, (shadow_pad, shadow_pad), mask)
    return canvas


def _pinned_text_bottom(gc, lines) -> int:
    blocks = gc._layout_blocks(lines, font_boost=FONT_BOOST)
    top = int(gc.CANVAS_H * gc.TOP_MARGIN)
    return top + min(gc._stack_height(blocks), int(gc.CANVAS_H * 0.55))


def _paste_card(slide: Image.Image, gc, lines, logo_path: Path) -> Image.Image:
    text_bottom = _pinned_text_bottom(gc, lines)
    bottom_limit = int(gc.CANVAS_H * 0.9)
    room = bottom_limit - (text_bottom + CARD_GAP)
    size = min(CARD_MAX, room)
    if size < 220:
        return slide
    card = _logo_card(logo_path, size)
    x = (gc.CANVAS_W - card.width) // 2
    y = text_bottom + CARD_GAP + max(0, (room - size) // 2) - (card.height - size) // 2
    out = slide.convert("RGBA")
    out.alpha_composite(card, (x, max(0, y)))
    return out.convert("RGB")


def build_ee_carousel(
    out_dir: Path,
    *,
    seed: int,
    avatar_pack: str | None = None,
    color: str | None = None,
) -> CarouselResult:
    gc = _engine()
    random.seed(seed)
    rng = random.Random(seed)

    pack = (avatar_pack or DEFAULT_AVATAR_PACK).strip() or DEFAULT_AVATAR_PACK
    if pack not in gc._list_avatar_packs():
        raise EngineError(f"Unknown avatar pack `{pack}`. Available: {', '.join(gc._list_avatar_packs())}.")
    avatars = gc._collect_images(gc._avatar_pack_dir(pack))
    photos = gc._collect_photos(None, avatar_pack=pack)
    if not avatars:
        raise EngineError(f"No avatar photos in pack `{pack}`.")
    if len(photos) < 1:
        raise EngineError("No background photos in carousel/assets/photos.")

    theme = color if color in gc.TIKTOK_STYLE else DEFAULT_COLOR
    style = gc.TIKTOK_STYLE[theme]

    work = out_dir / f"carousel_{uuid.uuid4().hex[:10]}"
    work.mkdir(parents=True, exist_ok=True)
    rendered: list[Image.Image] = []

    hook_lines = gc._pick_caption_set("hooks")
    avatar_path = rng.choice(avatars)
    avatar_bg = gc._load_cover_augmented(avatar_path, gc.CANVAS_W, gc.CANVAS_H, "none")
    rendered.append(gc.render_slide_with_text(avatar_bg, hook_lines, style, font_boost=FONT_BOOST))

    pool = photos[:]
    rng.shuffle(pool)
    while len(pool) < len(STEP_SLIDES):
        pool.extend(photos)

    for (section, logo_folder), photo in zip(STEP_SLIDES, pool):
        lines = gc._pick_caption_set(section)
        bg = gc._load_cover_augmented(photo, gc.CANVAS_W, gc.CANVAS_H, "none")
        slide = gc.render_slide_with_text(bg, lines, style, font_boost=FONT_BOOST)
        logos = _logo_paths(logo_folder)
        if logos:
            slide = _paste_card(slide, gc, lines, rng.choice(logos))
        rendered.append(slide)

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

    zip_path = out_dir / f"ee_carousel_{first_number}.zip"
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
        hook_preview=gc._caption_preview(hook_lines),
        avatar_pack=pack,
        avatar=avatar_path.name,
        color=theme,
    )
