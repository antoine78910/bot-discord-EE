"""
EE video = YouRy hook clip + Variator body, one caption banner across both.

  0s ─ hook ─ H s ─────── Variator body (6 s) ───────┤
  [face clip + caption banner] [black bg + same banner + template w/ app logos]

Music comes from Variator's audio_path (trending reel sounds). The render is
metadata-free; the final file gets the iPhone 15 Pro signature (.MOV).
"""

from __future__ import annotations

import random
import shutil
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

from . import ENGINE_ROOT
from .ffmpeg_tools import EngineError, compress_to_size, probe_duration, run_ffmpeg
from .video_metadata import inject_iphone_signature

HOOKS_DIR = ENGINE_ROOT / "hooks"
VIDEO_EXTS = {".mp4", ".mov", ".m4v"}

WIDTH = 1080
HEIGHT = 1920
FPS = 30
HOOK_MIN_SEC = 1.5
HOOK_MAX_SEC = 5.0
BODY_SEC = 6.0
BODY_FADE_SEC = 0.8
MUSIC_VOLUME = 0.9


@dataclass
class VideoResult:
    path: Path
    caption: str
    hook: str
    template: str
    steps: list[str]
    music: str
    duration: float
    extra_files: list[Path] = field(default_factory=list)

    def to_json(self) -> dict:
        return {
            "type": "video",
            "path": str(self.path),
            "caption": self.caption,
            "hook": self.hook,
            "template": self.template,
            "steps": self.steps,
            "music": self.music,
            "duration": round(self.duration, 2),
        }


def _variator():
    from variator import generate as vg

    return vg


def list_hooks() -> list[Path]:
    if not HOOKS_DIR.is_dir():
        return []
    return sorted(
        p for p in HOOKS_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in VIDEO_EXTS and p.stat().st_size > 1024
    )


def pick_captions(count: int) -> list[str]:
    """Weighted pick from Variator captions.txt (lines ending with @N weigh N)."""
    vg = _variator()
    captions_path = vg.PROJECT_ROOT / "captions.txt"
    texts, weights = vg._load_captions_from_file(captions_path)
    if not texts:
        texts, weights = list(vg.CAPTION_OPTIONS), [1] * len(vg.CAPTION_OPTIONS)
    if count <= len(texts):
        return vg._weighted_sample_without_replacement(texts, weights, count)
    return random.choices(texts, weights=weights, k=count)


def _render_variator_frames(caption: str, work: Path) -> tuple[Path, Path, Path, str, list[str]]:
    """Returns (body background, variation image, hook banner, template name, step texts)."""
    vg = _variator()
    templates = vg.get_template_paths()
    if not templates:
        raise EngineError("No Variator templates found (template*.png).")

    template_path = random.choice(templates)
    vg.load_layout_file(template_path)
    template = Image.open(template_path).convert("RGB")
    tw, th = template.size
    steps = list(vg._pick_step_texts(template_path, caption))
    title_font = vg.get_title_font(max(20, int(th * vg.FONT_SIZE_RATIO)))
    step_images = vg.load_step_images(tw, th)
    variation = vg.render_image(template, tuple(steps), title_font, step_images, 0)
    variation_path = work / "variation.png"
    variation.save(variation_path)

    caption_font = vg.get_font(max(36, int(vg.CAPTION_HEIGHT * 0.032)))
    background = vg.render_caption_image(caption, caption_font)
    background_path = work / "body_bg.png"
    background.save(background_path)

    y0 = int(vg.CAPTION_HEIGHT * vg.CAPTION_RECT_Y_START)
    y1 = int(vg.CAPTION_HEIGHT * vg.CAPTION_RECT_Y_END)
    banner = Image.new("RGBA", (vg.CAPTION_WIDTH, vg.CAPTION_HEIGHT), (0, 0, 0, 0))
    banner.paste(background.crop((0, y0, vg.CAPTION_WIDTH, y1)), (0, y0))
    banner_path = work / "hook_banner.png"
    banner.save(banner_path)

    return background_path, variation_path, banner_path, template_path.name, steps


def _body_zone() -> tuple[int, int]:
    vg = _variator()
    y1 = int(vg.CAPTION_HEIGHT * vg.CAPTION_RECT_Y_END)
    zone_h = int((vg.CAPTION_HEIGHT - y1) * 0.85)
    return y1, zone_h


