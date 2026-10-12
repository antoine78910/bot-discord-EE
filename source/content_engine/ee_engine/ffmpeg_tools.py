"""FFmpeg discovery, execution, probing and Discord-size compression."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path


class EngineError(Exception):
    pass


@lru_cache(maxsize=1)
def resolve_ffmpeg_bin() -> str | None:
    env_path = os.getenv("FFMPEG_PATH", "").strip().strip('"').strip("'")
    if env_path:
        candidate = Path(env_path)
        if candidate.is_file():
            return str(candidate)
        nested = candidate / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
        if nested.is_file():
            return str(nested)

    from_path = shutil.which("ffmpeg")
    if from_path:
        return from_path

    if os.name == "nt":
        winget_root = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
        if winget_root.is_dir():
            for exe in winget_root.glob("Gyan.FFmpeg*/**/bin/ffmpeg.exe"):
                if exe.is_file():
                    return str(exe)

    try:
        import imageio_ffmpeg

        bundled = imageio_ffmpeg.get_ffmpeg_exe()
        if bundled and Path(bundled).is_file():
            return bundled
    except ImportError:
        pass
    return None


@lru_cache(maxsize=1)
def resolve_ffprobe_bin() -> str | None:
    ffmpeg_bin = resolve_ffmpeg_bin()
    if ffmpeg_bin:
        probe = Path(ffmpeg_bin).with_name("ffprobe.exe" if os.name == "nt" else "ffprobe")
        if probe.is_file():
            return str(probe)
    return shutil.which("ffprobe")


def ffmpeg_available() -> bool:
    return resolve_ffmpeg_bin() is not None


def require_ffmpeg() -> str:
    binary = resolve_ffmpeg_bin()
    if not binary:
        raise EngineError("FFmpeg not found on the bot host (install it or set FFMPEG_PATH).")
    return binary


def run_ffmpeg(args: list[str], *, timeout: int = 600) -> None:
    cmd = [require_ffmpeg(), "-hide_banner", "-loglevel", "error", "-y", *args]
    try:
        subprocess.run(cmd, check=True, timeout=timeout, capture_output=True)
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or b"").decode("utf-8", errors="replace")[-900:]
        raise EngineError(f"FFmpeg failed: {stderr}") from exc
    except subprocess.TimeoutExpired as exc:
        raise EngineError("FFmpeg timed out.") from exc


_DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")


def probe_duration(path: Path) -> float:
    ffprobe = resolve_ffprobe_bin()
    if ffprobe:
        proc = subprocess.run(
            [
                ffprobe, "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        try:
            return float(proc.stdout.strip())
        except ValueError:
            pass

    proc = subprocess.run(
        [require_ffmpeg(), "-hide_banner", "-i", str(path)],
        capture_output=True,
        text=True,
        timeout=60,
    )
    match = _DURATION_RE.search(proc.stderr or "")
    if not match:
        raise EngineError(f"Could not read the duration of {path.name}.")
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def has_audio_stream(path: Path) -> bool:
    proc = subprocess.run(
        [require_ffmpeg(), "-hide_banner", "-i", str(path)],
        capture_output=True,
        text=True,
        timeout=60,
    )
    return "Audio:" in (proc.stderr or "")


_COMPRESSION_LADDER = (
    {"crf": "26", "maxrate": "3M", "audio": "128k", "scale": None},
    {"crf": "28", "maxrate": "2.2M", "audio": "96k", "scale": None},
    {"crf": "30", "maxrate": "1.6M", "audio": "96k", "scale": "720:1280"},
    {"crf": "33", "maxrate": "1.1M", "audio": "64k", "scale": "720:1280"},
    {"crf": "36", "maxrate": "800k", "audio": "64k", "scale": "540:960"},
)


def compress_to_size(path: Path, target_bytes: int) -> Path:
    """Re-encode until the file fits target_bytes. Returns the final path (mp4)."""
    if path.stat().st_size <= target_bytes:
        return path

    source = path
    for index, step in enumerate(_COMPRESSION_LADDER):
        smaller = path.with_name(f"{path.stem}_c{index}.mp4")
        args = ["-i", str(source)]
        if step["scale"]:
            args += ["-vf", f"scale={step['scale']}"]
        maxrate = step["maxrate"]
        bufsize = f"{float(maxrate[:-1]) * 2:g}{maxrate[-1]}"
        args += [
            "-c:v", "libx264", "-preset", "veryfast",
            "-crf", step["crf"], "-maxrate", maxrate, "-bufsize", bufsize,
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", step["audio"],
            "-map_metadata", "-1",
            "-movflags", "+faststart",
            str(smaller),
        ]
        run_ffmpeg(args)
        if source != path:
            source.unlink(missing_ok=True)
        if smaller.stat().st_size <= target_bytes:
            path.unlink(missing_ok=True)
            return smaller
        source = smaller

    size_mb = source.stat().st_size / (1024 * 1024)
    raise EngineError(f"Video is still too large for Discord after compression ({size_mb:.1f} MB).")
