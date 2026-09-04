"""Loading recorded episodes: frames, motion, and who contributed them.

Reads the same artefacts the PWA uploads — a WebM video and the binary IMU
stream defined in web/src/lib/capture/imu-codec.ts — so the trainer consumes
exactly what the network collects, with no intermediate export step that could
drift from it.
"""

from __future__ import annotations

import json
import struct
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# Mirrors IMU_MAGIC / the layout documented in imu-codec.ts.
_MAGIC = b"WMIMU1"
_HEADER_BYTES = 20
_SAMPLE_BYTES = 28
_FIELDS = 7


@dataclass(frozen=True)
class Episode:
    """One recorded episode, with the identity needed to split honestly."""

    episode_id: str
    entity_id: str
    bounty_id: str
    task: str
    video_path: Path
    imu: np.ndarray  # (N, 7): t_ms, ax, ay, az, rx, ry, rz
    accepted: bool

    @property
    def duration_s(self) -> float:
        return float(self.imu[-1, 0] / 1000.0) if len(self.imu) else 0.0


def decode_imu(path: Path) -> np.ndarray:
    """Parse the binary IMU stream written by the capture client."""
    raw = path.read_bytes()
    if len(raw) < _HEADER_BYTES or raw[:6] != _MAGIC:
        raise ValueError(f"{path} is not an IMU stream")

    count = struct.unpack_from("<I", raw, 16)[0]
    expected = _HEADER_BYTES + count * _SAMPLE_BYTES
    if len(raw) != expected:
        raise ValueError(f"{path} declares {count} samples but is {len(raw)} bytes")

    body = np.frombuffer(raw, dtype="<f4", count=count * _FIELDS, offset=_HEADER_BYTES)
    return body.reshape(count, _FIELDS).astype(np.float32)


def load_episodes(data_dir: Path) -> list[Episode]:
    """Every episode with both streams on disk, joined to its market record."""
    market = json.loads((data_dir / "market.json").read_text())
    records = {e["episode_id"]: e for e in market.get("episodes", [])}

    episodes: list[Episode] = []
    for directory in sorted((data_dir / "episodes").iterdir()):
        # The container varies by device — Safari records MP4, Chromium WebM —
        # so match on the stream name and take whatever extension it landed in.
        videos = sorted(directory.glob("rgb.*"))
        imu_path = directory / "imu.bin"
        if not (videos and imu_path.exists()):
            continue
        video = videos[0]

        record = records.get(directory.name, {})
        episodes.append(
            Episode(
                episode_id=directory.name,
                # Falls back to the episode id so an unmatched episode is its
                # own contributor rather than silently joining someone else's.
                entity_id=record.get("entity_id", directory.name),
                bounty_id=record.get("bounty_id", "unknown"),
                task=record.get("bounty_id", "unknown"),
                video_path=video,
                imu=decode_imu(imu_path),
                accepted=bool(record.get("accepted", False)),
            )
        )
    return episodes


def extract_frames(video: Path, fps: float, size: int) -> np.ndarray:
    """Decode to a (T, size, size, 3) uint8 array at a fixed sample rate.

    Square-cropped rather than squashed: the encoder was trained on natural
    aspect ratios, and stretching a portrait frame to a square changes the
    shape of everything in it.
    """
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0", str(video)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    width, height = (int(v) for v in probe.split(","))
    edge = min(width, height)
    x = (width - edge) // 2
    y = (height - edge) // 2

    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(video),
         "-vf", f"fps={fps},crop={edge}:{edge}:{x}:{y},scale={size}:{size}",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True, check=True,
    ).stdout

    stride = size * size * 3
    count = len(raw) // stride
    return np.frombuffer(raw, dtype=np.uint8, count=count * stride).reshape(count, size, size, 3)


def motion_tokens(imu: np.ndarray, frame_times_ms: np.ndarray) -> np.ndarray:
    """Mean acceleration and rotation over each frame interval.

    This is the action signal. product-spec §8.1 makes the point that
    egocentric capture gives it for free: the camera is attached to the actor,
    so the wearer's own head movement labels the transition between frames.
    """
    tokens = np.zeros((len(frame_times_ms), 6), dtype=np.float32)
    if len(imu) == 0:
        return tokens

    times = imu[:, 0]
    for i, end in enumerate(frame_times_ms):
        start = frame_times_ms[i - 1] if i > 0 else 0.0
        mask = (times >= start) & (times < end)
        if mask.any():
            tokens[i] = imu[mask, 1:].mean(axis=0)
        elif i > 0:
            # Hold the previous token rather than inserting a false zero, which
            # would read as "the head stopped" during a gap in the stream.
            tokens[i] = tokens[i - 1]

    return tokens
