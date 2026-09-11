"""Federated coordination — product-spec §9.

    Org A (private data)          Org B (private data)
           │                              │
    local train dynamics head      local train dynamics head
           │                              │
     weight delta Δ_A                weight delta Δ_B
           │                              │
      hash(Δ_A) on-chain            hash(Δ_B) on-chain
           └──────────┬───────────────────┘
                      ↓
               FedAvg aggregator
                      ↓
                global model → eval on a shared held-out set

What this demonstrates, in the spec's own words (§9.2): the coordination
pattern. Raw data never moves, each contribution is hashable and therefore
verifiable, and payment can be tied to participating in a round with a
measurable outcome.

Privacy is a separate, load-bearing distinction. FedAvg *alone* is not private —
gradient inversion against shared updates is a real, published attack, most
effective with few clients, which is exactly this setup. Two of the three
roadmap mitigations are now implemented here and are opt-in (see privacy.py):
a **client-count threshold** (a round below N_min participants is recorded but
not aggregated) and **per-round differential privacy** (clip each client update
to L2 norm C, add Gaussian noise σ = C·√(2·ln(1.25/δ))/ε — the analytic Gaussian
mechanism, a genuine per-round (ε, δ) guarantee, NOT composed across rounds, and
central DP with a trusted aggregator). **Secure aggregation remains roadmap.**
With DP off this is plain FedAvg and claims only federated COORDINATION, never
privacy — the results file says which, per round, and never both.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

import numpy as np
import torch
import torch.nn.functional as F

from .encoder import pick_device
from .experiment import EncodedEpisode, _standardise
from .model import LatentDynamics, baseline_error
from .privacy import add_gaussian_noise, clip_update, gaussian_sigma

StateDict = dict[str, torch.Tensor]


@dataclass
class ParticipantUpdate:
    """One organisation's contribution to a round."""

    org_id: str
    episodes: int
    frames: int
    update_hash: str
    local_error: float


@dataclass
class Round:
    round_id: int
    participants: list[ParticipantUpdate] = field(default_factory=list)
    global_hash: str = ""
    global_error: float = float("nan")
    baseline_error: float = float("nan")
    # Minimum participants required to aggregate this round.
    threshold: int = 1
    # Per-round DP guarantee {epsilon, delta, sigma, clip_norm}, or None when
    # differential privacy was not applied to this round.
    dp: dict | None = None
    # False when the round was below `threshold` and therefore not aggregated.
    aggregated: bool = True


@dataclass
class FederatedResults:
    rounds: list[Round] = field(default_factory=list)
    orgs: list[str] = field(default_factory=list)
    parameters: int = 0
    horizon: int = 0
    heldout_episodes: int = 0
    notes: list[str] = field(default_factory=list)


def hash_state(state: StateDict) -> str:
    """A commitment to a set of weights.

    Keys are sorted and tensors serialised in a fixed dtype and byte order, so
    the same weights hash identically on any machine — the whole point of
    putting the hash on-chain is that two parties can agree on it.
    """
    digest = hashlib.sha256()
    for key in sorted(state):
        digest.update(key.encode("utf-8"))
        digest.update(state[key].detach().to("cpu", torch.float32).numpy().tobytes())
    return f"0x{digest.hexdigest()}"


def _clone(state: StateDict) -> StateDict:
    return {k: v.detach().clone() for k, v in state.items()}


def _delta(after: StateDict, before: StateDict) -> StateDict:
    return {k: after[k] - before[k] for k in after}


def train_locally(
    model: LatentDynamics,
    episodes: list[EncodedEpisode],
    horizon: int,
    epochs: int,
    device: torch.device,
) -> float:
    """Train in place on one organisation's own partition. Returns local error."""
    optimiser = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    batches = [
        (e.latents.unsqueeze(0).to(device), e.motion.unsqueeze(0).to(device)) for e in episodes
    ]

    model.train()
    last = float("nan")
    for _ in range(epochs):
        losses: list[float] = []
        for latents, motion in batches:
            if latents.shape[1] <= horizon:
                continue
            optimiser.zero_grad()
            predicted = model(latents[:, :-horizon], motion[:, :-horizon])
            loss = F.mse_loss(predicted, latents[:, horizon:])
            loss.backward()
            optimiser.step()
            losses.append(loss.item())
        if losses:
            last = float(np.mean(losses))

    return last


