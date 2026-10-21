"""
"AI Dropshipping in 5 simple steps" carousel.

Hook and closing slide: white rounded label, black text, centered.
Each step: left-aligned title, site bullet, gray line, circular logo.
The tool shown on each step is picked at random from STEPS.

Logos live in carousel/assets/logos/steps (copied from the EcomEfficiency
tools logos, plus PayPal, Shopify, Stripe and Meta).

Backgrounds: hook and outro use two different sharp photos from photos/comment AI.
Each step uses one random photo from carousel/assets/photos/steps/<bg>/
(research, store, ads, marketing, payments), blurred and darkened so the text
stays readable. Every photo is tilted, cropped, regraded and has
pixels dropped so no two slides are identical. Empty folders use a dark tint.
"""

from __future__ import annotations

import math
import os
import random
import shutil
import uuid
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont

from .ee_carousel import CarouselResult, _engine
from .image_metadata import save_as_iphone_photo
from .video_metadata import pick_iphone

PACK = "steps"
BADGE_SIZE = 340
LOGO_DIR = Path(__file__).resolve().parents[1] / "carousel" / "assets" / "logos" / "steps"

# Wide wordmarks: keep only the symbol on the left, the name is already in the text.
ICON_ONLY: set[str] = set()

# Logos that read too small at the default size.
LOGO_SCALE = {"dropmagic.png": 1.05, "tiktok.png": 1.35, "youry.png": 1.3, "higgsfield.png": 1.2}

HOOKS = (
    "AI Dropshipping in 5 simple steps:",
    "AI Dropshipping in 5 easy steps:",
    "How to start AI Dropshipping in 5 steps:",
    "Start AI Dropshipping in 5 simple steps:",
)
OUTRO_KEYWORDS = ("AI", "Ecom")
OUTROS = (
    "Check captions",
    "Check captions to get started",
    "ecomefficiency.com to get started",
)
HOOK_TINT = (34, 38, 46)
OUTRO_TINT = (12, 14, 20)
# Hook and outro photos come from the shared photos/comment AI pack, shown sharp.
COMMENT_BG = "comment AI"
SHARP_BG = {COMMENT_BG}
BG_BLUR = 22
BG_DARKEN = 0.5
BG_DARKEN_BY_PACK: dict[str, float] = {}

FIND = "Find winning products"
POST = "Post the ads and scale your business"
PAID = "Receive payments"

# One entry per step: title, tint, then the tools it can show.
# logo is a file in LOGO_DIR.
STEPS = (
    {
        "title": "1. Product Research",
        "tint": (64, 70, 68),
        "bg": "research",
        "options": (
            {"site": "Kalodata.com", "desc": FIND, "logo": "kalodata.png"},
            {"site": "Pipiads.com", "desc": FIND, "logo": "pipiads.png"},
            {"site": "Dropship.io", "desc": FIND, "logo": "dropship.png"},
            {"site": "TikTok.com", "desc": "Search #tiktokmademebuyit", "logo": "tiktok.png"},
        ),
    },
    {
        "title": "2. Online Store",
        "tint": (24, 34, 54),
        "bg": "store",
        "options": (
            {"site": "Dropmagic.ai", "desc": "Fully build Shopify store in seconds", "logo": "dropmagic.png"},
            {"site": "WinningHunter.com", "desc": "Build your Shopify store with AI", "logo": "winninghunter.png"},
        ),
    },
    {
        "title": "3. Ads",
        "tint": (46, 48, 52),
        "bg": "ads",
        "options": (
            {"site": "Youry.io", "desc": "Generate AI UGC ads in minutes", "logo": "youry.png"},
            {"site": "Higgsfield.ai", "desc": "Generate AI UGC ads in minutes", "logo": "higgsfield.png"},
        ),
    },
    {
        "title": "4. Marketing",
        "tint": (96, 38, 64),
        "bg": "marketing",
        "options": (
            {"site": "TikTok.com", "desc": POST, "logo": "tiktok.png"},
            {"site": "Instagram.com", "desc": POST, "logo": "instagram.png"},
        ),
    },
    {
        "title": "5. Payments",
        "tint": (34, 60, 66),
        "bg": "payments",
        "options": (
            {"site": "PayPal.com", "desc": PAID, "logo": "paypal.png"},
            {"site": "Shopify Payments", "desc": PAID, "logo": "shopify.png"},
        ),
    },
)


