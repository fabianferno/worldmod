"""Does the exported ONNX graph actually agree with the PyTorch model it came from?

An export that runs without error is not the same as an export that is
correct — a wrong axis, a silently-dropped hidden state, or an opset that
handles GRU differently would all produce a graph that loads and returns
*something* without ever raising. This retrains the identical model export_live.py
would, exports it to a throwaway path, and compares PyTorch's and ONNX
Runtime's outputs frame by frame over a real multi-step sequence — checking
that the recurrence itself survived the export, not just a single call.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch

sys.path.insert(0, str(Path(__file__).parent))

from export_live import LiveWorldModel
from worldmod.data import load_episodes
from worldmod.encoder import FrozenEncoder
from worldmod.experiment import encode_episodes, split_by_contributor, train_once


def main() -> int:
    data_dir = Path(__file__).parent.parent / "web" / ".data"
    episodes = load_episodes(data_dir)
    if len(episodes) < 3:
        print("need real episodes to verify against", file=sys.stderr)
        return 1

    device = torch.device("cpu")
    size = 160
    encoder = FrozenEncoder(device=device)
    encoded = encode_episodes(episodes, encoder, fps=4.0, size=size)
    train, held = split_by_contributor(encoded)

    _, _, _, trained = train_once(
        train, held, horizon=2, seed=0, epochs=120, device=device, hidden=256, return_model=True,
    )

    live = LiveWorldModel(encoder, trained.model, trained.latent_mean, trained.latent_std)
    live.eval()

    with tempfile.TemporaryDirectory() as tmp:
        onnx_path = Path(tmp) / "live.onnx"
        torch.onnx.export(
            live,
            (torch.zeros(1, 3, size, size), torch.zeros(1, 6), torch.zeros(1, 1, 256)),
            str(onnx_path),
            input_names=["frame", "motion", "hidden"],
            output_names=["predicted", "current", "hidden_next"],
            opset_version=18,
        )
        session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])

        # A real sequence of frames from a real episode, run through both
        # implementations one step at a time with the hidden state fed back —
        # this is exactly what the Node server will do, per-request, over the
        # course of a 15s take.
        probe_id = (held[0] if held else train[0]).episode_id
        probe_episode = next(e for e in episodes if e.episode_id == probe_id)

        from worldmod.data import extract_frames, motion_tokens

        raw_frames = extract_frames(probe_episode.video_path, fps=4.0, size=size)[:8]
        times = np.arange(len(raw_frames), dtype=np.float32) * 250.0
        motion = motion_tokens(probe_episode.imu, times)

        torch_hidden: torch.Tensor | None = None
        onnx_hidden = np.zeros((1, 1, 256), dtype=np.float32)

        worst_pred_diff = 0.0
        worst_cur_diff = 0.0
        worst_hidden_diff = 0.0

        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)

        # Dump the first raw frame's exact bytes (HWC, uint8, RGB) so a
        # separate Node script can run the identical bytes through the
        # server-side preprocessing pipeline and compare against this run's
        # "current" latent — the piece PyTorch/ONNX parity alone cannot check,
        # since that only exercised an already-normalised tensor.
        dump_path = Path(__file__).parent / "verify_frame0.bin"
        dump_path.write_bytes(raw_frames[0].tobytes())
        print(f"dumped frame 0 ({raw_frames[0].shape}) to {dump_path}")

        for i, raw in enumerate(raw_frames):
            chw = raw.astype(np.float32).transpose(2, 0, 1) / 255.0
            chw = (chw - mean[:, None, None]) / std[:, None, None]
            frame_t = torch.from_numpy(chw).unsqueeze(0)
            motion_t = torch.from_numpy(motion[i : i + 1])

            with torch.no_grad():
                t_pred, t_cur, torch_hidden = live(frame_t, motion_t, torch_hidden if torch_hidden is not None else torch.zeros(1, 1, 256))

            o_pred, o_cur, onnx_hidden = session.run(
                None,
                {
                    "frame": frame_t.numpy(),
                    "motion": motion_t.numpy(),
                    "hidden": onnx_hidden,
                },
            )

            pred_diff = float(np.abs(t_pred.numpy() - o_pred).max())
            cur_diff = float(np.abs(t_cur.numpy() - o_cur).max())
            hidden_diff = float(np.abs(torch_hidden.numpy() - onnx_hidden).max())
            worst_pred_diff = max(worst_pred_diff, pred_diff)
            worst_cur_diff = max(worst_cur_diff, cur_diff)
            worst_hidden_diff = max(worst_hidden_diff, hidden_diff)
            print(f"  step {i}: predicted diff {pred_diff:.2e}  current diff {cur_diff:.2e}  hidden diff {hidden_diff:.2e}")
            if i == 0:
                print(f"  frame 0 current[:5] (python): {t_cur.numpy().flatten()[:5].tolist()}")

        print(f"\nworst over {len(raw_frames)} steps: predicted {worst_pred_diff:.2e}, "
              f"current {worst_cur_diff:.2e}, hidden {worst_hidden_diff:.2e}")

        tolerance = 1e-3
        if worst_pred_diff > tolerance or worst_cur_diff > tolerance or worst_hidden_diff > tolerance:
            print(f"\nFAIL: exceeds tolerance {tolerance}", file=sys.stderr)
            return 1

        print(f"\nPASS: ONNX export matches PyTorch within {tolerance} over a multi-step sequence")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
