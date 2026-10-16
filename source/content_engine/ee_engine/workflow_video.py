"""
Workflow videos: a decision tree of steps, each filled with a random clip.

Clips live in content_engine/workflow/:

  broad/                    reusable with any product (tool walkthroughs)
      show youry 1.mp4
      show youry 2.mp4
  products/<product>/       only valid for that product
      aliexpress 1.mp4
      ugc 2.mp4

Variants of the same step share a name and differ only by a trailing number:
"show youry 1", "show youry (2)", "show_youry3" all belong to "show youry".

The tree is in workflow/workflows.json. Node types:

  {"clip": "ugc", "from": "product"}          clip from the product folder
  {"clip": "result", "from": "broad"}         clip from broad/
  {"clip": "tiktok show", "from": "any"}      product clip if it exists, else broad
  add "optional": true to skip the step when no clip exists
  add "keep_audio": true to keep the clip's own sound (e.g. sale notifications)
  {"one_of": [{"label": "...", "weight": 1, "steps": [...]}, ...]}   pick one branch
  {"chance": 0.5, "label": "...", "steps": [...]}                     maybe play steps

Each run picks one product, walks the tree with random choices, and retries
until every required step has a clip. One variant is drawn per step.

The video opens on a YouRy hook (silent, with a YouRy text hook on top) and a
YouRy music track plays over everything. Body clips are muted except steps
marked keep_audio, whose sound is mixed over the music.

Each body clip gets an on-screen caption drawn from workflow/captions.json
(one random variant per step, never the same text twice in a video).
"""

from __future__ import annotations

import json
import random
import re
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .ffmpeg_tools import EngineError, has_audio_stream, probe_duration, run_ffmpeg
from .videos import SILENT_DETAIL, VideoResult, _finalize, silent_turn

ROOT = Path(__file__).resolve().parents[1] / "workflow"
BROAD_DIR = ROOT / "broad"
PRODUCTS_DIR = ROOT / "products"
WORKFLOWS_FILE = ROOT / "workflows.json"
CAPTIONS_FILE = ROOT / "captions.json"
HOOKS_TEXT_DIR = ROOT / "hooks_text"
HOOK_VIDEOS_DIR = ROOT / "hook videos"
MUSIC_DIR = ROOT / "music"
CAPTION_FONT = ROOT.parent / "carousel" / "fonts" / "TikTokSans-Bold.ttf"
CAPTION_SIZE = 74
CAPTION_STROKE = 5
CAPTION_MAX_WIDTH = 900
CAPTION_LINE_PITCH = 97
CAPTION_EMOJI_GAP = 2
# Same placement as the YouRy text hooks ("mid"): upper third, clear of the TikTok/Reels UI.
CAPTION_Y = "(main_h-overlay_h)*0.24"
# Browser recordings with the URL bar in the upper third: caption goes above it,
# moving up when it wraps so its last line never reaches the URL.
_ABOVE_URL = "min(main_h*0.08\\,main_h*0.235-overlay_h)"
CAPTION_Y_BY_STEP = {"tiktok": _ABOVE_URL, "mademebuyit": _ABOVE_URL, "tiktok show": "main_h*0.1"}

VIDEO_EXT = {".mp4", ".mov", ".m4v", ".webm", ".mkv"}
WIDTH, HEIGHT, FPS = 1080, 1920, 30
MAX_ATTEMPTS = 60
# No voice-over on the body, so the music can sit higher than in YouRy clips.
MUSIC_VOLUME = 0.8
# Sale notification clips are recorded quietly: boost them on top of the full-volume music.
KEPT_AUDIO_VOLUME = 3.0

_VARIANT_SUFFIX = re.compile(r"[\s_-]*(\(\d+\)|\d+)$")
_SEPARATORS = re.compile(r"[\s_-]+")


def normalize(name: str) -> str:
    return _SEPARATORS.sub(" ", name).strip().lower()


def step_key(path: Path) -> str:
    return normalize(_VARIANT_SUFFIX.sub("", path.stem))


def _clips(folder: Path) -> dict[str, list[Path]]:
    groups: dict[str, list[Path]] = {}
    if not folder.is_dir():
        return groups
    for path in sorted(folder.iterdir(), key=lambda p: p.name.lower()):
        if path.is_file() and path.suffix.lower() in VIDEO_EXT:
            groups.setdefault(step_key(path), []).append(path)
    return groups


def _products() -> list[Path]:
    if not PRODUCTS_DIR.is_dir():
        return []
    return sorted(p for p in PRODUCTS_DIR.iterdir() if p.is_dir())


