"""Data compression engine.

Two surfaces:
  * /compress/media — ffmpeg pipeline (audio→opus/aac, image→webp/avif, video→H.265)
  * /compress/blob  — generic byte compression (zstd default, brotli optional)

Wire from main.py:
    from compress import router as compress_router
    app.include_router(compress_router, prefix="/compress")

Dependencies (already in requirements.txt of template-backend):
  ffmpeg-python   for the wrapper API
  zstandard       for fast generic compression

System requirement: ffmpeg binary on PATH. On Railway, add to the Dockerfile:
  RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
"""
from __future__ import annotations

import io
import subprocess
import tempfile
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, File, HTTPException, UploadFile

router = APIRouter()

# --- Generic blob compression (zstd) ----------------------------------------

try:
    import zstandard as zstd
    _zstd_available = True
except ImportError:
    _zstd_available = False


@router.post("/blob")
async def compress_blob(
    file: UploadFile = File(...),
    level: int = 3,
    algo: Literal["zstd", "brotli", "gzip"] = "zstd",
) -> dict:
    """Compress arbitrary bytes. Returns compressed size + ratio."""
    raw = await file.read()
    original = len(raw)

    if algo == "zstd":
        if not _zstd_available:
            raise HTTPException(500, "zstandard not installed")
        compressed = zstd.ZstdCompressor(level=level).compress(raw)
    elif algo == "gzip":
        import gzip
        compressed = gzip.compress(raw, compresslevel=min(level, 9))
    elif algo == "brotli":
        try:
            import brotli
        except ImportError as e:
            raise HTTPException(500, "brotli not installed") from e
        compressed = brotli.compress(raw, quality=min(level, 11))
    else:
        raise HTTPException(400, f"unknown algo: {algo}")

    return {
        "original_bytes": original,
        "compressed_bytes": len(compressed),
        "ratio": round(len(compressed) / original, 4) if original else 0,
        "algo": algo,
        # In production, write `compressed` to R2 and return the key instead
        # of base64-ing megabytes through the response body.
    }


# --- Media compression (ffmpeg) ---------------------------------------------

MEDIA_PROFILES = {
    "audio_opus":  ["-c:a", "libopus", "-b:a", "96k"],
    "audio_aac":   ["-c:a", "aac",     "-b:a", "128k"],
    "image_webp":  ["-c:v", "libwebp", "-quality", "80"],
    "image_avif":  ["-c:v", "libaom-av1", "-crf", "30", "-still-picture", "1"],
    "video_h265":  ["-c:v", "libx265", "-crf", "28", "-preset", "medium", "-c:a", "aac", "-b:a", "128k"],
    "video_av1":   ["-c:v", "libsvtav1", "-crf", "30", "-preset", "6",  "-c:a", "libopus", "-b:a", "96k"],
}

ProfileName = Literal[
    "audio_opus", "audio_aac",
    "image_webp", "image_avif",
    "video_h265", "video_av1",
]


def _ffmpeg_available() -> bool:
    try:
        subprocess.run(["ffmpeg", "-version"], check=True, capture_output=True, timeout=5)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return False


@router.post("/media")
async def compress_media(
    file: UploadFile = File(...),
    profile: ProfileName = "video_h265",
) -> dict:
    """Run a media compression profile via ffmpeg."""
    if not _ffmpeg_available():
        raise HTTPException(500, "ffmpeg binary not available on PATH")

    args = MEDIA_PROFILES.get(profile)
    if not args:
        raise HTTPException(400, f"unknown profile: {profile}")

    in_ext = Path(file.filename or "in.bin").suffix or ".bin"
    out_ext = {
        "audio_opus": ".opus", "audio_aac": ".m4a",
        "image_webp": ".webp", "image_avif": ".avif",
        "video_h265": ".mp4",  "video_av1":  ".mp4",
    }[profile]

    with tempfile.NamedTemporaryFile(suffix=in_ext, delete=False) as in_f:
        in_f.write(await file.read())
        in_path = in_f.name

    out_path = in_path + out_ext

    cmd = ["ffmpeg", "-y", "-i", in_path, *args, out_path]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        Path(in_path).unlink(missing_ok=True)
        raise HTTPException(500, f"ffmpeg failed: {proc.stderr.decode()[-400:]}")

    in_size = Path(in_path).stat().st_size
    out_size = Path(out_path).stat().st_size

    # In production: upload `out_path` to R2 and return the key, not the bytes.
    Path(in_path).unlink(missing_ok=True)

    return {
        "profile": profile,
        "original_bytes": in_size,
        "compressed_bytes": out_size,
        "ratio": round(out_size / in_size, 4) if in_size else 0,
        "tmp_path": out_path,   # caller is responsible for cleanup or R2 upload
    }