def _win_fonts() -> Path:
    return Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"


def _ui_font(gc, size: int, weight: str = "semibold") -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    names = {
        "regular": ("segoeui.ttf", "arial.ttf", "TikTokSans-SemiBold.ttf"),
        "semibold": ("seguisb.ttf", "segoeuib.ttf", "TikTokSans-SemiBold.ttf"),
        "bold": ("segoeuib.ttf", "arialbd.ttf", "TikTokSans-Bold.ttf"),
    }[weight]
    for name in names:
        for folder in (_win_fonts(), gc.FONTS_DIR):
            try:
                return ImageFont.truetype(str(folder / name), size)
            except (OSError, IOError):
                continue
    return gc.get_tiktok_font(size)


def _text_size(text: str, font) -> tuple[int, int]:
    left, top, right, bottom = font.getbbox(text)
    return right - left, bottom - top


def _draw_text(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, font, fill: tuple) -> int:
    left, top, right, bottom = font.getbbox(text)
    draw.text((xy[0] - left, xy[1] - top), text, font=font, fill=fill)
    return bottom - top


def _circle(diameter: int, fill: tuple) -> Image.Image:
    image = Image.new("RGBA", (diameter, diameter), (0, 0, 0, 0))
    ImageDraw.Draw(image).ellipse((0, 0, diameter - 1, diameter - 1), fill=fill)
    return image


def _ink_mask(image: Image.Image, background: tuple | None) -> Image.Image:
    """Where the mark is, ignoring a flat backdrop or transparency."""
    if background is None:
        return image.getchannel("A").point(lambda a: 255 if a > 24 else 0)
    flat = Image.new("RGB", image.size, background[:3])
    r, g, b = ImageChops.difference(image.convert("RGB"), flat).split()
    diff = ImageChops.lighter(ImageChops.lighter(r, g), b)
    return diff.point(lambda v: 255 if v > 40 else 0)