def load_workflows() -> dict[str, list[dict]]:
    if not WORKFLOWS_FILE.is_file():
        raise EngineError(f"Missing {WORKFLOWS_FILE.relative_to(ROOT.parent)}.")
    data = json.loads(WORKFLOWS_FILE.read_text(encoding="utf-8"))
    return {name: steps for name, steps in data.items() if not name.startswith("_")}


def workflow_status() -> dict:
    return {
        "broad_steps": {key: len(paths) for key, paths in _clips(BROAD_DIR).items()},
        "products": {p.name: {k: len(v) for k, v in _clips(p).items()} for p in _products()},
        "workflows": list(load_workflows()) if WORKFLOWS_FILE.is_file() else [],
    }


def _pool(step: dict, broad: dict, product: dict) -> list[Path]:
    key = normalize(step["clip"])
    source = step.get("from", "broad")
    if source == "product":
        return product.get(key, [])
    if source == "any":
        return product.get(key) or broad.get(key, [])
    return broad.get(key, [])


def _walk(nodes: list[dict], broad: dict, product: dict, rng: random.Random,
          path: list[str], plan: list[dict], missing: list[str], skipped: list[str]) -> None:
    """Resolve random choices into a flat list of clip steps."""
    for node in nodes:
        if "one_of" in node:
            branches = node["one_of"]
            weights = [b.get("weight", 1) for b in branches]
            branch = rng.choices(branches, weights=weights, k=1)[0]
            if branch.get("label"):
                path.append(branch["label"])
            _walk(branch["steps"], broad, product, rng, path, plan, missing, skipped)
        elif "first_of" in node:
            # First step that has clips for this product (e.g. its own ig, else meta).
            step = next((s for s in node["first_of"] if _pool(s, broad, product)), None)
            if step:
                plan.append(step)
            elif not node.get("optional"):
                missing.append(" or ".join(s["clip"] for s in node["first_of"]))
        elif "any_clip" in node:
            # One clip drawn evenly across every variant of these steps (12 katching + 2 result = 1/14 each).
            options = [step for step in node["any_clip"] if _pool(step, broad, product)]
            if options:
                weights = [len(_pool(step, broad, product)) for step in options]
                plan.append(rng.choices(options, weights=weights, k=1)[0])
            elif not node.get("optional"):
                missing.append(" or ".join(step["clip"] for step in node["any_clip"]))
        elif "chance" in node:
            if rng.random() < node["chance"]:
                if node.get("label"):
                    path.append(node["label"])
                _walk(node["steps"], broad, product, rng, path, plan, missing, skipped)
            elif node.get("label"):
                skipped.append(f'{node["label"]} (random skip)')
        else:
            if _pool(node, broad, product):
                plan.append(node)
            elif node.get("optional"):
                skipped.append(f'{node["clip"]} (no clip)')
            else:
                missing.append(f'{node.get("from", "broad")}:{node["clip"]}')


def _pick(plan: list[dict], broad: dict, product: dict, rng: random.Random) -> list[tuple[Path, bool, str]]:
    """One variant per step, drawn from a persistent shuffled deck so every variant
    (e.g. all 14 katching clips) is used before any repeats.
    Returns (clip, keep_audio, caption key) triples; "caption" on a step borrows another step's texts."""
    from youry import clip_assembler as ca

    recent = ca._load_recent()
    picked: list[tuple[Path, bool, str]] = []
    for step in plan:
        options = _pool(step, broad, product)
        used = [clip for clip, _, _ in picked]
        deck = f"workflow:{options[0].parent.name}:{normalize(step['clip'])}"
        clip = ca.draw_from_deck(rng, options, deck, 1, recent, exclude=used)[0]
        picked.append((clip, bool(step.get("keep_audio")), normalize(step.get("caption", step["clip"]))))
    ca.save_recent(recent)
    return picked


def load_captions() -> dict[str, list[str]]:
    if not CAPTIONS_FILE.is_file():
        return {}
    data = json.loads(CAPTIONS_FILE.read_text(encoding="utf-8"))
    return {
        normalize(key): [str(text).strip() for text in texts if str(text).strip()]
        for key, texts in data.items()
        if not key.startswith("_") and isinstance(texts, list)
    }


def _pick_captions(keys: list[str], rng: random.Random) -> list[str | None]:
    """One caption per clip; a text already shown in this video is only reused when nothing else is left."""
    captions = load_captions()
    shown: set[str] = set()
    picked: list[str | None] = []
    for key in keys:
        options = captions.get(key) or []
        fresh = [text for text in options if text not in shown] or options
        text = rng.choice(fresh) if fresh else None
        if text:
            shown.add(text)
        picked.append(text)
    return picked


