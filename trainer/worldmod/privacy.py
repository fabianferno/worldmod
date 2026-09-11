"""Differential-privacy primitives for the federated round — product-spec §9.

Pure, deterministic building blocks for DP-FedAvg, kept separate from the
federated loop so the DP math can be tested on its own and trusted regardless
of the model or the data.

The mechanism is the **analytic Gaussian mechanism**, applied **per round**:
clip each client update to L2 norm C (so one client's contribution has bounded
sensitivity), sum the clipped updates, and add i.i.d. Gaussian noise with

    σ = C · √(2·ln(1.25/δ)) / ε

which is the classic (ε, δ)-DP calibration for an L2-sensitivity of C
(Dwork & Roth, Thm. 3.22). The guarantee is **per round and NOT composed**
across rounds — reporting a composed budget would need an RDP/moments
accountant, which this deliberately does not claim.
"""

from __future__ import annotations

import math

import torch

StateDict = dict[str, torch.Tensor]


def gaussian_sigma(clip_norm: float, epsilon: float, delta: float) -> float:
    """Gaussian-mechanism stddev for L2-sensitivity ``clip_norm`` at (ε, δ).

    σ = clip_norm · √(2·ln(1.25/δ)) / ε. Per-round guarantee, not composed.
    """
    if epsilon <= 0:
        raise ValueError("epsilon must be > 0")
    if not 0 < delta < 1:
        raise ValueError("delta must be in (0, 1)")
    if clip_norm < 0:
        raise ValueError("clip_norm must be >= 0")
    return clip_norm * math.sqrt(2.0 * math.log(1.25 / delta)) / epsilon


def l2_norm(update: StateDict) -> float:
    """Global L2 norm of an update, taken across all of its tensors at once."""
    total = 0.0
    for tensor in update.values():
        total += float(tensor.detach().pow(2).sum().item())
    return math.sqrt(total)


def clip_update(update: StateDict, clip_norm: float) -> StateDict:
    """Scale the whole update down so its global L2 norm is ≤ ``clip_norm``.

    Clips the update as a single vector (not per tensor), preserving its
    direction. A no-op when already within the bound or exactly zero.
    """
    norm = l2_norm(update)
    if norm <= clip_norm or norm == 0.0:
        return {k: v.detach().clone() for k, v in update.items()}
    scale = clip_norm / norm
    return {k: v.detach() * scale for k, v in update.items()}


def add_gaussian_noise(
    update: StateDict, sigma: float, generator: torch.Generator | None = None
) -> StateDict:
    """Add i.i.d. N(0, σ²) noise to every element of the update.

    ``generator`` is a CPU torch.Generator and makes the noise reproducible for
    a given seed. Noise is drawn on CPU and moved to the tensor's device, so
    this is safe on CPU, CUDA and MPS alike. σ = 0 is an exact identity (used
    when DP is disabled).
    """
    if sigma == 0.0:
        return {k: v.detach().clone() for k, v in update.items()}
    out: StateDict = {}
    for key, tensor in update.items():
        noise = torch.randn(tensor.shape, generator=generator, dtype=tensor.dtype)
        out[key] = tensor.detach() + noise.to(device=tensor.device) * sigma
    return out
