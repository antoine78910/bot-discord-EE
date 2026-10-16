"""
Subtle per-export variations so every carousel slide / video is pixel-unique
without visible quality loss: colorimetry (white balance, saturation, contrast,
gamma, hue), axis (micro rotation + zoom + offset) and a faint static grain.
"""

from __future__ import annotations

import math
import random

from PIL import Image, ImageChops, ImageEnhance

MAX_ROTATION_DEG = 0.35


def cover_scale(width: int, height: int, angle_rad: float) -> float:
    """Minimum zoom so a rotated frame still covers the whole canvas (no borders)."""
    c, s = abs(math.cos(angle_rad)), abs(math.sin(angle_rad))
    return max(c + s * height / width, c + s * width / height)


def vary_image(image: Image.Image, rng: random.Random) -> Image.Image:
    img = image.convert("RGB")
    width, height = img.size

    # Colorimetry: tiny white-balance shift + saturation / contrast / brightness.
    warm = rng.uniform(-0.018, 0.018)
    r, g, b = img.split()
    r = r.point(lambda v: min(255, round(v * (1 + warm))))
    b = b.point(lambda v: min(255, round(v * (1 - warm))))
    img = Image.merge("RGB", (r, g, b))
    img = ImageEnhance.Color(img).enhance(rng.uniform(0.95, 1.06))
    img = ImageEnhance.Contrast(img).enhance(rng.uniform(0.97, 1.04))
    img = ImageEnhance.Brightness(img).enhance(rng.uniform(0.98, 1.025))

    # Axis: one affine resample (rotation + cover zoom + small offset).
    angle = math.radians(rng.uniform(-MAX_ROTATION_DEG, MAX_ROTATION_DEG))
    need = cover_scale(width, height, angle)
    scale = need + rng.uniform(0.004, 0.014)
    slack = (scale - need) * min(width, height) / 2
    tx, ty = rng.uniform(-slack, slack), rng.uniform(-slack, slack)
    cx, cy = width / 2, height / 2
    cos_a, sin_a = math.cos(angle) / scale, math.sin(angle) / scale
    a, bb, d, e = cos_a, -sin_a, sin_a, cos_a
    img = img.transform(
        (width, height),
        Image.Transform.AFFINE,
        (a, bb, cx - a * cx - bb * cy + tx, d, e, cy - d * cx - e * cy + ty),
        resample=Image.Resampling.BICUBIC,
    )

    # Pixels: faint gaussian grain (sigma 1-2 levels), invisible at JPEG q95.
    grain = Image.effect_noise((width, height), rng.uniform(1.0, 2.0)).convert("RGB")
    return ImageChops.add(img, grain, scale=1.0, offset=-128)


def video_variation_filter(rng: random.Random) -> str:
    """Extra FFmpeg filters (hue / gamma / static grain) appended after the existing eq/rotate/scale."""
    return (
        f"hue=h={rng.uniform(-4.0, 4.0):.2f}:s={rng.uniform(0.97, 1.04):.3f},"
        f"eq=gamma={rng.uniform(0.97, 1.03):.3f},"
        f"noise=all_seed={rng.randint(1, 2**30)}:alls={rng.uniform(1.0, 2.2):.2f}:allf=u"
    )
