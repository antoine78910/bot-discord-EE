"""Save images as fresh iPhone 15 Pro photos (clean JPEG + plausible EXIF)."""

from __future__ import annotations

import random
from datetime import datetime, timedelta
from pathlib import Path

from PIL import Image
from PIL.TiffImagePlugin import IFDRational

from .video_metadata import IPHONE_MAKE, IPHONE_MODEL, IPHONE_SOFTWARE

_EXIF_IFD = 0x8769
_TAG_MAKE = 0x010F
_TAG_MODEL = 0x0110
_TAG_ORIENTATION = 0x0112
_TAG_SOFTWARE = 0x0131
_TAG_DATETIME = 0x0132
_TAG_HOST_COMPUTER = 0x013C
_TAG_EXPOSURE_TIME = 0x829A
_TAG_FNUMBER = 0x829D
_TAG_ISO = 0x8827
_TAG_DATETIME_ORIGINAL = 0x9003
_TAG_DATETIME_DIGITIZED = 0x9004
_TAG_OFFSET_TIME = 0x9010
_TAG_OFFSET_TIME_ORIGINAL = 0x9011
_TAG_OFFSET_TIME_DIGITIZED = 0x9012
_TAG_SUBSEC_ORIGINAL = 0x9291
_TAG_FOCAL_LENGTH = 0x920A
_TAG_COLOR_SPACE = 0xA001
_TAG_FOCAL_LENGTH_35MM = 0xA405
_TAG_LENS_MAKE = 0xA433
_TAG_LENS_MODEL = 0xA434

_LENSES = (
    ("iPhone 15 Pro back triple camera 6.765mm f/1.78", 6.765, 1.78, 24),
    ("iPhone 15 Pro back triple camera 2.22mm f/2.2", 2.22, 2.2, 13),
    ("iPhone 15 Pro back triple camera 9.03mm f/2.8", 9.03, 2.8, 77),
)


def _offset(dt: datetime) -> str:
    raw = dt.strftime("%z") or "+0000"
    return f"{raw[:3]}:{raw[3:]}"


def iphone_exif(rng: random.Random, taken_at: datetime) -> Image.Exif:
    lens_model, focal, fnumber, focal_35 = rng.choice(_LENSES)
    stamp = taken_at.strftime("%Y:%m:%d %H:%M:%S")
    offset = _offset(taken_at)

    exif = Image.Exif()
    exif[_TAG_MAKE] = IPHONE_MAKE
    exif[_TAG_MODEL] = IPHONE_MODEL
    exif[_TAG_ORIENTATION] = 1
    exif[_TAG_SOFTWARE] = IPHONE_SOFTWARE
    exif[_TAG_DATETIME] = stamp
    exif[_TAG_HOST_COMPUTER] = IPHONE_MODEL

    ifd = exif.get_ifd(_EXIF_IFD)
    ifd[_TAG_EXPOSURE_TIME] = IFDRational(1, rng.choice([60, 100, 120, 125, 200, 250]))
    ifd[_TAG_FNUMBER] = IFDRational(int(fnumber * 100), 100)
    ifd[_TAG_ISO] = rng.choice([40, 50, 64, 80, 100, 125, 160, 200])
    ifd[_TAG_DATETIME_ORIGINAL] = stamp
    ifd[_TAG_DATETIME_DIGITIZED] = stamp
    ifd[_TAG_OFFSET_TIME] = offset
    ifd[_TAG_OFFSET_TIME_ORIGINAL] = offset
    ifd[_TAG_OFFSET_TIME_DIGITIZED] = offset
    ifd[_TAG_SUBSEC_ORIGINAL] = f"{rng.randint(0, 999):03d}"
    ifd[_TAG_FOCAL_LENGTH] = IFDRational(int(focal * 1000), 1000)
    ifd[_TAG_COLOR_SPACE] = 65535
    ifd[_TAG_FOCAL_LENGTH_35MM] = focal_35
    ifd[_TAG_LENS_MAKE] = IPHONE_MAKE
    ifd[_TAG_LENS_MODEL] = lens_model
    return exif


def save_as_iphone_photo(
    image: Image.Image,
    dest_dir: Path,
    *,
    rng: random.Random,
    taken_at: datetime | None = None,
    file_number: int | None = None,
) -> Path:
    """Write image as IMG_####.JPG with only iPhone EXIF (no other metadata carried over)."""
    if taken_at is None:
        taken_at = datetime.now().astimezone() - timedelta(seconds=rng.uniform(40, 900))
    if file_number is None:
        file_number = rng.randint(1000, 9999)

    dest_dir.mkdir(parents=True, exist_ok=True)
    path = dest_dir / f"IMG_{file_number:04d}.JPG"
    clean = Image.new("RGB", image.size)
    clean.paste(image.convert("RGB"))
    clean.save(
        path,
        "JPEG",
        quality=95,
        subsampling=0,
        exif=iphone_exif(rng, taken_at).tobytes(),
    )
    return path
