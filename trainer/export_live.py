"""Export the trained world model for live inference during capture.

    python export_live.py --data ../web/.data --out ../web/public/models/world

Trains the same production model run.py's headline number comes from — same
split, same hyperparameters, same seed — and exports it as a single ONNX
graph the Node server can step through one frame at a time while a
contributor is recording.

Why the encoder is inside the exported graph rather than swapped for a
browser-side TFJS model: the frozen backbone is standard, untouched
ImageNet-pretrained MobileNetV3-Small, so a TFJS copy of the same public
weights would be numerically close but not identical, and "close" is not
good enough when the dynamics head downstream was trained against this
exact encoder's exact outputs. Exporting both together as one graph is the
only way live predictions actually come from the model that was evaluated.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import torch
import torch.nn as nn

from worldmod.data import load_episodes
from worldmod.encoder import FrozenEncoder, pick_device
from worldmod.experiment import encode_episodes, split_by_contributor, train_once


class LiveWorldModel(nn.Module):
    """Encoder + one dynamics step, fused into a single ONNX-exportable graph.

    Takes an already-normalised frame (ImageNet mean/std applied — see
    encoder.FrozenEncoder.encode, which this must match exactly), the current
    motion token, and the previous GRU hidden state. Returns the predicted
    latent `horizon` steps ahead, the current frame's own latent (so the
    caller can add it to a nearest-neighbour bank without a second forward
    pass), and the updated hidden state to feed back on the next call.

    Both outputs are in STANDARDISED space — the same space the model was
    trained and evaluated in — because nearest-neighbour search only needs
    distances to be comparable to each other, not to be in any particular
    unit, and converting back to raw latent space would need the same
    mean/std again for no benefit.
    """

    def __init__(self, encoder: FrozenEncoder, head: nn.Module, latent_mean: torch.Tensor, latent_std: torch.Tensor):
        super().__init__()
        self.features = encoder.features
        self.pool = encoder.pool
        self.head = head
        # Buffers, not parameters: they must travel with the model into the
        # ONNX graph and be applied on every call, but never receive a
        # gradient — nothing here is training.
        self.register_buffer("latent_mean", latent_mean.view(1, -1))
        self.register_buffer("latent_std", latent_std.view(1, -1))

    def forward(
        self, frame: torch.Tensor, motion: torch.Tensor, hidden: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        raw_latent = self.pool(self.features(frame)).flatten(1)
        current = (raw_latent - self.latent_mean) / self.latent_std
        predicted, hidden_next = self.head.step(current, motion, hidden)
        return predicted, current, hidden_next


def main() -> int:
    parser = argparse.ArgumentParser(description="Export the world model for live capture")
    parser.add_argument("--data", type=Path, default=Path("../web/.data"))
    parser.add_argument("--out", type=Path, default=Path("../web/public/models/world"))
    parser.add_argument("--fps", type=float, default=4.0)
    parser.add_argument("--size", type=int, default=160)
    parser.add_argument("--horizon", type=int, default=2)
    parser.add_argument("--epochs", type=int, default=120)
    parser.add_argument("--hidden", type=int, default=256)
    args = parser.parse_args()

    episodes = load_episodes(args.data)
    if len(episodes) < 3:
        print("need at least 3 episodes to train and hold anything out", file=sys.stderr)
        return 1

    # CPU rather than pick_device(): onnx export of a traced graph pins the
    # device the trace was taken on into the graph, and the Node server this
    # runs on has no GPU. Training briefly on CPU costs seconds at this scale.
    device = torch.device("cpu")
    encoder = FrozenEncoder(device=device)
    encoded = encode_episodes(episodes, encoder, fps=args.fps, size=args.size)
    if len(encoded) < 3:
        print("fewer than 3 episodes decoded successfully", file=sys.stderr)
        return 1

    train, held = split_by_contributor(encoded)
    print(f"training on {len(train)} episodes, holding out {len(held)}")

    error, baseline, parameters, trained = train_once(
        train, held, horizon=args.horizon, seed=0, epochs=args.epochs,
        device=device, hidden=args.hidden, return_model=True,
    )
    print(f"held-out error {error:.5f} vs baseline {baseline:.5f} ({parameters:,} params)")

    live = LiveWorldModel(encoder, trained.model, trained.latent_mean, trained.latent_std)
    live.eval()

    dummy_frame = torch.zeros(1, 3, args.size, args.size)
    dummy_motion = torch.zeros(1, 6)
    dummy_hidden = torch.zeros(1, 1, args.hidden)

    args.out.mkdir(parents=True, exist_ok=True)
    onnx_path = args.out / "live.onnx"

    torch.onnx.export(
        live,
        (dummy_frame, dummy_motion, dummy_hidden),
        str(onnx_path),
        input_names=["frame", "motion", "hidden"],
        output_names=["predicted", "current", "hidden_next"],
        opset_version=18,
        dynamic_axes=None,  # Fixed batch=1: one frame at a time, one contributor.
    )
    print(f"wrote {onnx_path} ({onnx_path.stat().st_size / 1024:.0f} KB)")

    meta = {
        "size": args.size,
        "latentDim": trained.latent_dim,
        "hiddenSize": args.hidden,
        "motionDim": 6,
        "horizon": args.horizon,
        "trainEpisodes": len(train),
        "heldoutEpisodes": len(held),
        "heldoutError": error,
        "baselineError": baseline,
        # ImageNet normalisation the frame must already have before it reaches
        # this graph — encoder.py applies it during training and the Node
        # server has to apply the identical constants live.
        "imagenetMean": [0.485, 0.456, 0.406],
        "imagenetStd": [0.229, 0.224, 0.225],
    }
    meta_path = args.out / "live-meta.json"
    meta_path.write_text(json.dumps(meta, indent=2) + "\n")
    print(f"wrote {meta_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