def _icon_box(ink: Image.Image, box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    """Left symbol of a horizontal wordmark: stop at the first wide blank column gap."""
    left, top, right, bottom = box
    region = ink.crop(box)
    width, height = region.size
    pixels = region.load()
    min_gap = max(4, int(width * 0.02))
    blank = 0
    end = width
    for x in range(width):
        if any(pixels[x, y] for y in range(0, height, 2)):
            blank = 0
            continue
        blank += 1
        if blank >= min_gap:
            end = x - blank + 1
            break
    icon = ink.crop((left, top, left + end, bottom)).getbbox()
    if not icon:
        return box
    return (left + icon[0], top + icon[1], left + icon[2], top + icon[3])


def _file_badge(name: str) -> Image.Image:
    """Logo file on a circle. Logos on a solid colored square keep that color as the backdrop."""
    path = LOGO_DIR / name
    if not path.is_file():
        return _circle(BADGE_SIZE, (255, 255, 255, 255))
    image = Image.open(path).convert("RGBA")
    corner = image.getpixel((0, 0))
    background = None if corner[3] < 128 else corner
    colored = background is not None and min(background[:3]) < 200
    badge = _circle(BADGE_SIZE, (*background[:3], 255) if colored else (255, 255, 255, 255))

    ink = _ink_mask(image, background)
    box = ink.getbbox() or (0, 0, image.width, image.height)
    if name in ICON_ONLY:
        box = _icon_box(ink, box)
    mark = image.crop(box)
    # The mark's diagonal must fit inside the circle with some breathing room.
    diagonal = (mark.width ** 2 + mark.height ** 2) ** 0.5
    scale = min(BADGE_SIZE * 0.80 / diagonal, BADGE_SIZE * 0.62 / max(mark.size)) * LOGO_SCALE.get(name, 1.0)
    size = (max(1, int(mark.width * scale)), max(1, int(mark.height * scale)))
    mark = mark.resize(size, Image.Resampling.LANCZOS)
    layer = Image.new("RGBA", badge.size, (0, 0, 0, 0))
    layer.alpha_composite(mark, ((BADGE_SIZE - size[0]) // 2, (BADGE_SIZE - size[1]) // 2))
    clip = _circle(BADGE_SIZE, (255, 255, 255, 255)).getchannel("A")
    layer.putalpha(Image.composite(layer.getchannel("A"), Image.new("L", badge.size, 0), clip))
    badge.alpha_composite(layer)
    return badge


def _badge(gc, logo: str) -> Image.Image:
    return _file_badge(logo)


def _with_shadow(badge: Image.Image) -> Image.Image:
    pad = int(badge.width * 0.08)
    canvas = Image.new("RGBA", (badge.width + pad * 2, badge.height + pad * 2), (0, 0, 0, 0))
    shadow = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(shadow).ellipse(
        (pad, pad + 8, pad + badge.width, pad + badge.height + 8),
        fill=90,
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas.paste((0, 0, 0, 255), mask=shadow)
    canvas.alpha_composite(badge, (pad, pad))
    return canvas


def _pick_slides(rng: random.Random) -> list[dict]:
    """Hook, one random tool per step (no logo twice), outro."""
    slides: list[dict] = [{"kind": "pill", "text": rng.choice(HOOKS), "tint": HOOK_TINT, "bg": COMMENT_BG}]
    # Resolve steps in random order so a shared tool (TikTok) is not always taken by the first step.
    used: set[str] = set()
    choices: dict[int, dict] = {}
    for index in rng.sample(range(len(STEPS)), len(STEPS)):
        options = [opt for opt in STEPS[index]["options"] if opt["logo"] not in used] or list(STEPS[index]["options"])
        choices[index] = rng.choice(options)
        used.add(choices[index]["logo"])
    for index, step in enumerate(STEPS):
        slides.append({"kind": "step", "title": step["title"], "tint": step["tint"], "bg": step["bg"], **choices[index]})
    outro = rng.choice(OUTROS)
    slides.append({"kind": "pill", "text": outro, "tint": OUTRO_TINT, "bg": COMMENT_BG})
    return slides


def _uniquify(img: Image.Image, rng: random.Random) -> Image.Image:
    """Reused photos must never be pixel-identical: tilt, crop, regrade, drop pixels."""
    w, h = img.size

    # Tilt + zoom so the rotated corners stay outside the frame, then pan.
    angle = rng.choice((-1, 1)) * rng.uniform(1.0, 3.5)
    rad = math.radians(abs(angle))
    cover = math.cos(rad) + max(w / h, h / w) * math.sin(rad)
    zoom = cover * rng.uniform(1.03, 1.1)
    zw, zh = int(w * zoom), int(h * zoom)
    out = img.resize((zw, zh), Image.Resampling.LANCZOS).rotate(angle, Image.Resampling.BICUBIC)
    slack_x = int(w * (zoom / cover - 1) / 2)
    slack_y = int(h * (zoom / cover - 1) / 2)
    cx = zw // 2 + rng.randint(-slack_x, slack_x)
    cy = zh // 2 + rng.randint(-slack_y, slack_y)
    out = out.crop((cx - w // 2, cy - h // 2, cx - w // 2 + w, cy - h // 2 + h))

    # Colour grade: saturation, contrast, brightness, temperature, hue.
    out = ImageEnhance.Color(out).enhance(rng.uniform(0.85, 1.2))
    out = ImageEnhance.Contrast(out).enhance(rng.uniform(0.92, 1.1))
    out = ImageEnhance.Brightness(out).enhance(rng.uniform(0.94, 1.06))
    warm = rng.uniform(-0.08, 0.08)
    r, g, b = out.split()
    r = r.point(lambda x: max(0, min(255, int(x * (1 + warm)))))
    b = b.point(lambda x: max(0, min(255, int(x * (1 - warm)))))
    out = Image.merge("RGB", (r, g, b))
    hue_shift = rng.randint(-6, 6)
    if hue_shift:
        hh, ss, vv = out.convert("HSV").split()
        hh = hh.point(lambda x: (x + hue_shift) % 256)
        out = Image.merge("HSV", (hh, ss, vv)).convert("RGB")

    # Resample through a slightly smaller size, then drop random pixels.
    shrink = rng.uniform(0.97, 0.99)
    out = out.resize((int(w * shrink), int(h * shrink)), Image.Resampling.BILINEAR).resize((w, h), Image.Resampling.LANCZOS)
    pixels = out.load()
    for _ in range(int(w * h * rng.uniform(0.0015, 0.003))):
        x, y = rng.randrange(1, w - 1), rng.randrange(1, h - 1)
        pixels[x, y] = pixels[x + rng.choice((-1, 1)), y + rng.choice((-1, 1))]

    # Fine grain.
    noise = Image.effect_noise((w, h), rng.uniform(6, 12)).convert("RGB")
    return Image.blend(out, noise, rng.uniform(0.02, 0.04))


def _styled_bg(gc, path: Path, key: str, rng: random.Random) -> Image.Image:
    img = _uniquify(gc._load_cover_augmented(path, gc.CANVAS_W, gc.CANVAS_H, "none"), rng)
    if key in SHARP_BG:
        return img
    img = img.filter(ImageFilter.GaussianBlur(BG_BLUR))
    darken = BG_DARKEN_BY_PACK.get(key, BG_DARKEN)
    if darken <= 0:
        return img
    black = Image.new("RGB", img.size, (0, 0, 0))
    return Image.blend(img, black, darken)


def _bg_folder(gc, key: str) -> Path:
    return gc.PHOTOS_DIR / key if key == COMMENT_BG else gc.PHOTOS_DIR / PACK / key


def _backgrounds(gc, slides: list[dict], rng: random.Random) -> list[Image.Image]:
    from youry import clip_assembler as ca

    # One deck draw per folder, sized to how many slides use it, so a carousel never repeats a photo.
    needed: dict[str, int] = {}
    for spec in slides:
        needed[spec["bg"]] = needed.get(spec["bg"], 0) + 1
    recent = ca._load_recent()
    draws = {
        key: ca.draw_from_deck(
            rng,
            sorted(gc._collect_images(_bg_folder(gc, key)), key=lambda path: path.name.lower()),
            f"steps:{key}",
            count,
            recent,
        )
        for key, count in needed.items()
    }
    ca.save_recent(recent)

    frames: list[Image.Image] = []
    for spec in slides:
        key = spec["bg"]
        if draws[key]:
            frames.append(_styled_bg(gc, draws[key].pop(0), key, rng))
        else:
            frames.append(Image.new("RGB", (gc.CANVAS_W, gc.CANVAS_H), spec["tint"]))
    return frames


PILL_PAD = (34, 18)


def _pill_font(gc, text: str):
    max_width = gc.CANVAS_W - 120
    size = 54
    font = _ui_font(gc, size, "semibold")
    while size > 36 and _text_size(text, font)[0] > max_width - 72:
        size -= 2
        font = _ui_font(gc, size, "semibold")
    return font


def pill_height(gc, text: str) -> int:
    return _text_size(text, _pill_font(gc, text))[1] + PILL_PAD[1] * 2


def draw_pill(gc, overlay: Image.Image, text: str, y0: int | None = None) -> int:
    """TikTok-style white text box, centered horizontally. Returns its height."""
    font = _pill_font(gc, text)
    text_w, text_h = _text_size(text, font)
    pad_x, pad_y = PILL_PAD
    box_w = text_w + pad_x * 2
    box_h = text_h + pad_y * 2
    x0 = (gc.CANVAS_W - box_w) // 2
    if y0 is None:
        y0 = (gc.CANVAS_H - box_h) // 2
    draw = ImageDraw.Draw(overlay)
    draw.rounded_rectangle((x0, y0, x0 + box_w, y0 + box_h), radius=22, fill=(255, 255, 255, 255))
    _draw_text(draw, (x0 + pad_x, y0 + pad_y), text, font, (20, 20, 20, 255))
    return box_h


def _render_pill(gc, bg: Image.Image, text: str) -> Image.Image:
    overlay = Image.new("RGBA", bg.size, (0, 0, 0, 0))
    draw_pill(gc, overlay, text)
    return Image.alpha_composite(bg.convert("RGBA"), overlay).convert("RGB")


def _render_step(gc, bg: Image.Image, spec: dict) -> Image.Image:
    left = 84
    max_width = gc.CANVAS_W - left - 56
    title_font = _ui_font(gc, 78, "semibold")
    site_font = _ui_font(gc, 48, "regular")
    desc_font = _ui_font(gc, 42, "regular")
    while _text_size(spec["desc"], desc_font)[0] > max_width and desc_font.size > 30:
        desc_font = _ui_font(gc, desc_font.size - 2, "regular")
    while _text_size(spec["site"], site_font)[0] > max_width - 36 and site_font.size > 32:
        site_font = _ui_font(gc, site_font.size - 2, "regular")

    # Fixed line heights so "Meta Ads" and "Pipiads.com" sit at the same spacing.
    title_h = _text_size("Ag", title_font)[1]
    site_h = _text_size("Ag", site_font)[1]
    desc_h = _text_size("Ag", desc_font)[1]
    y = int(gc.CANVAS_H * 0.28)

    overlay = Image.new("RGBA", bg.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    _draw_text(draw, (left, y), spec["title"], title_font, (255, 255, 255, 255))
    y += title_h + 36
    bullet_r = 7
    bullet_cy = y + site_h // 2
    draw.ellipse(
        (left, bullet_cy - bullet_r, left + bullet_r * 2, bullet_cy + bullet_r),
        fill=(255, 255, 255, 255),
    )
    _draw_text(draw, (left + 28, y), spec["site"], site_font, (255, 255, 255, 255))
    y += site_h + 12
    _draw_text(draw, (left, y), spec["desc"], desc_font, (186, 190, 198, 255))
    y += desc_h + 72

    badge = _with_shadow(_badge(gc, spec["logo"]))
    overlay.alpha_composite(badge, (left - int(badge.width * 0.08), y))
    return Image.alpha_composite(bg.convert("RGBA"), overlay).convert("RGB")


def build_steps_carousel(out_dir: Path, *, seed: int) -> CarouselResult:
    gc = _engine()
    rng = random.Random(seed)
    specs = _pick_slides(rng)
    rendered = []
    for bg, spec in zip(_backgrounds(gc, specs, rng), specs):
        if spec["kind"] == "pill":
            rendered.append(_render_pill(gc, bg, spec["text"]))
        else:
            rendered.append(_render_step(gc, bg, spec))

    work = out_dir / f"carousel_{uuid.uuid4().hex[:10]}"
    work.mkdir(parents=True, exist_ok=True)
    taken_at = datetime.now().astimezone() - timedelta(minutes=rng.uniform(3, 25))
    first_number = rng.randint(1000, 9990 - len(rendered))
    device = pick_iphone(rng)
    slides: list[Path] = []
    for index, image in enumerate(rendered):
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

    zip_path = out_dir / f"ee_steps_{first_number}.zip"
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
        hook_preview=specs[0]["text"],
        avatar_pack="steps",
        avatar="",
        color="steps",
        style="steps",
    )
