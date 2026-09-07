"""Train the world model on collected episodes and write the results.

    python run.py --data ../web/.data --out ../web/public/model-results.json

Deliberately writes into the web app's public directory: the buyer dashboard
renders the scaling curve from this file, so there is one artefact and no
chance of the chart and the run disagreeing.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

from worldmod.data import load_episodes
from worldmod.encoder import FrozenEncoder, pick_device
from worldmod.experiment import (
    Results,
    encode_episodes,
    leave_one_contributor_out,
    scaling_curve,
    split_by_contributor,
    train_once,
    write_results,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="World Mod latent dynamics trainer")
    parser.add_argument("--data", type=Path, default=Path("../web/.data"))
    parser.add_argument("--out", type=Path, default=Path("../web/public/model-results.json"))
    parser.add_argument("--fps", type=float, default=4.0)
    parser.add_argument("--size", type=int, default=160)
    parser.add_argument("--horizon", type=int, default=2, help="predict k steps ahead")
    parser.add_argument("--epochs", type=int, default=120)
    parser.add_argument("--hidden", type=int, default=256)
    parser.add_argument("--accepted-only", action="store_true")
    args = parser.parse_args()

    episodes = load_episodes(args.data)
    if args.accepted_only:
        episodes = [e for e in episodes if e.accepted]

    print(f"episodes on disk       : {len(episodes)}")
    if len(episodes) < 3:
        print("need at least 3 episodes to train and hold anything out", file=sys.stderr)
        return 1

    device = pick_device()
    print(f"device                 : {device}")

    encoder = FrozenEncoder(device=device)
    print(f"encoder                : mobilenet_v3_small (frozen), dim={encoder.dim}")

    encoded = encode_episodes(episodes, encoder, fps=args.fps, size=args.size)
    print(f"encoded                : {len(encoded)} episodes, "
          f"{sum(len(e.latents) for e in encoded)} frames")

    contributors = sorted({e.entity_id for e in encoded})
    train, held = split_by_contributor(encoded)
    print(f"contributors           : {len(contributors)}")
    print(f"train / held out       : {len(train)} / {len(held)} episodes")

    notes: list[str] = []
    if len(contributors) < 2:
        notes.append(
            "Only one contributor, so the held-out set is a slice of the same "
            "person's episodes. Utility scoring is not meaningful at this size."
        )
    if len(encoded) < 20:
        notes.append(
            f"Trained on {len(encoded)} episodes. The curve below is real but far "
            "too short to show a trend; product-spec §8.2 targets 100."
        )

    error, baseline, parameters = train_once(
        train, held, horizon=args.horizon, seed=0, epochs=args.epochs, device=device, hidden=args.hidden
    )
    improvement = (baseline - error) / baseline if np.isfinite(baseline) and baseline > 0 else float("nan")

    print(f"parameters             : {parameters:,}")
    print(f"baseline (no change)   : {baseline:.5f}")
    print(f"model                  : {error:.5f}")
    print(f"improvement            : {improvement * 100:.1f}%")

    curve = scaling_curve(train, held, horizon=args.horizon, hidden=args.hidden)
    for point in curve:
        print(f"  {point.episodes:>3} episodes -> {point.mean_error:.5f} ± {point.std_error:.5f}")

    utility = leave_one_contributor_out(train, held, horizon=args.horizon)
    for row in utility:
        print(f"  {row.entity_id[:12]}  {row.episodes} eps  share {row.share * 100:.1f}%")

    results = Results(
        encoder="mobilenet_v3_small (frozen)",
        latent_dim=encoder.dim,
        parameters=parameters,
        horizon=args.horizon,
        train_episodes=len(train),
        heldout_episodes=len(held),
        heldout_contributors=sorted({e.entity_id for e in held}),
        baseline_error=baseline,
        model_error=error,
        improvement=improvement,
        curve=curve,
        utility=utility,
        notes=notes,
    )
    write_results(results, args.out)
    print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