def _render(
    *,
    hook: Path,
    hook_sec: float,
    banner: Path,
    background: Path,
    variation: Path,
    music: Path | None,
    dest: Path,
    rng: random.Random,
) -> float:
    total = hook_sec + BODY_SEC
    body_y, zone_h = _body_zone()
    saturation = rng.uniform(0.94, 1.08)
    brightness = rng.uniform(-0.03, 0.03)
    contrast = rng.uniform(0.96, 1.05)
    zoom = rng.uniform(1.0, 1.03)

    inputs = [
        "-i", str(hook),
        "-loop", "1", "-framerate", str(FPS), "-t", f"{hook_sec:.3f}", "-i", str(banner),
        "-loop", "1", "-framerate", str(FPS), "-t", f"{BODY_SEC:.3f}", "-i", str(background),
        "-loop", "1", "-framerate", str(FPS), "-t", f"{BODY_SEC:.3f}", "-i", str(variation),
    ]
    if music is not None:
        inputs += ["-stream_loop", "-1", "-i", str(music)]

    filters = [
        (
            f"[0:v]trim=0:{hook_sec:.3f},setpts=PTS-STARTPTS,fps={FPS},"
            f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,"
            f"crop={WIDTH}:{HEIGHT},setsar=1[hk]"
        ),
        "[1:v]format=rgba[bn]",
        "[hk][bn]overlay=0:0:shortest=1,format=yuv420p,setsar=1[hookv]",
        f"[2:v]scale={WIDTH}:{HEIGHT},setsar=1[bg]",
        (
            f"[3:v]scale={WIDTH}:{zone_h}:force_original_aspect_ratio=decrease,"
            f"fade=t=in:st=0:d={BODY_FADE_SEC}[var]"
        ),
        f"[bg][var]overlay=(W-w)/2:{body_y}:shortest=1,fps={FPS},format=yuv420p,setsar=1[bodyv]",
        "[hookv][bodyv]concat=n=2:v=1:a=0[cat]",
        (
            f"[cat]eq=saturation={saturation:.4f}:brightness={brightness:.4f}:contrast={contrast:.4f},"
            f"scale=iw*{zoom:.4f}:ih*{zoom:.4f},crop={WIDTH}:{HEIGHT},setsar=1[vout]"
        ),
    ]
    maps = ["-map", "[vout]"]
    audio_args: list[str] = ["-an"]
    if music is not None:
        fade_start = max(0.0, total - 0.6)
        filters.append(
            f"[4:a]atrim=0:{total:.3f},asetpts=PTS-STARTPTS,aresample=44100,"
            f"aformat=channel_layouts=stereo,volume={MUSIC_VOLUME},"
            f"afade=t=out:st={fade_start:.3f}:d=0.6[aout]"
        )
        maps += ["-map", "[aout]"]
        audio_args = ["-c:a", "aac", "-b:a", "128k"]

    run_ffmpeg(
        inputs
        + ["-filter_complex", ";".join(filters)]
        + maps
        + [
            "-t", f"{total:.3f}",
            "-c:v", "libx264", "-preset", rng.choice(["veryfast", "faster", "fast"]),
            "-crf", str(rng.choice([20, 21, 22])),
            "-maxrate", "4M", "-bufsize", "8M",
            "-pix_fmt", "yuv420p", "-r", str(FPS),
        ]
        + audio_args
        + [
            "-map_metadata", "-1", "-map_chapters", "-1",
            "-fflags", "+bitexact", "-flags:v", "+bitexact",
            "-movflags", "+faststart",
            str(dest),
        ],
        timeout=900,
    )
    return total


def render_ee_video(
    out_dir: Path,
    *,
    caption: str,
    seed: int,
    max_bytes: int,
    iphone_signature: bool = True,
) -> VideoResult:
    hooks = list_hooks()
    if not hooks:
        raise EngineError(f"No hook clips in {HOOKS_DIR}.")

    rng = random.Random(seed)
    random.seed(seed)
    vg = _variator()

    work = out_dir / f"work_{uuid.uuid4().hex[:10]}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        background, variation, banner, template_name, steps = _render_variator_frames(caption, work)

        hook = rng.choice(hooks)
        hook_sec = min(HOOK_MAX_SEC, probe_duration(hook))
        if hook_sec < HOOK_MIN_SEC:
            raise EngineError(f"Hook clip {hook.name} is too short ({hook_sec:.1f}s).")

        tracks = vg.get_audio_paths()
        music = rng.choice(tracks) if tracks else None

        rendered = work / "render.mp4"
        total = _render(
            hook=hook,
            hook_sec=hook_sec,
            banner=banner,
            background=background,
            variation=variation,
            music=music,
            dest=rendered,
            rng=rng,
        )
        final = compress_to_size(rendered, max_bytes)

        file_number = rng.randint(1000, 9999)
        if iphone_signature:
            signed = inject_iphone_signature(
                final, out_dir / f"IMG_{file_number:04d}.MOV", seed=rng.randint(0, 2**31)
            )
        else:
            signed = out_dir / f"IMG_{file_number:04d}.mp4"
            shutil.move(str(final), signed)

        return VideoResult(
            path=signed,
            caption=caption,
            hook=hook.name,
            template=template_name,
            steps=steps,
            music=music.name if music else "",
            duration=total,
        )
    finally:
        shutil.rmtree(work, ignore_errors=True)
