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
"""

from __future__ import annotations

import json
import random
import re
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path

from .ffmpeg_tools import EngineError, has_audio_stream, probe_duration, run_ffmpeg
from .videos import VideoResult, _finalize

ROOT = Path(__file__).resolve().parents[1] / "workflow"
BROAD_DIR = ROOT / "broad"
PRODUCTS_DIR = ROOT / "products"
WORKFLOWS_FILE = ROOT / "workflows.json"

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
          path: list[str], plan: list[dict], missing: list[str]) -> None:
    """Resolve random choices into a flat list of clip steps."""
    for node in nodes:
        if "one_of" in node:
            branches = node["one_of"]
            weights = [b.get("weight", 1) for b in branches]
            branch = rng.choices(branches, weights=weights, k=1)[0]
            if branch.get("label"):
                path.append(branch["label"])
            _walk(branch["steps"], broad, product, rng, path, plan, missing)
        elif "chance" in node:
            if rng.random() < node["chance"]:
                if node.get("label"):
                    path.append(node["label"])
                _walk(node["steps"], broad, product, rng, path, plan, missing)
        else:
            if _pool(node, broad, product):
                plan.append(node)
            elif not node.get("optional"):
                missing.append(f'{node.get("from", "broad")}:{node["clip"]}')


def _pick(plan: list[dict], broad: dict, product: dict, rng: random.Random) -> list[tuple[Path, bool]]:
    """One variant per step; a clip is reused only when its step has no other variant left.
    Returns (clip, keep_audio) pairs."""
    picked: list[tuple[Path, bool]] = []
    for step in plan:
        options = _pool(step, broad, product)
        used = [clip for clip, _ in picked]
        fresh = [clip for clip in options if clip not in used] or options
        picked.append((rng.choice(fresh), bool(step.get("keep_audio"))))
    return picked


def plan_workflow(
    rng: random.Random,
    *,
    workflow: str | None = None,
    product: str | None = None,
) -> tuple[str, Path, list[str], list[tuple[Path, bool]]]:
    """Returns (workflow name, product folder, branch labels, (clip, keep_audio) pairs)."""
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
        _walk(workflows[name], broad, product_clips, rng, path, plan, missing)
        if not missing:
            return name, folder, path, _pick(plan, broad, product_clips, rng)
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
    """Same YouRy pools and the same recent-picks rotation as YouRy clips."""
    ca = _youry()
    hooks = ca._list_usable_files(ca.hooks_dir(), ca.VIDEO_EXT)
    tracks = ca._list_usable_files(ca.music_dir(), ca.AUDIO_EXT)
    if not hooks:
        raise EngineError(f"No hook videos in {ca.hooks_dir()}.")
    if not tracks:
        raise EngineError(f"No music in {ca.music_dir()}.")
    recent = ca._load_recent()
    picked_text = ca._pick_fresh(rng, ca._text_hook_choices(), "text_hooks", recent)
    hook = ca._pick_fresh(rng, hooks, "hooks", recent)
    music = ca._pick_fresh(rng, tracks, "music", recent)
    try:
        ca.RECENT_PICKS_PATH.write_text(json.dumps(recent), encoding="utf-8")
    except OSError:
        pass
    return HookPick(hook=hook, text_hook=picked_text[0] if picked_text else None, music=music)


def _render(pick: HookPick, clips: list[tuple[Path, bool]], output: Path, rng: random.Random) -> None:
    """Hook + muted body clips (except keep_audio) + music, with light visual variation."""
    scale_crop = (
        f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,"
        f"crop={WIDTH}:{HEIGHT},fps={FPS},setsar=1,format=yuv420p"
    )
    sources = [pick.hook] + [clip for clip, _ in clips]
    durations = [probe_duration(path) for path in sources]
    total = sum(durations)

    args: list[str] = []
    for path in sources:
        args += ["-i", str(path)]
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
    if pick.text_hook is not None:
        text_index = music_index + 1
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
    for index, ((clip, keep_audio), duration) in enumerate(zip(clips, durations[1:]), start=1):
        if keep_audio and has_audio_stream(clip):
            kept.append((index, offset, duration))
        offset += duration

    filters.append(
        f"[{music_index}:a]aresample=44100,aformat=channel_layouts=stereo,"
        f"volume={MUSIC_VOLUME},aloop=loop=-1:size=2e+09,atrim=duration={total:.3f},"
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
        "-c:v", "libx264", "-preset", "fast", "-crf", "17",
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
    name, folder, branches, clips = plan_workflow(rng, workflow=workflow, product=product)
    pick = _pick_hook(rng)

    work = out_dir / f"work_{uuid.uuid4().hex[:10]}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        rendered = work / "workflow.mp4"
        _render(pick, clips, rendered, rng)
        duration = probe_duration(rendered)
        final = _finalize(rendered, out_dir, rng=rng, max_bytes=max_bytes, iphone_signature=iphone_signature)
        text = pick.text_hook.name if pick.text_hook else "none"
        return VideoResult(
            kind="workflow",
            path=final,
            duration=duration,
            details=[
                f"**Workflow:** {name} · **Product:** {folder.name}",
                f"Hook `{pick.hook.name}` · text `{text}` · music `{pick.music.name}`",
                "Branches: " + (" → ".join(branches) or "none"),
                "Clips: " + " · ".join(
                    f"{i + 1}. {clip.stem}{' (sound)' if keep else ''}" for i, (clip, keep) in enumerate(clips)
                ),
            ],
        )
    finally:
        shutil.rmtree(work, ignore_errors=True)
