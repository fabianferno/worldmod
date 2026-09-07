"""The latent forward-dynamics model — product-spec §8.1.

    frame_t ──[frozen encoder]──> z_t ─┐
                                       ├──> [GRU] ──> ẑ_{t+k}
    motion_t (from IMU) ───────────────┘

A few hundred thousand parameters, trainable on a laptop in minutes. That is
the honest scale for the data this network can currently collect, and the spec
says so: a manipulation policy cannot be learned from a hundred phone episodes,
and claiming otherwise gets caught.
"""

from __future__ import annotations

import torch
import torch.nn as nn


class LatentDynamics(nn.Module):
    """Predicts the latent k steps ahead from the latent now plus head motion."""

    def __init__(self, latent_dim: int, motion_dim: int = 6, hidden: int = 256) -> None:
        super().__init__()
        self.latent_dim = latent_dim

        self.input_proj = nn.Sequential(
            nn.Linear(latent_dim + motion_dim, hidden),
            nn.LayerNorm(hidden),
            nn.GELU(),
        )
        self.gru = nn.GRU(hidden, hidden, batch_first=True)

        # Predicts the DELTA rather than the next latent outright. Consecutive
        # frames are highly correlated, so predicting the absolute value lets a
        # model score well by copying its input; predicting the change does not
        # reward that.
        self.head = nn.Linear(hidden, latent_dim)

    def forward(self, latents: torch.Tensor, motion: torch.Tensor) -> torch.Tensor:
        """(B, T, D) latents and (B, T, M) motion → (B, T, D) predictions."""
        x = self.input_proj(torch.cat([latents, motion], dim=-1))
        hidden, _ = self.gru(x)
        return latents + self.head(hidden)

    @property
    def parameter_count(self) -> int:
        return sum(p.numel() for p in self.parameters())


def baseline_error(latents: torch.Tensor, horizon: int) -> torch.Tensor:
    """Error from predicting no change at all.

    The number every result has to beat. Latents from adjacent frames are so
    similar that "assume nothing moved" is a strong baseline, and a model that
    cannot beat it has learned nothing about dynamics — it has only learned
    that video is smooth.
    """
    if latents.shape[1] <= horizon:
        return torch.tensor(float("nan"))

    current = latents[:, :-horizon]
    future = latents[:, horizon:]
    return torch.nn.functional.mse_loss(current, future)