@torch.no_grad()
def evaluate(
    model: LatentDynamics, held: list[EncodedEpisode], horizon: int, device: torch.device
) -> tuple[float, float]:
    model.eval()
    errors: list[float] = []
    baselines: list[float] = []

    for episode in held:
        latents = episode.latents.unsqueeze(0).to(device)
        motion = episode.motion.unsqueeze(0).to(device)
        if latents.shape[1] <= horizon:
            continue
        predicted = model(latents[:, :-horizon], motion[:, :-horizon])
        errors.append(F.mse_loss(predicted, latents[:, horizon:]).item())
        baselines.append(baseline_error(latents, horizon).item())

    if not errors:
        return float("nan"), float("nan")
    return float(np.mean(errors)), float(np.mean(baselines))


def partition(episodes: list[EncodedEpisode], orgs: int) -> list[list[EncodedEpisode]]:
    """Split episodes between organisations, disjointly.

    Round-robin rather than contiguous: a contiguous split would hand one org
    every episode of one task, and the round would then measure task difficulty
    rather than whether federating helped.
    """
    parts: list[list[EncodedEpisode]] = [[] for _ in range(orgs)]
    for index, episode in enumerate(episodes):
        parts[index % orgs].append(episode)
    return [p for p in parts if p]


def run_rounds(
    train: list[EncodedEpisode],
    held: list[EncodedEpisode],
    horizon: int,
    rounds: int = 4,
    orgs: int = 2,
    # Client drift: the more each organisation trains before averaging, the
    # further its weights travel toward its own partition and the worse the
    # average gets. Measured here across 5/10/20/40 local epochs, round-1
    # error was 0.682/0.690/0.719/0.744 — monotone in the same direction the
    # FedAvg literature predicts, so the shortest local schedule is used.
    local_epochs: int = 5,
    seed: int = 0,
    # Client-count threshold: a round with fewer than this many participants is
    # recorded but NOT aggregated (roadmap item, now real).
    min_participants: int = 1,
    # Differential privacy (opt-in): supply BOTH dp_epsilon and dp_clip to apply
    # the per-round analytic Gaussian mechanism. Either left None → DP off.
    dp_epsilon: float | None = None,
    dp_delta: float = 1e-5,
    dp_clip: float | None = None,
    dp_seed: int = 0,
) -> FederatedResults:
    device = pick_device()
    torch.manual_seed(seed)

    dp_enabled = dp_epsilon is not None and dp_clip is not None
    sigma = gaussian_sigma(dp_clip, dp_epsilon, dp_delta) if dp_enabled else 0.0
    dp_config = (
        {"epsilon": dp_epsilon, "delta": dp_delta, "sigma": sigma, "clip_norm": dp_clip}
        if dp_enabled
        else None
    )
    # A dedicated CPU generator so the DP noise is reproducible from dp_seed,
    # independent of the RNG draws that training itself consumes.
    noise_gen = torch.Generator()
    noise_gen.manual_seed(dp_seed)

    # _standardise returns (train, held, mean, std); the federated loop doesn't
    # do live inference, so the normalisation stats are unused here.
    train, held, _mean, _std = _standardise(train, held)
    parts = partition(train, orgs)

    if len(parts) < 2:
        return FederatedResults(
            notes=["Need episodes for at least two organisations to federate."]
        )

    latent_dim = train[0].latents.shape[1]
    global_model = LatentDynamics(latent_dim).to(device)
    global_state = _clone(global_model.state_dict())

    if dp_enabled:
        privacy_note = (
            f"Differential privacy IS applied this run: each client update is "
            f"L2-clipped to C={dp_clip} and Gaussian noise (σ={sigma:.4g}) is "
            f"added to the summed update at aggregation — a per-round "
            f"(ε={dp_epsilon}, δ={dp_delta}) guarantee via the analytic Gaussian "
            f"mechanism. It is PER-ROUND, not composed across rounds; it is "
            f"central DP (a trusted aggregator adds the noise), not local DP or "
            f"secure aggregation; with few clients gradient-inversion is "
            f"mitigated but the small-client regime stays adversarially hard."
        )
    else:
        privacy_note = (
            "FedAvg alone provides no privacy guarantee. Gradient inversion "
            "against shared updates is a published attack and is most effective "
            "with few clients, as here. This shows federated coordination, not "
            "private federated learning — run with dp_epsilon and dp_clip set to "
            "apply a real per-round (ε, δ) guarantee."
        )

    results = FederatedResults(
        orgs=[f"org_{chr(97 + i)}" for i in range(len(parts))],
        parameters=global_model.parameter_count,
        horizon=horizon,
        heldout_episodes=len(held),
        notes=[
            privacy_note,
            "Both organisations are simulated on one machine over partitions of "
            "the same corpus. Nothing here proves data would stay put across a "
            "real trust boundary; it shows the protocol that would govern it.",
            "Held-out error does not improve across rounds at this corpus size — "
            "it rises. With two episodes per organisation the local models "
            "overfit their partitions faster than averaging can help, which "
            "matches the centralised result where the model also fails to beat "
            "the no-change baseline. The coordination is sound; the data is too "
            "little for federating to pay off yet.",
        ],
    )

    for round_id in range(1, rounds + 1):
        record = Round(
            round_id=round_id,
            threshold=min_participants,
            dp=dict(dp_config) if dp_config else None,
        )
        deltas: list[StateDict] = []
        weights: list[int] = []

        for org_id, part in zip(results.orgs, parts):
            # Every org starts the round from the same global weights.
            local = LatentDynamics(latent_dim).to(device)
            local.load_state_dict(global_state)

            local_error = train_locally(local, part, horizon, local_epochs, device)
            delta = _delta(local.state_dict(), global_state)

            # Under DP the client clips its own update to L2 norm C before
            # sharing, so the clipped update is what is committed on-chain and
            # what the aggregator sees.
            if dp_enabled:
                delta = clip_update(delta, dp_clip)

            frames = int(sum(len(e.latents) for e in part))
            deltas.append(delta)
            weights.append(frames)

            record.participants.append(
                ParticipantUpdate(
                    org_id=org_id,
                    episodes=len(part),
                    frames=frames,
                    # The commitment that goes on-chain. The weights themselves
                    # never leave the organisation, and neither does the data.
                    update_hash=hash_state(delta),
                    local_error=local_error,
                )
            )

        # Client-count threshold: below it, record the round but do NOT
        # aggregate — the global model is left unchanged this round.
        if len(record.participants) < min_participants:
            record.aggregated = False
            record.dp = None
            error, baseline = evaluate(global_model, held, horizon, device)
            record.global_hash = hash_state(global_state)
            record.global_error = error
            record.baseline_error = baseline
            results.rounds.append(record)
            continue

        if dp_enabled:
            # Central DP-FedAvg: sum the clipped updates (L2-sensitivity to any
            # one client = clip_norm), add Gaussian noise calibrated to (ε, δ),
            # then average by participant count. Dividing after noising is
            # post-processing and preserves the (ε, δ) guarantee.
            summed = {key: sum(d[key] for d in deltas) for key in global_state}
            noised = add_gaussian_noise(summed, sigma, noise_gen)
            for key in global_state:
                global_state[key] = global_state[key] + noised[key] / len(deltas)
        else:
            # FedAvg proper: average the updates weighted by how much data each
            # org actually trained on, not one-org-one-vote.
            total = float(sum(weights)) or 1.0
            for key in global_state:
                update = sum(d[key] * (w / total) for d, w in zip(deltas, weights))
                global_state[key] = global_state[key] + update

        global_model.load_state_dict(global_state)
        error, baseline = evaluate(global_model, held, horizon, device)

        record.global_hash = hash_state(global_state)
        record.global_error = error
        record.baseline_error = baseline
        results.rounds.append(record)

    return results
