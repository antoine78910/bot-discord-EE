"""
Two independent video generators, each running its original pipeline untouched:

  variator  Variator generate.py: variation image (template + app logos) -> 6 s video
            with fade + music -> caption banner overlay (same as `generate.py` main + run_captions).
  youry     YouRy clip_assembler.assemble_clip: hook + body + music + text hook + variations.

Only post-processing is added: Discord size cap and the iPhone 15 Pro .MOV signature
(stream-copy remux, pixels/audio unchanged).
"""

from __future__ import annotations

import random
import shutil
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

from .ffmpeg_tools import EngineError, compress_to_size, probe_duration, run_ffmpeg
from .video_metadata import inject_iphone_signature

SILENT_DETAIL = "**Sound:** none, add a trending sound on TikTok / Instagram"


@dataclass
class VideoResult:
    kind: str
    path: Path
    duration: float
    details: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        return {
            "type": self.kind,
            "path": str(self.path),
            "duration": round(self.duration, 2),
            "details": self.details,
        }


def _variator():
    from variator import generate as vg

    return vg


def _youry():
    from youry import clip_assembler as ca

    return ca


def pick_captions(count: int) -> list[str]:
    """Weighted pick from Variator captions.txt (lines ending with @N weigh N)."""
    vg = _variator()
    texts, weights = vg._load_captions_from_file(vg.PROJECT_ROOT / "captions.txt")
    if not texts:
        texts, weights = list(vg.CAPTION_OPTIONS), [1] * len(vg.CAPTION_OPTIONS)
    if count <= len(texts):
        return vg._weighted_sample_without_replacement(texts, weights, count)
    return random.choices(texts, weights=weights, k=count)


def silent_turn(kind: str) -> bool:
    """Every other video of each kind ships without an audio track (persisted across runs)."""
    ca = _youry()
    recent = ca._load_recent()
    key = f"silent_turn:{kind}"
    silent = bool(recent.get(key, False))
    recent[key] = not silent
    ca.save_recent(recent)
    return silent


def _strip_audio(path: Path) -> Path:
    silent = path.with_name(f"{path.stem}_silent.mp4")
    run_ffmpeg(["-i", str(path), "-map", "0:v:0", "-c", "copy", "-movflags", "+faststart", str(silent)])
    path.unlink(missing_ok=True)
    return silent


def _finalize(
    rendered: Path,
    out_dir: Path,
    *,
    rng: random.Random,
    max_bytes: int,
    iphone_signature: bool,
    silent: bool = False,
) -> Path:
    if silent:
        rendered = _strip_audio(rendered)
    final = compress_to_size(rendered, max_bytes)
    file_number = rng.randint(1000, 9999)
    if iphone_signature:
        return inject_iphone_signature(final, out_dir / f"IMG_{file_number:04d}.MOV", seed=rng.randint(0, 2**31))
    target = out_dir / f"IMG_{file_number:04d}.mp4"
    shutil.move(str(final), target)
    return target


def variator_status() -> dict:
    vg = _variator()
    return {"templates": len(vg.get_template_paths()), "music": len(vg.get_audio_paths())}


def render_variator_video(
    out_dir: Path,
    *,
    caption: str,
    seed: int,
    max_bytes: int,
    iphone_signature: bool = True,
) -> VideoResult:
    vg = _variator()
    rng = random.Random(seed)
    random.seed(seed)

    template_paths = vg.get_template_paths()
    if not template_paths:
        raise EngineError("No Variator templates found (template*.png).")

    work = out_dir / f"work_{uuid.uuid4().hex[:10]}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        # Same steps as generate.py main(): one variation image + video.
        first = Image.open(template_paths[0]).convert("RGB")
        step_images = vg.load_step_images(*first.size)
        tpl_idx = random.randint(0, len(template_paths) - 1)
        template = Image.open(template_paths[tpl_idx]).convert("RGB")
        vg.load_layout_file(template_paths[tpl_idx])
        lines = vg._pick_step_texts(template_paths[tpl_idx])
        tw, th = template.size
        variation_idx = random.randint(0, 3)
        font = vg.get_title_font(max(20, int(th * vg.FONT_SIZE_RATIO)), variation_idx)
        image_path = work / "variation.png"
        vg.render_image(template, lines, font, step_images, variation_idx).save(image_path)

        tracks = vg.get_audio_paths()
        audio = random.choice(tracks) if tracks else None
        variation_video = work / "variation.mp4"
        if not vg.image_to_video(image_path, variation_video, tw, th, audio):
            raise EngineError("Variator: variation video render failed.")

        # Same steps as generate.py run_captions(): caption image + overlay.
        caption_font = vg.get_font(max(36, int(vg.CAPTION_HEIGHT * 0.032)))
        caption_path = work / "caption.png"
        vg.render_caption_image(caption, caption_font).save(caption_path)
        rendered = work / "caption.mp4"
        if not vg.overlay_caption_on_variation(caption_path, variation_video, rendered):
            raise EngineError("Variator: caption overlay render failed.")

        duration = probe_duration(rendered)
        silent = silent_turn("variator")
        final = _finalize(
            rendered, out_dir, rng=rng, max_bytes=max_bytes, iphone_signature=iphone_signature, silent=silent
        )
        details = [
            f"**Caption:** {caption}",
            f"Template `{template_paths[tpl_idx].name}` · music `{audio.name if audio else 'none'}`",
            "Steps: " + " · ".join(f"{i + 1}. {t}" for i, t in enumerate(lines[:3])),
        ]
        if silent:
            details.append(SILENT_DETAIL)
        return VideoResult(kind="variator", path=final, duration=duration, details=details)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def youry_status() -> dict:
    status = _youry().assets_status()
    return {key: status[key] for key in ("hooks", "bodies", "music", "text_hooks")}


def render_youry_clip(
    out_dir: Path,
    *,
    seed: int,
    max_bytes: int,
    iphone_signature: bool = True,
) -> VideoResult:
    ca = _youry()
    rng = random.Random(seed)
    work = out_dir / f"work_{uuid.uuid4().hex[:10]}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        try:
            rendered, recipe = ca.assemble_clip(work / f"clip_{uuid.uuid4().hex}.mp4", seed=seed, fit_discord=False)
        except ca.ClipAssemblyError as exc:
            raise EngineError(str(exc)) from exc
        duration = probe_duration(rendered)
        silent = silent_turn("youry")
        final = _finalize(
            rendered, out_dir, rng=rng, max_bytes=max_bytes, iphone_signature=iphone_signature, silent=silent
        )
        details = ca.recipe_summary(recipe).split("\n")
        if silent:
            details.append(SILENT_DETAIL)
        return VideoResult(kind="youry", path=final, duration=duration, details=details)
    finally:
        shutil.rmtree(work, ignore_errors=True)
