"""
Copy generator assets from the local source projects into this engine.

    python sync_assets.py                      # default Bureau folders
    python sync_assets.py --bureau "D:/Bureau" # other root

Sources:
  Variator/          templates, layouts, step logos, fonts, audio, captions.txt
  bot youry/         clip_assembler.py + assets/clips (hooks, hooks_text, body, music)
  bot jelly/carousel carousel engine, fonts, emoji, photos, avatars

Avatars are re-saved as high-quality JPEG (the carousel canvas is 1080x1920,
so the large RGBA PNG sources only add weight to the repo and image).
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from PIL import Image

ENGINE_ROOT = Path(__file__).resolve().parent
DEFAULT_BUREAU = Path.home() / "OneDrive" / "Bureau"

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
AUDIO_EXTS = {".mp3", ".m4a", ".wav", ".aac"}
VIDEO_EXTS = {".mp4", ".mov", ".m4v"}
AVATAR_MAX_EDGE = 1600


def _copy_tree(src: Path, dest: Path, exts: set[str] | None = None) -> int:
    if not src.is_dir():
        print(f"  ! missing {src}")
        return 0
    count = 0
    for path in src.rglob("*"):
        if not path.is_file() or path.name.startswith("."):
            continue
        if exts is not None and path.suffix.lower() not in exts:
            continue
        target = dest / path.relative_to(src)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        count += 1
    return count


def _copy_files(src_dir: Path, pattern: str, dest: Path) -> int:
    dest.mkdir(parents=True, exist_ok=True)
    count = 0
    for path in sorted(src_dir.glob(pattern)):
        if path.is_file():
            shutil.copy2(path, dest / path.name)
            count += 1
    return count


def _save_avatar(src: Path, dest_dir: Path) -> None:
    with Image.open(src) as im:
        im = im.convert("RGB")
        w, h = im.size
        scale = min(1.0, AVATAR_MAX_EDGE / max(w, h))
        if scale < 1.0:
            im = im.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
        dest_dir.mkdir(parents=True, exist_ok=True)
        im.save(dest_dir / f"{src.stem}.jpg", "JPEG", quality=94, optimize=True)


def sync_variator(bureau: Path) -> None:
    src = bureau / "Variator"
    dest = ENGINE_ROOT / "variator"
    print(f"Variator <- {src}")
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src / "generate.py", dest / "generate.py")
    shutil.copy2(src / "captions.txt", dest / "captions.txt")
    print(f"  templates: {_copy_files(src, 'template*.png', dest)}")
    print(f"  layouts:   {_copy_files(src, 'layout*.json', dest)}")
    print(f"  assets:    {_copy_tree(src / 'assets', dest / 'assets', IMAGE_EXTS)}")
    print(f"  fonts:     {_copy_tree(src / 'fonts', dest / 'fonts', {'.ttf', '.otf', '.ttc'})}")
    print(f"  audio:     {_copy_tree(src / 'audio_path', dest / 'audio_path', AUDIO_EXTS)}")


def sync_youry(bureau: Path) -> None:
    src = bureau / "bot youry"
    dest = ENGINE_ROOT / "youry"
    print(f"YouRy <- {src}")
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src / "clip_assembler.py", dest / "clip_assembler.py")
    clips_src, clips_dest = src / "assets" / "clips", dest / "assets" / "clips"
    print(f"  hooks:      {_copy_tree(clips_src / 'hooks', clips_dest / 'hooks', VIDEO_EXTS)}")
    print(f"  hooks_text: {_copy_tree(clips_src / 'hooks_text', clips_dest / 'hooks_text', IMAGE_EXTS | VIDEO_EXTS)}")
    print(f"  body:       {_copy_tree(clips_src / 'body', clips_dest / 'body', VIDEO_EXTS)}")
    print(f"  music:      {_copy_tree(clips_src / 'music', clips_dest / 'music', AUDIO_EXTS)}")


def sync_carousel(bureau: Path) -> None:
    src = bureau / "bot jelly" / "carousel"
    dest = ENGINE_ROOT / "carousel"
    print(f"Carousel <- {src}")
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src / "generate_carousel.py", dest / "generate_carousel.py")
    print(f"  fonts:  {_copy_tree(src / 'fonts', dest / 'fonts', {'.ttf', '.otf', '.ttc'})}")
    print(f"  emoji:  {_copy_tree(src / 'assets' / 'emoji', dest / 'assets' / 'emoji', IMAGE_EXTS)}")
    print(f"  photos: {_copy_tree(src / 'assets' / 'photos', dest / 'assets' / 'photos', IMAGE_EXTS)}")

    avatars_src = src / "assets" / "avatars"
    avatars_dest = dest / "assets" / "avatars"
    count = 0
    for path in sorted(avatars_src.rglob("*")):
        if path.is_file() and path.suffix.lower() in IMAGE_EXTS:
            _save_avatar(path, avatars_dest / path.parent.relative_to(avatars_src))
            count += 1
    print(f"  avatars: {count} (re-saved as JPEG)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync EE content engine assets")
    parser.add_argument("--bureau", type=Path, default=DEFAULT_BUREAU)
    parser.add_argument(
        "--only",
        choices=("variator", "youry", "carousel"),
        help="Sync a single source",
    )
    args = parser.parse_args()

    steps = {
        "variator": sync_variator,
        "youry": sync_youry,
        "carousel": sync_carousel,
    }
    for name, step in steps.items():
        if args.only and args.only != name:
            continue
        step(args.bureau)
    print("Done.")


if __name__ == "__main__":
    main()
