"""
EE content engine CLI — called by the Discord bot (contentStudio.js).

    python cli.py status
    python cli.py variator --count 2 --out /tmp/job
    python cli.py youry --count 2 --out /tmp/job
    python cli.py workflow --count 2 [--workflow dropshipping] [--product printer] --out /tmp/job
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
    from ee_engine.videos import pick_captions, variator_status, youry_status
    from ee_engine.workflow_video import workflow_status

    return {
        "ok": True,
        "items": [],
        "errors": [],
        "status": {
            "ffmpeg": resolve_ffmpeg_bin() or "",
            "variator": variator_status(),
            "youry": youry_status(),
            "workflow": workflow_status(),
            "avatar_packs": avatar_packs(),
            "colors": color_names(),
            "sample_caption": pick_captions(1)[0],
        },
    }


def _render_many(kind: str, count: int, render_one) -> dict:
    if not ffmpeg_available():
        raise EngineError("FFmpeg not found on the bot host.")
    items, errors = [], []
    for index in range(1, count + 1):
        _log(f"[{kind} {index}/{count}]")
        try:
            items.append(render_one(index).to_json())
        except Exception as exc:
            errors.append(f"{kind.capitalize()} {index} failed: {exc}")
            _log(traceback.format_exc())
    return {"ok": bool(items), "items": items, "errors": errors}


def cmd_variator(args) -> dict:
    from ee_engine.videos import pick_captions, render_variator_video

    count = max(1, min(MAX_COUNT, args.count))
    captions = [args.caption] * count if args.caption else pick_captions(count)
    return _render_many(
        "variator",
        count,
        lambda index: render_variator_video(
            args.out,
            caption=captions[index - 1],
            seed=_seed(),
            max_bytes=int(args.max_mb * 1024 * 1024),
            iphone_signature=not args.no_iphone,
        ),
    )


def cmd_youry(args) -> dict:
    from ee_engine.videos import render_youry_clip

    count = max(1, min(MAX_COUNT, args.count))
    return _render_many(
        "youry",
        count,
        lambda _index: render_youry_clip(
            args.out,
            seed=_seed(),
            max_bytes=int(args.max_mb * 1024 * 1024),
            iphone_signature=not args.no_iphone,
        ),
    )


def cmd_workflow(args) -> dict:
    from ee_engine.workflow_video import render_workflow_video

    count = max(1, min(MAX_COUNT, args.count))
    return _render_many(
        "workflow",
        count,
        lambda _index: render_workflow_video(
            args.out,
            seed=_seed(),
            max_bytes=int(args.max_mb * 1024 * 1024),
            workflow=args.workflow or None,
            product=args.product or None,
            iphone_signature=not args.no_iphone,
        ),
    )


def cmd_carousel(args) -> dict:
    from ee_engine.ee_best_business import build_best_business_carousel
    from ee_engine.ee_carousel import build_ee_carousel
    from ee_engine.ee_dead import build_dead_carousel
    from ee_engine.ee_steps import build_steps_carousel

    count = max(1, min(MAX_COUNT, args.count))
    items, errors = [], []
    for index in range(1, count + 1):
        _log(f"[carousel {index}/{count}]")
        try:
            if args.style == "best-business":
                result = build_best_business_carousel(
                    args.out / f"carousel_{index}",
                    seed=_seed(),
                )
            elif args.style == "dead":
                result = build_dead_carousel(
                    args.out / f"carousel_{index}",
                    seed=_seed(),
                )
            elif args.style == "steps":
                result = build_steps_carousel(
                    args.out / f"carousel_{index}",
                    seed=_seed(),
                )
            else:
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

    variator = sub.add_parser("variator")
    variator.add_argument("--count", type=int, default=1)
    variator.add_argument("--caption", default="")
    variator.add_argument("--out", type=Path, required=True)
    variator.add_argument("--max-mb", type=float, default=DEFAULT_MAX_MB)
    variator.add_argument("--no-iphone", action="store_true")

    youry = sub.add_parser("youry")
    youry.add_argument("--count", type=int, default=1)
    youry.add_argument("--out", type=Path, required=True)
    youry.add_argument("--max-mb", type=float, default=DEFAULT_MAX_MB)
    youry.add_argument("--no-iphone", action="store_true")

    workflow = sub.add_parser("workflow")
    workflow.add_argument("--count", type=int, default=1)
    workflow.add_argument("--workflow", default="")
    workflow.add_argument("--product", default="")
    workflow.add_argument("--out", type=Path, required=True)
    workflow.add_argument("--max-mb", type=float, default=DEFAULT_MAX_MB)
    workflow.add_argument("--no-iphone", action="store_true")

    carousel = sub.add_parser("carousel")
    carousel.add_argument("--count", type=int, default=1)
    carousel.add_argument("--avatar", default=None)
    carousel.add_argument("--color", default=None)
    carousel.add_argument("--style", default="tools", choices=("tools", "best-business", "dead", "steps"))
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
        "variator": cmd_variator,
        "youry": cmd_youry,
        "workflow": cmd_workflow,
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
