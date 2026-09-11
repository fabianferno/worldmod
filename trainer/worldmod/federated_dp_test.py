"""Integration tests for DP + client-count thresholds in run_rounds.

Uses tiny synthetic episodes (no encoder, no data, one local epoch) so the
federated loop's DP path and threshold gate are exercised for real, fast.
"""

from __future__ import annotations

import torch

from .experiment import EncodedEpisode
from .federated import run_rounds
from .privacy import gaussian_sigma


def _episodes(n: int, T: int = 8, D: int = 6) -> list[EncodedEpisode]:
    torch.manual_seed(123)
    return [
        EncodedEpisode(f"ep{i}", f"org{i % 2}", "b", torch.randn(T, D), torch.randn(T, 6))
        for i in range(n)
    ]


def test_dp_disabled_leaves_dp_absent():
    res = run_rounds(_episodes(6), _episodes(2), horizon=2, rounds=2, orgs=2, local_epochs=1)
    assert res.rounds
    assert all(r.dp is None for r in res.rounds)
    assert all(r.aggregated for r in res.rounds)
    # Honest note: no privacy claim when DP is off.
    assert any("no privacy guarantee" in n for n in res.notes)


def test_dp_enabled_records_real_calibrated_fields():
    res = run_rounds(
        _episodes(6), _episodes(2), horizon=2, rounds=2, orgs=2, local_epochs=1,
        dp_epsilon=1.0, dp_delta=1e-5, dp_clip=0.5,
    )
    assert res.rounds
    for r in res.rounds:
        assert r.aggregated
        assert r.dp is not None
        assert r.dp["epsilon"] == 1.0
        assert r.dp["delta"] == 1e-5
        assert r.dp["clip_norm"] == 0.5
        # sigma is the analytic Gaussian mechanism value, not an invented number.
        assert r.dp["sigma"] == gaussian_sigma(0.5, 1.0, 1e-5)
    # When DP is applied, the note says so (and stays honest about per-round).
    assert any("Differential privacy IS applied" in n for n in res.notes)


def test_threshold_below_min_does_not_aggregate():
    res = run_rounds(
        _episodes(6), _episodes(2), horizon=2, rounds=3, orgs=2, local_epochs=1,
        min_participants=5,  # only 2 orgs participate → below threshold
    )
    assert res.rounds
    for r in res.rounds:
        assert r.threshold == 5
        assert r.aggregated is False
        assert r.dp is None
        assert len(r.participants) == 2  # they still trained & committed a hash
    # Not aggregating means the global model never changes across rounds.
    assert len({r.global_hash for r in res.rounds}) == 1


def test_dp_noise_is_reproducible_for_a_seed():
    kw = dict(horizon=2, rounds=2, orgs=2, local_epochs=1,
              dp_epsilon=1.0, dp_delta=1e-5, dp_clip=0.5, dp_seed=42)
    a = run_rounds(_episodes(6), _episodes(2), **kw)
    b = run_rounds(_episodes(6), _episodes(2), **kw)
    assert [r.global_hash for r in a.rounds] == [r.global_hash for r in b.rounds]
