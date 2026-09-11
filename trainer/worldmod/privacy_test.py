"""Tests for the differential-privacy primitives (trainer/worldmod/privacy.py).

These are pure and deterministic — no model, no data, no network — so the DP
math can be trusted independently of the federated run that uses it.
"""

from __future__ import annotations

import math

import pytest
import torch

from .privacy import add_gaussian_noise, clip_update, gaussian_sigma, l2_norm


def test_gaussian_sigma_known_value():
    # σ = C·√(2·ln(1.25/δ))/ε ; C=1, ε=1, δ=1e-5
    expected = math.sqrt(2.0 * math.log(1.25 / 1e-5))
    assert gaussian_sigma(1.0, 1.0, 1e-5) == pytest.approx(expected, rel=1e-12)
    assert gaussian_sigma(1.0, 1.0, 1e-5) == pytest.approx(4.8455, abs=1e-3)


def test_gaussian_sigma_scales_with_clip_and_epsilon():
    base = gaussian_sigma(1.0, 1.0, 1e-5)
    # Linear in the clip norm (sensitivity), inverse in epsilon.
    assert gaussian_sigma(2.0, 1.0, 1e-5) == pytest.approx(2.0 * base)
    assert gaussian_sigma(1.0, 2.0, 1e-5) == pytest.approx(base / 2.0)


def test_gaussian_sigma_rejects_bad_params():
    with pytest.raises(ValueError):
        gaussian_sigma(1.0, 0.0, 1e-5)  # epsilon must be > 0
    with pytest.raises(ValueError):
        gaussian_sigma(1.0, 1.0, 0.0)  # delta in (0,1)
    with pytest.raises(ValueError):
        gaussian_sigma(1.0, 1.0, 1.0)  # delta in (0,1)
    with pytest.raises(ValueError):
        gaussian_sigma(-1.0, 1.0, 1e-5)  # clip must be >= 0


def test_l2_norm_across_tensors():
    # 3-4-5 across two tensors: sqrt(3^2 + 4^2) = 5
    update = {"a": torch.tensor([3.0]), "b": torch.tensor([4.0])}
    assert l2_norm(update) == pytest.approx(5.0)


def test_clip_update_scales_down_over_bound():
    update = {"a": torch.tensor([3.0]), "b": torch.tensor([4.0])}  # norm 5
    clipped = clip_update(update, 1.0)
    assert l2_norm(clipped) == pytest.approx(1.0, abs=1e-6)
    # Direction preserved (each component scaled by the same factor 1/5).
    assert clipped["a"].item() == pytest.approx(0.6)
    assert clipped["b"].item() == pytest.approx(0.8)


def test_clip_update_leaves_small_update_unchanged():
    update = {"a": torch.tensor([0.3]), "b": torch.tensor([0.4])}  # norm 0.5
    clipped = clip_update(update, 1.0)
    assert l2_norm(clipped) == pytest.approx(0.5)


def test_clip_update_handles_zero_update():
    update = {"a": torch.zeros(3), "b": torch.zeros(2)}
    clipped = clip_update(update, 1.0)  # must not divide by zero
    assert l2_norm(clipped) == pytest.approx(0.0)


def test_add_gaussian_noise_zero_sigma_is_identity():
    update = {"a": torch.tensor([1.0, 2.0, 3.0])}
    out = add_gaussian_noise(update, 0.0)
    assert torch.equal(out["a"], update["a"])


def test_add_gaussian_noise_is_seeded_and_shifts_values():
    update = {"a": torch.zeros(10000)}
    g1 = torch.Generator().manual_seed(7)
    g2 = torch.Generator().manual_seed(7)
    out1 = add_gaussian_noise(update, 2.0, g1)
    out2 = add_gaussian_noise(update, 2.0, g2)
    # Deterministic given the same seed.
    assert torch.equal(out1["a"], out2["a"])
    # Not identity, and empirically ~N(0, sigma^2).
    assert not torch.equal(out1["a"], update["a"])
    assert out1["a"].std().item() == pytest.approx(2.0, rel=0.1)
    assert out1["a"].mean().item() == pytest.approx(0.0, abs=0.1)
