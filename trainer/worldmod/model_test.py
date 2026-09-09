"""step() has to agree with forward(), because export_live.py trusts it to.

A GRU is causal, so feeding it one timestep at a time with the running hidden
state should reproduce exactly what forward() computes over the whole
sequence at once. This checks that directly rather than assuming it — the
live prediction path used during capture is built entirely on step(), and a
divergence here would show up on a phone as a prediction that quietly does
not match what the model was actually trained and evaluated to do.
"""

from __future__ import annotations

import torch

from .model import LatentDynamics, baseline_error


def test_step_matches_forward_over_a_sequence() -> None:
    torch.manual_seed(0)
    model = LatentDynamics(latent_dim=8, motion_dim=6, hidden=16)
    model.eval()

    T = 5
    latents = torch.randn(1, T, 8)
    motion = torch.randn(1, T, 6)

    with torch.no_grad():
        expected = model(latents, motion)  # (1, T, 8)

        hidden = None
        stepped = []
        for t in range(T):
            pred, hidden = model.step(latents[:, t], motion[:, t], hidden)
            stepped.append(pred)
        stepped = torch.stack(stepped, dim=1)  # (1, T, 8)

    torch.testing.assert_close(stepped, expected, atol=1e-5, rtol=1e-4)


def test_step_hidden_state_actually_carries_information() -> None:
    """A hidden state that was silently dropped would still "pass" a shape
    check, so this asserts the state changes the output rather than merely
    existing."""
    torch.manual_seed(1)
    model = LatentDynamics(latent_dim=4, motion_dim=6, hidden=8)
    model.eval()

    latent = torch.randn(1, 4)
    motion = torch.randn(1, 6)

    with torch.no_grad():
        pred_from_zero, _ = model.step(latent, motion, None)
        pred_from_nonzero, _ = model.step(latent, motion, torch.randn(1, 1, 8))

    assert not torch.allclose(pred_from_zero, pred_from_nonzero)


def test_baseline_error_matches_manual_computation() -> None:
    latents = torch.tensor([[[0.0], [1.0], [3.0], [6.0]]])
    # horizon=1: pairs (0,1),(1,3),(3,6) -> squared diffs 1,4,9 -> mean 14/3
    result = baseline_error(latents, horizon=1)
    torch.testing.assert_close(result, torch.tensor(14.0 / 3.0))
