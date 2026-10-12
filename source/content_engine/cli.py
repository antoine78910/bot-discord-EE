"""
EE content engine CLI — called by the Discord bot (contentStudio.js).

    python cli.py status
    python cli.py video --count 2 --out /tmp/job
    python cli.py carousel --count 1 --avatar femme_noir --out /tmp/job
    python cli.py cleanvideo --input in.mp4 --out /tmp/job

Prints exactly one JSON object on stdout: {"ok": bool, "items": [...], "errors": [...]}.
Progress lines go to stderr.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ee_engine.ffmpeg_tools import EngineError, ffmpeg_available, resolve_ffmpeg_bin  # noqa: E402

MAX_COUNT = 5
DEFAULT_MAX_MB = float(os.getenv("CONTENT_UPLOAD_LIMIT_MB", "9.5"))


def _log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def _seed() -> int:
    return random.SystemRandom().randint(0, 2**31 - 1)


def cmd_status(_args) -> dict:
    from ee_engine.ee_carousel import avatar_packs, color_names
    from ee_engine.ee_video import list_hooks, pick_captions

    return {
        "ok": True,
        "items": [],
        "errors": [],
        "status": {
            "ffmpeg": resolve_ffmpeg_bin() or "",
            "hooks": len(list_hooks()),
            "avatar_packs": avatar_packs(),
            "colors": color_names(),
            "sample_caption": pick_captions(1)[0],
        },
    }


def cmd_video(args) -> dict:
    from ee_engine.ee_video import pick_captions, render_ee_video

    if not ffmpeg_available():
        raise EngineError("FFmpeg not found on the bot host.")
    count = max(1, min(MAX_COUNT, args.count))
    captions = [args.caption] * count if args.caption else pick_captions(count)
    items, errors = [], []
    for index, caption in enumerate(captions, start=1):
        _log(f"[video {index}/{count}] {caption}")
        try:
            result = render_ee_video(
                args.out,
                caption=caption,
                seed=_seed(),
                max_bytes=int(args.max_mb * 1024 * 1024),
                iphone_signature=not args.no_iphone,
            )
            items.append(result.to_json())
        except Exception as exc:
            errors.append(f"Video {index} failed: {exc}")
            _log(traceback.format_exc())
    return {"ok": bool(items), "items": items, "errors": errors}


def cmd_carousel(args) -> dict:
    from ee_engine.ee_carousel import build_ee_carousel

    count = max(1, min(MAX_COUNT, args.count))
    items, errors = [], []
    for index in range(1, count + 1):
        _log(f"[carousel {index}/{count}]")
        try:
            result = build_ee_carousel(
                args.out / f"carousel_{index}",
                seed=_seed(),
                avatar_pack=args.avatar,
                color=args.color,
            )
            items.append(result.to_json())
        except Exception as exc:
            errors.append(f"Carousel {index} failed: {exc}")
            _log(traceback.format_exc())
    return {"ok": bool(items), "items": items, "errors": errors}


def cmd_cleanvideo(args) -> dict:
    from ee_engine.ffmpeg_tools import compress_to_size
    from ee_engine.video_metadata import (
        clean_and_vary_video,
        inject_iphone_signature,
        variation_summary,
    )

    seed = _seed()
    rng = random.Random(seed)
    result = clean_and_vary_video(
        args.input,
        args.out / "clean.mp4",
        seed=seed,
        apply_variation=not args.no_variation,
    )
    final = compress_to_size(result.output_path, int(args.max_mb * 1024 * 1024))
    number = rng.randint(1000, 9999)
    if args.no_iphone:
        target = args.out / f"IMG_{number:04d}.mp4"
        final.rename(target)
    else:
        target = inject_iphone_signature(final, args.out / f"IMG_{number:04d}.MOV", seed=seed)
        final.unlink(missing_ok=True)
    return {
        "ok": True,
        "items": [
            {
                "type": "cleanvideo",
                "path": str(target),
                "tags_removed": result.tags_removed,
                "variation": variation_summary(result.variation) if not args.no_variation else "",
                "duration_before": round(result.duration_before, 2),
                "duration_after": round(result.duration_after, 2),
            }
        ],
        "errors": [],
    }


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="EE content engine")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("status")

    video = sub.add_parser("video")
    video.add_argument("--count", type=int, default=1)
    video.add_argument("--caption", default="")
    video.add_argument("--out", type=Path, required=True)
    video.add_argument("--max-mb", type=float, default=DEFAULT_MAX_MB)
    video.add_argument("--no-iphone", action="store_true")

    carousel = sub.add_parser("carousel")
    carousel.add_argument("--count", type=int, default=1)
    carousel.add_argument("--avatar", default=None)
    carousel.add_argument("--color", default=None)
    carousel.add_argument("--out", type=Path, required=True)

    clean = sub.add_parser("cleanvideo")
    clean.add_argument("--input", type=Path, required=True)
    clean.add_argument("--out", type=Path, required=True)
    clean.add_argument("--max-mb", type=float, default=DEFAULT_MAX_MB)
    clean.add_argument("--no-variation", action="store_true")
    clean.add_argument("--no-iphone", action="store_true")

    args = parser.parse_args()
    if getattr(args, "out", None) is not None:
        args.out.mkdir(parents=True, exist_ok=True)

    handlers = {
        "status": cmd_status,
        "video": cmd_video,
        "carousel": cmd_carousel,
        "cleanvideo": cmd_cleanvideo,
    }
    try:
        payload = handlers[args.command](args)
    except Exception as exc:
        _log(traceback.format_exc())
        payload = {"ok": False, "items": [], "errors": [str(exc)]}

    print(json.dumps(payload, ensure_ascii=False))
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
