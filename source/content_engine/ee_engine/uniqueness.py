"""
Subtle per-export variations so every carousel slide / video is pixel-unique
without visible quality loss: colorimetry (white balance, saturation, contrast,
gamma, hue), axis (micro rotation + zoom + offset) and a faint static grain.
"""

from __future__ import annotations

import math
import random

from PIL import Image, ImageChops, ImageEnhance

MAX_ROTATION_DEG = 0.6  # Increased from 0.35 for more variation


def cover_scale(width: int, height: int, angle_rad: float) -> float:
    """Minimum zoom so a rotated frame still covers the whole canvas (no borders)."""
    c, s = abs(math.cos(angle_rad)), abs(math.sin(angle_rad))
    return max(c + s * height / width, c + s * width / height)


def vary_image(image: Image.Image, rng: random.Random) -> Image.Image:
    img = image.convert("RGB")
    width, height = img.size

    # Colorimetry: tiny white-balance shift + saturation / contrast / brightness.
    # More aggressive for better uniqueness on social platforms
    warm = rng.uniform(-0.035, 0.035)  # Increased from -0.018, 0.018
    r, g, b = img.split()
    r = r.point(lambda v: min(255, round(v * (1 + warm))))
    b = b.point(lambda v: min(255, round(v * (1 - warm))))
    img = Image.merge("RGB", (r, g, b))
    img = ImageEnhance.Color(img).enhance(rng.uniform(0.92, 1.10))  # Increased range
    img = ImageEnhance.Contrast(img).enhance(rng.uniform(0.95, 1.06))  # Increased range
    img = ImageEnhance.Brightness(img).enhance(rng.uniform(0.96, 1.04))  # Increased range

    # Axis: one affine resample (rotation + cover zoom + small offset).
    # More aggressive variations for better uniqueness
    angle = math.radians(rng.uniform(-MAX_ROTATION_DEG, MAX_ROTATION_DEG))
    need = cover_scale(width, height, angle)
    scale = need + rng.uniform(0.008, 0.025)  # Increased zoom range
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

    # Pixels: faint gaussian grain (sigma 1-3 levels), invisible at JPEG q95.
    # Increased grain for more variation
    grain = Image.effect_noise((width, height), rng.uniform(1.5, 3.0)).convert("RGB")  # Increased range
    return ImageChops.add(img, grain, scale=1.0, offset=-128)


def video_variation_filter(rng: random.Random) -> str:
    """Extra FFmpeg filters (hue / gamma) for uniqueness.

    Avoid the libavfilter `noise` filter — it is extremely slow on Railway
    (multi-minute encodes for short clips). Hue/eq + the caller’s rotate/crop
    already change the fingerprint enough for social re-uploads.
    """
    return (
        f"hue=h={rng.uniform(-8.0, 8.0):.2f}:s={rng.uniform(0.94, 1.08):.3f},"
        f"eq=gamma={rng.uniform(0.94, 1.06):.3f}"
    )
