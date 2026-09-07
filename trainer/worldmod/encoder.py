"""Frozen vision encoder.

product-spec §8.1 is explicit that the encoder is NOT trained: "we do not have
the data for that and we do not pretend to". Only the small dynamics head
learns. That single decision is what makes the whole thing trainable on a
laptop from a handful of episodes.

The spec names DINOv2 or CLIP ViT-B. This uses a torchvision backbone instead,
and the substitution is worth stating plainly rather than burying: DINOv2 comes
from torch.hub, which needs a GitHub round trip and a much larger download, and
nothing here depends on which pretrained features are used — only that they are
pretrained, frozen, and semantically meaningful. Swapping the backbone is one
line if the spec's exact choice matters later.
"""

from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn
from torchvision import models, transforms


def pick_device() -> torch.device:
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


class FrozenEncoder(nn.Module):
    """Pretrained backbone with its classifier removed, in eval mode forever."""

    def __init__(self, device: torch.device | None = None) -> None:
        super().__init__()
        self.device = device or pick_device()

        weights = models.MobileNet_V3_Small_Weights.IMAGENET1K_V1
        backbone = models.mobilenet_v3_small(weights=weights)

        # Keep features + pooling, drop the 1000-way head: we want a
        # representation, not a class prediction.
        self.features = backbone.features
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.dim = backbone.classifier[0].in_features

        for parameter in self.parameters():
            parameter.requires_grad_(False)
        self.eval()
        self.to(self.device)

        self.normalize = transforms.Normalize(
            mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]
        )

    @torch.no_grad()
    def encode(self, frames: np.ndarray, batch_size: int = 32) -> torch.Tensor:
        """(T, H, W, 3) uint8 → (T, dim) float32 latents on the CPU."""
        out: list[torch.Tensor] = []

        for start in range(0, len(frames), batch_size):
            chunk = frames[start : start + batch_size]
            batch = torch.from_numpy(np.ascontiguousarray(chunk)).permute(0, 3, 1, 2)
            batch = self.normalize(batch.float().div_(255.0)).to(self.device)

            latents = self.pool(self.features(batch)).flatten(1)
            out.append(latents.detach().to("cpu"))

        return torch.cat(out) if out else torch.zeros(0, self.dim)
