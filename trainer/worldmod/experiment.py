"""Training, the scaling curve, and leave-one-contributor-out utility.

Implements product-spec §8.2 and §8.3, including the caveats the spec itself
insists on: leave-one-out is a crude Shapley approximation, deltas are noisy at
small N, and variance across seeds is reported rather than hidden.

One correction to the spec. §8.3 describes holding out episodes; this holds out
CONTRIBUTORS. With a random episode split, some held-out episodes belong to the
same contributor whose training data is being removed, so removing them inflates
error on their own evaluation clips and pays them for correlating with
themselves. Splitting by contributor removes that.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from .data import Episode, extract_frames, motion_tokens
from .encoder import FrozenEncoder, pick_device
from .model import LatentDynamics, baseline_error


@dataclass
class EncodedEpisode:
    episode_id: str
    entity_id: str
    bounty_id: str
    latents: torch.Tensor  # (T, D)
    motion: torch.Tensor  # (T, 6)


@dataclass
class CurvePoint:
    episodes: int
    mean_error: float
    std_error: float
    seeds: int


@dataclass
class ContributorUtility:
    entity_id: str
    episodes: int
    delta: float
    share: float


@dataclass
class Results:
    encoder: str
    latent_dim: int
    parameters: int
    horizon: int
    train_episodes: int
    heldout_episodes: int
    heldout_contributors: list[str]
    baseline_error: float
    model_error: float
    improvement: float
    curve: list[CurvePoint] = field(default_factory=list)
    utility: list[ContributorUtility] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def encode_episodes(
    episodes: list[Episode], encoder: FrozenEncoder, fps: float, size: int
) -> list[EncodedEpisode]:
    encoded: list[EncodedEpisode] = []

    for episode in episodes:
        frames = extract_frames(episode.video_path, fps=fps, size=size)
        if len(frames) < 8:
            continue

        times = np.arange(len(frames), dtype=np.float32) * (1000.0 / fps)
        latents = encoder.encode(frames)
        motion = torch.from_numpy(motion_tokens(episode.imu, times))

        encoded.append(
            EncodedEpisode(
                episode_id=episode.episode_id,
                entity_id=episode.entity_id,
                bounty_id=episode.bounty_id,
                latents=latents,
                motion=motion,
            )
        )

    return encoded


def _standardise(
    train: list[EncodedEpisode], held: list[EncodedEpisode]
) -> tuple[list[EncodedEpisode], list[EncodedEpisode]]:
    """Centre and scale latents using TRAINING statistics only.

    Computing them over everything would leak the held-out set into training and
    quietly flatter every number below.
    """
    stacked = torch.cat([e.latents for e in train])
    mean = stacked.mean(0, keepdim=True)
    std = stacked.std(0, keepdim=True).clamp_min(1e-6)

    def apply(items: list[EncodedEpisode]) -> list[EncodedEpisode]:
        return [
            EncodedEpisode(e.episode_id, e.entity_id, e.bounty_id, (e.latents - mean) / std, e.motion)
            for e in items
        ]

    return apply(train), apply(held)


def train_once(
    train: list[EncodedEpisode],
    held: list[EncodedEpisode],
    horizon: int,
    seed: int,
    epochs: int = 120,
    device: torch.device | None = None,
    hidden: int = 256,
) -> tuple[float, float, int]:
    """Train on `train`, return (model error, baseline error, parameters)."""
    device = device or pick_device()
    torch.manual_seed(seed)

    train, held = _standardise(train, held)
    latent_dim = train[0].latents.shape[1]

    model = LatentDynamics(latent_dim, hidden=hidden).to(device)
    optimiser = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)

    batches = [
        (e.latents.unsqueeze(0).to(device), e.motion.unsqueeze(0).to(device)) for e in train
    ]

    model.train()
    for _ in range(epochs):
        for latents, motion in batches:
            if latents.shape[1] <= horizon:
                continue
            optimiser.zero_grad()
            predicted = model(latents[:, :-horizon], motion[:, :-horizon])
            loss = F.mse_loss(predicted, latents[:, horizon:])
            loss.backward()
            optimiser.step()

    model.eval()
    errors: list[float] = []
    baselines: list[float] = []

    with torch.no_grad():
        for episode in held:
            latents = episode.latents.unsqueeze(0).to(device)
            motion = episode.motion.unsqueeze(0).to(device)
            if latents.shape[1] <= horizon:
                continue

            predicted = model(latents[:, :-horizon], motion[:, :-horizon])
            errors.append(F.mse_loss(predicted, latents[:, horizon:]).item())
            baselines.append(baseline_error(latents, horizon).item())

    if not errors:
        return float("nan"), float("nan"), model.parameter_count

    return float(np.mean(errors)), float(np.mean(baselines)), model.parameter_count


def split_by_contributor(
    episodes: list[EncodedEpisode], holdout_fraction: float = 0.34
) -> tuple[list[EncodedEpisode], list[EncodedEpisode]]:
    """Hold out whole contributors, never a random slice of episodes."""
    contributors = sorted({e.entity_id for e in episodes})
    if len(contributors) < 2:
        # Cannot split by contributor with only one; fall back and say so.
        cut = max(1, int(len(episodes) * holdout_fraction))
        return episodes[cut:], episodes[:cut]

    held_count = max(1, round(len(contributors) * holdout_fraction))
    held_ids = set(contributors[:held_count])

    held = [e for e in episodes if e.entity_id in held_ids]
    train = [e for e in episodes if e.entity_id not in held_ids]
    return train, held


def scaling_curve(
    train: list[EncodedEpisode],
    held: list[EncodedEpisode],
    horizon: int,
    seeds: int = 3,
    hidden: int = 256,
) -> list[CurvePoint]:
    """Held-out error against the number of episodes trained on.

    §8.2 asks for a curve with the noise visible rather than one fabricated
    before/after number, so every point carries the spread across seeds.
    """
    points: list[CurvePoint] = []
    sizes = sorted({max(1, round(len(train) * f)) for f in (0.25, 0.5, 0.75, 1.0)})

    for size in sizes:
        runs = [
            train_once(train[:size], held, horizon=horizon, seed=seed, hidden=hidden)[0]
            for seed in range(seeds)
        ]
        finite = [r for r in runs if np.isfinite(r)]
        if not finite:
            continue

        points.append(
            CurvePoint(
                episodes=size,
                mean_error=float(np.mean(finite)),
                std_error=float(np.std(finite)),
                seeds=len(finite),
            )
        )

    return points


def leave_one_contributor_out(
    train: list[EncodedEpisode],
    held: list[EncodedEpisode],
    horizon: int,
    seeds: int = 2,
) -> list[ContributorUtility]:
    """Each contributor's measured effect on held-out error — §8.3."""
    contributors = sorted({e.entity_id for e in train})
    if len(contributors) < 2:
        return []

    full = float(np.mean([
        train_once(train, held, horizon=horizon, seed=s)[0] for s in range(seeds)
    ]))

    deltas: dict[str, float] = {}
    for entity in contributors:
        without = [e for e in train if e.entity_id != entity]
        if not without:
            continue

        reduced = float(np.mean([
            train_once(without, held, horizon=horizon, seed=s)[0] for s in range(seeds)
        ]))
        # Positive means removing them made the model worse — they helped.
        # Floored at zero: a negative share would mean owing money back, and
        # the noise at this sample size easily produces one.
        deltas[entity] = max(0.0, reduced - full)

    total = sum(deltas.values())
    return [
        ContributorUtility(
            entity_id=entity,
            episodes=sum(1 for e in train if e.entity_id == entity),
            delta=delta,
            share=(delta / total) if total > 0 else 0.0,
        )
        for entity, delta in sorted(deltas.items(), key=lambda kv: -kv[1])
    ]


def write_results(results: Results, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(results), indent=2) + "\n")