def _caption_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype(str(CAPTION_FONT), size)
    except OSError:
        return ImageFont.load_default()


def _wrap(text: str, font, draw: ImageDraw.ImageDraw, max_width: int) -> list[str]:
    lines: list[str] = []
    current = ""
    words: list[str] = []
    for word in text.split():
        # An emoji stays on the line of the word before it.
        if words and not any(ch.isalnum() for ch in word):
            words[-1] += f" {word}"
        else:
            words.append(word)
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and draw.textlength(candidate, font=font) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def _caption_png(text: str, path: Path) -> Path:
    """White text with a black outline on a transparent 1080px strip, like the YouRy text hooks."""
    font = _caption_font(CAPTION_SIZE)
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    lines = _wrap(text, font, probe, CAPTION_MAX_WIDTH)
    pad = 48
    height = CAPTION_LINE_PITCH * len(lines) + pad * 2

    image = Image.new("RGBA", (WIDTH, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for row, line in enumerate(lines):
        _draw_caption_line(image, draw, line, font, pad + CAPTION_LINE_PITCH * row + CAPTION_LINE_PITCH / 2)
    image.save(path)
    return path


def _draw_caption_line(image: Image.Image, draw: ImageDraw.ImageDraw, line: str, font, center_y: float) -> None:
    """Outlined text centered on center_y; emojis are pasted as Apple PNGs like on the carousels."""
    from carousel import generate_carousel as gc

    emoji_size = CAPTION_SIZE
    runs = []
    for part, is_emoji in gc._split_text_runs(line):
        emoji = gc._load_apple_emoji(part, emoji_size) if is_emoji else None
        if is_emoji and emoji is None:
            continue
        width = emoji.size[0] + CAPTION_EMOJI_GAP if emoji is not None else draw.textlength(part, font=font)
        runs.append((part, emoji, width))
    x = (WIDTH - sum(width for _, _, width in runs)) / 2
    for part, emoji, width in runs:
        if emoji is not None:
            image.paste(emoji, (int(x + CAPTION_EMOJI_GAP), int(center_y - emoji.size[1] / 2)), emoji)
        else:
            draw.text(
                (x, center_y),
                part,
                font=font,
                anchor="lm",
                fill=(255, 255, 255, 255),
                stroke_width=CAPTION_STROKE,
                stroke_fill=(0, 0, 0, 255),
            )
        x += width


def plan_workflow(
    rng: random.Random,
    *,
    workflow: str | None = None,
    product: str | None = None,
) -> tuple[str, Path, list[str], list[tuple[Path, bool, str]], list[str]]:
    """Returns (workflow name, product folder, branch labels, (clip, keep_audio, step key) triples, skipped steps)."""
    workflows = load_workflows()
    if not workflows:
        raise EngineError("No workflow defined in workflow/workflows.json.")
    if workflow and workflow not in workflows:
        raise EngineError(f"Unknown workflow '{workflow}'. Known: {', '.join(workflows)}.")
    products = [p for p in _products() if not product or p.name.lower() == product.lower()]
    if not products:
        raise EngineError("No product folder in workflow/products" + (f" named '{product}'." if product else "."))

    broad = _clips(BROAD_DIR)
    problems: dict[str, int] = {}
    for _ in range(MAX_ATTEMPTS):
        name = workflow or rng.choice(list(workflows))
        folder = rng.choice(products)
        product_clips = _clips(folder)
        path: list[str] = []
        plan: list[dict] = []
        missing: list[str] = []
        skipped: list[str] = []
        _walk(workflows[name], broad, product_clips, rng, path, plan, missing, skipped)
        if not missing:
            return name, folder, path, _pick(plan, broad, product_clips, rng), skipped
        key = f"{folder.name}: missing {', '.join(missing)}"
        problems[key] = problems.get(key, 0) + 1
    detail = "; ".join(sorted(problems, key=problems.get, reverse=True)[:3])
    raise EngineError(f"No complete workflow found ({detail}).")


@dataclass
class HookPick:
    hook: Path
    text_hook: Path | None
    music: Path


def _youry():
    from youry import clip_assembler as ca

    return ca


def _pick_hook(rng: random.Random) -> HookPick:
    """YouRy hook videos plus the workflow's own, workflow music (else YouRy's), workflow text hooks."""
    ca = _youry()
    text_hooks = [(path, "workflow") for path in sorted(HOOKS_TEXT_DIR.glob("*.png"))]
    hooks = ca._list_usable_files(ca.hooks_dir(), ca.VIDEO_EXT)
    if HOOK_VIDEOS_DIR.is_dir():
        hooks += ca._list_usable_files(HOOK_VIDEOS_DIR, ca.VIDEO_EXT)
    tracks: list[Path] = []
    if MUSIC_DIR.is_dir():
        tracks = [
            path
            for path in ca._list_usable_files(MUSIC_DIR, ca.AUDIO_EXT | ca.VIDEO_EXT)
            if path.suffix.lower() in ca.AUDIO_EXT or has_audio_stream(path)
        ]
    music_key = "workflow_music"
    if not tracks:
        tracks, music_key = ca._list_usable_files(ca.music_dir(), ca.AUDIO_EXT), "music"
    if not hooks:
        raise EngineError(f"No hook videos in {ca.hooks_dir()}.")
    if not tracks:
        raise EngineError(f"No music in {MUSIC_DIR} or {ca.music_dir()}.")
    recent = ca._load_recent()
    picked_text = ca._pick_fresh(rng, text_hooks, "workflow_text_hooks", recent)
    hook = ca._pick_fresh(rng, hooks, "workflow_hooks", recent)
    music = ca._pick_fresh(rng, tracks, music_key, recent)
    try:
        ca.RECENT_PICKS_PATH.write_text(json.dumps(recent), encoding="utf-8")
    except OSError:
        pass
    return HookPick(hook=hook, text_hook=picked_text[0] if picked_text else None, music=music)


def _render(
    pick: HookPick,
    clips: list[tuple[Path, bool, str]],
    captions: list[Path | None],
    output: Path,
    rng: random.Random,
    cta: Path | None = None,
    with_music: bool = True,
) -> None:
    """Hook + muted body clips (except keep_audio) + captions + music, with light visual variation.

    The last clip shows its caption on the first half and the centered CTA on the second half.
    Without music, only the keep_audio clips (e.g. the katching sale sound) are heard.
    """
    scale_crop = (
        f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,"
        f"crop={WIDTH}:{HEIGHT},fps={FPS},setsar=1,format=yuv420p"
    )
    sources = [pick.hook] + [clip for clip, _, _ in clips]
    durations = [probe_duration(path) for path in sources]
    total = sum(durations)

    # 15-20 inputs are opened at once: one decoder thread each keeps the process
    # under container thread limits (otherwise the x264 encoder fails to start).
    args: list[str] = ["-filter_complex_threads", "2"]
    for path in sources:
        args += ["-threads", "1", "-i", str(path)]
    music_index = len(sources)
    args += ["-i", str(pick.music)]

    filters = [f"[{i}:v]{scale_crop}[v{i}]" for i in range(len(sources))]
    filters.append(f"{''.join(f'[v{i}]' for i in range(len(sources)))}concat=n={len(sources)}:v=1:a=0[vcat]")

    scale = rng.uniform(1.0, 1.05)
    rotation = rng.uniform(-0.5, 0.5) * 3.14159265 / 180.0
    filters.append(
        f"[vcat]eq=saturation={rng.uniform(0.92, 1.1):.3f}:brightness={rng.uniform(-0.04, 0.04):.3f}:"
        f"contrast={rng.uniform(0.94, 1.06):.3f},"
        f"rotate={rotation:.5f}:fillcolor=black@0:ow=iw:oh=ih,"
        f"scale=iw*{scale:.4f}:ih*{scale:.4f},crop={WIDTH}:{HEIGHT}[vbase]"
    )

    video_out = "[vbase]"
    next_input = music_index + 1
    if pick.text_hook is not None:
        text_index = next_input
        next_input += 1
        args += ["-i", str(pick.text_hook)]
        ox, oy = _youry()._overlay_xy("mid")
        enable = f"lt(t,{max(0.1, durations[0]):.3f})"
        if pick.text_hook.suffix.lower() == ".png":
            filters.append(f"[vbase][{text_index}:v]overlay=x={ox}:y={oy}:enable='{enable}'[vout]")
        else:
            filters.append(
                f"[{text_index}:v]scale={WIDTH}:-1[txt];"
                f"[vbase][txt]overlay=x={ox}:y={oy}:enable='{enable}'[vout]"
            )
        video_out = "[vout]"

    kept: list[tuple[int, float, float]] = []
    offset = durations[0]
    for index, ((clip, keep_audio, key), duration, caption) in enumerate(
        zip(clips, durations[1:], captions), start=1
    ):
        if keep_audio and has_audio_stream(clip):
            kept.append((index, offset, duration))
        end = offset + duration
        split = offset + duration / 2 if cta is not None and index == len(clips) else end
        if caption is not None:
            args += ["-i", str(caption)]
            label = f"[cap{index}]"
            filters.append(
                f"{video_out}[{next_input}:v]overlay=x=(main_w-overlay_w)/2:y={CAPTION_Y_BY_STEP.get(key, CAPTION_Y)}:"
                f"enable='between(t,{offset:.3f},{split:.3f})'{label}"
            )
            video_out = label
            next_input += 1
        if split < end:
            args += ["-i", str(cta)]
            filters.append(
                f"{video_out}[{next_input}:v]overlay=x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/2:"
                f"enable='between(t,{split:.3f},{end:.3f})'[cta]"
            )
            video_out = "[cta]"
            next_input += 1
        offset = end

    filters.append(
        f"[{music_index}:a]aresample=44100,aformat=channel_layouts=stereo,"
        f"volume={MUSIC_VOLUME if with_music else 0},aloop=loop=-1:size=2e+09,atrim=duration={total:.3f},"
        f"asetpts=PTS-STARTPTS[music]"
    )
    mix = ["[music]"]
    for index, start, length in kept:
        filters.append(
            f"[{index}:a]aresample=44100,aformat=channel_layouts=stereo,"
            f"atrim=duration={length:.3f},volume={KEPT_AUDIO_VOLUME},"
            f"adelay={int(start * 1000)}:all=1[keep{index}]"
        )
        mix.append(f"[keep{index}]")
    if len(mix) == 1:
        filters.append("[music]anull[aout]")
    else:
        filters.append(
            f"{''.join(mix)}amix=inputs={len(mix)}:duration=first:normalize=0,"
            "alimiter=limit=0.95[aout]"
        )

    args += [
        "-filter_complex", ";".join(filters),
        "-map", video_out, "-map", "[aout]",
        "-t", f"{total:.3f}",
        "-c:v", "libx264", "-preset", "fast", "-crf", "17", "-threads", "4",
        "-c:a", "aac", "-b:a", "192k",
        "-map_metadata", "-1",
        "-movflags", "+faststart",
        str(output),
    ]
    run_ffmpeg(args, timeout=1800)


def render_workflow_video(
    out_dir: Path,
    *,
    seed: int,
    max_bytes: int,
    workflow: str | None = None,
    product: str | None = None,
    iphone_signature: bool = True,
) -> VideoResult:
    rng = random.Random(seed)
    name, folder, branches, clips, skipped = plan_workflow(rng, workflow=workflow, product=product)
    pick = _pick_hook(rng)

    work = out_dir / f"work_{uuid.uuid4().hex[:10]}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        texts = _pick_captions([key for _, _, key in clips], rng)
        captions = [
            _caption_png(text, work / f"caption_{index}.png") if text else None
            for index, text in enumerate(texts)
        ]
        cta_options = load_captions().get("cta") or []
        cta_text = rng.choice(cta_options) if cta_options else None
        cta = _caption_png(cta_text, work / "cta.png") if cta_text else None
        silent = silent_turn("workflow", every=4)
        has_clip_sound = any(keep and has_audio_stream(clip) for clip, keep, _ in clips)
        rendered = work / "workflow.mp4"
        _render(pick, clips, captions, rendered, rng, cta, with_music=not silent)
        duration = probe_duration(rendered)
        final = _finalize(
            rendered,
            out_dir,
            rng=rng,
            max_bytes=max_bytes,
            iphone_signature=iphone_signature,
            silent=silent and not has_clip_sound,
        )
        music = "none" if silent else pick.music.stem
        text = pick.text_hook.stem if pick.text_hook else "none"
        scenes = [f"`0` hook · {pick.hook.stem} · {probe_duration(pick.hook):.1f}s · text `{text}`"]
        for i, ((clip, keep, key), caption) in enumerate(zip(clips, texts), start=1):
            sound = " 🔊" if keep else ""
            scenes.append(
                f"`{i}` **{key}** · {clip.stem}{sound} · {probe_duration(clip):.1f}s"
                + (f" · “{caption}”" if caption else " · no caption")
            )
        if cta_text and clips:
            scenes[-1] += f" → CTA “{cta_text}”"
        return VideoResult(
            kind="workflow",
            path=final,
            duration=duration,
            details=[
                f"**Workflow:** {name} · **Product:** {folder.name} · **Music:** {music}",
                *([SILENT_DETAIL] if silent else []),
                "Branches: " + (" → ".join(branches) or "none"),
                f"**Scenes ({len(clips) + 1}):**",
                *scenes,
                *(["Skipped: " + " · ".join(skipped)] if skipped else []),
            ],
        )
    finally:
        shutil.rmtree(work, ignore_errors=True)
