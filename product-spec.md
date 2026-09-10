# World Mod

### A permissionless network for physical-world data — starting with a phone strapped to your head

**Hackathon:** ETHOnline 2026 (Sept 4–16, async)
**Category:** DePIN × RWA × AI × Federated Learning
**Status:** MVP specification
**Name:** World Mod *(domain and trademark availability unverified)*

---

## 0. How to read this document

This spec separates three things that are easy to blur together and fatal to blur together in front of technical judges:

| Marker | Meaning |
|---|---|
| **[MVP]** | Being built during ETHOnline. Must work in the demo. |
| **[PROTOCOL]** | Schema and contract surface supports it. Not populated by the phone client. |
| **[ROADMAP]** | Post-hackathon. Named, not claimed. |

Anything not marked is context or motivation.

---

## 1. Positioning

**One line:**

> Anyone with a phone and a $10 head strap becomes a data source for robot learning. Open the web app, do a task, get paid. The protocol underneath is asset-agnostic — a factory sensor network registers the same way a phone does.

**The comparison that makes it legible:**

> Ego4D, but permissionless and paid.

Egocentric human video is the closest thing robotics has to internet-scale pretraining data. Ego4D, EgoExo4D, and Project Aria exist because head-mounted human video teaches machines how humans manipulate the physical world. Those datasets were collected through expensive, centralized, academically-funded programs with recruited participants and bespoke hardware.

World Mod is the economic layer for the same data format, with no recruiter, no hardware program, and no gatekeeper. The data primitive is already validated by the research community. What's missing is a way for the person who generated it to own and sell it.

**What we are not:** a generic data marketplace, a storage network, or a token launch.

---

## 2. Problem

**2.1 — Physical AI has a data problem.** LLMs trained on text scraped from the internet. Robots can't. They need to learn how objects move, how humans manipulate them, how forces interact, which actions succeed, and how environments change. That data does not exist on the internet at scale.

**2.2 — The data that does exist is fragmented and unpriced.** Individuals, factories, warehouses, labs, farms, and fleets all generate it. There is no shared infrastructure that turns a contribution into a standardized, verifiable, licensable asset.

**2.3 — Contributors capture none of the value.** Economic value accrues to whoever aggregates and trains, not to whoever generated the physical observation.

**2.4 — Collection is the actual bottleneck.** Not storage, not compute. The scarce resource is *someone doing a physical thing while a sensor is pointed at it.* Any network that solves this must make contribution nearly frictionless. That constraint is what drives the phone-first design below.

---

## 3. The wedge: phone + head strap + PWA **[MVP]**

Contributor flow, target time-to-first-earning under 90 seconds:

```
Scan QR → open PWA → connect wallet → grant camera + motion
   → pick a bounty task → record 15s episode → upload → scored → paid
```

No app store. No SDK. No hardware. No install.

### 3.1 What the phone can actually capture

This table is deliberate. Overclaiming here is the fastest way to lose a technical judge.

| Modality | Status | Notes |
|---|---|---|
| RGB video | **[MVP]** | `getUserMedia` + `MediaRecorder`. Safari and Chrome differ on container/codec — client negotiates and records the actual mime type into the manifest. |
| IMU (accel + gyro) | **[MVP]** | `DeviceMotionEvent`. iOS needs `requestPermission()` from a user gesture, HTTPS only. **~60Hz ceiling.** Real VIO datasets run 200–1000Hz. We record the observed rate; we do not claim more. |
| Audio | **[MVP]** | Same `getUserMedia` stream. |
| Coarse GPS | **[MVP]** | `Geolocation`, low precision by default, opt-in. |
| Device orientation | **[MVP]** | `DeviceOrientationEvent`, fused estimate from the OS. |
| Depth | **[PROTOCOL]** | **Not accessible from a browser.** iPhone LiDAR and TrueDepth are not exposed to web. Schema supports it; phone client never emits it. |
| 6DoF pose | **[PROTOCOL]** | Android Chrome WebXR can surface ARCore pose; iOS Safari has no WebXR AR. Treated as an optional enrichment where available, never assumed. |
| Hand tracking | **[ROADMAP]** | Requires MediaPipe/WASM on-device. Battery and thermal cost. Post-hackathon. |
| Force / pressure / telemetry | **[PROTOCOL]** | For industrial and robot assets. |

### 3.2 Known limitations, stated up front

- **Sync is best-effort.** Video frames and `devicemotion` events come from different clocks with no hardware timestamps. We record client monotonic timestamps on both streams and declare sync quality as tens of milliseconds, not microseconds. Fine for action-level learning; insufficient for tight visual-inertial odometry.
- **Thermals.** Continuous video capture on a head-mounted phone throttles. Mitigated structurally: episodes are short by design (10–30s), which is also what makes them useful training units.
- **Screen lock.** Handled via Wake Lock API for the MVP; a native client removes the constraint entirely.

These are documented rather than hidden. The protocol is designed so a better client (native app, dedicated device, robot) plugs into the same registry and produces strictly better data under the same schema.

---

## 4. Core concepts

### 4.1 Entities

**Individuals** — people contributing physical-world observations. Phones, wearables, cameras, vehicles, personal robots.

**Organizations** — companies, labs, universities, factories, fleets. Contribute infrastructure, or contribute *model updates without releasing data* (see §9).

Both register with the same contract. Both hold the same asset primitive. The difference is scale and data policy, not protocol treatment.

### 4.2 Assets

An asset is a registered source of physical-world observation, with a declared capability set.

```
Individual                    Organization
 ├── Phone (RGB, IMU, GPS)     ├── Factory (telemetry, cameras)
 ├── Action camera             ├── Robot fleet (trajectories, depth)
 ├── Smart glasses             ├── Vehicle fleet
 └── Robot                     └── Sensor network
```

Assets are registered on-chain with metadata and a capability manifest. Raw sensor data never goes on-chain.

The capability manifest is what makes "phone first, protocol general" real rather than rhetorical: a bounty specifies required modalities, and the registry can tell which assets are eligible. A phone qualifies for RGB+IMU bounties. A robot fleet qualifies for depth+trajectory bounties. Same contract, same query.

---

## 5. Physical Episodes

The fundamental primitive. A synchronized window of physical activity.

> A person picks up a cup, carries it across a room, and places it on a table.

**Episode manifest [MVP]:**

```json
{
  "episode_id": "ep_0f3a...",
  "schema_version": "0.1.0",
  "asset_id": "asset_9281",
  "entity_id": "0xA1b2...",
  "bounty_id": "bounty_004",
  "task": "cup_pick_and_place",
  "duration_s": 17.2,
  "recorded_at": 1757030400,
  "client": { "type": "pwa", "version": "0.3.1", "ua_class": "ios_safari" },
  "streams": {
    "rgb":  { "codec": "video/mp4;codecs=avc1", "fps_nominal": 30, "cid": "bafy...", "sha256": "0x..." },
    "imu":  { "rate_hz_observed": 58.7, "samples": 1010, "cid": "bafy...", "sha256": "0x..." },
    "audio":{ "codec": "audio/mp4", "cid": "bafy...", "sha256": "0x..." }
  },
  "sync": { "method": "client_monotonic", "est_skew_ms": 35 },
  "outcome": "success",
  "self_report": { "task_completed": true, "notes": "" },
  "validation": {
    "plausibility_score": 0.87,
    "checks": { "flow_gyro_corr": 0.91, "completeness": 1.0, "duration_ok": true },
    "validator": "0xV4l1...",
    "trust_level": "heuristic"
  },
  "manifest_hash": "0x..."
}
```

**Only `manifest_hash`, `episode_id`, `asset_id`, and the validation result go on-chain.** Everything else lives with the manifest in off-chain storage, addressed by CID.

`trust_level` is a first-class field, not a footnote. See §6.

---

## 6. Provenance and the trust boundary

This section exists because it is the question a good judge will ask, and the honest answer is more persuasive than a fake one.

### 6.1 What we can prove

- **Integrity after submission.** The manifest hash is on-chain. Any later mutation is detectable.
- **Attribution.** A specific wallet submitted a specific manifest at a specific block time.
- **Lineage.** Episode → dataset → training run → model, as a queryable graph.

### 6.2 What we cannot prove — from a browser

**A PWA cannot attest that data came from a real camera at a real time.** There is no App Attest, no Play Integrity, no secure enclave path exposed to web. Someone can point their phone at a monitor playing someone else's footage, or synthesize an IMU trace.

Hashing an upload proves integrity *after* submission. It proves nothing about physical origin. Any project that claims otherwise is wrong.

### 6.3 What we build instead: a plausibility score **[MVP]**

The validator computes a **plausibility score**, not a proof. The single most valuable check, and the one we ship:

**Cross-modal consistency — optical flow vs. gyroscope.**

Head motion produces correlated signals in two independent streams. Compute dense optical flow between sampled frame pairs, derive an implied camera rotation, and correlate it against the integrated gyro trace over the same window.

- Genuine head-mounted capture → high correlation.
- Screen replay, uploaded stock footage, or synthetic IMU → correlation collapses.

Supporting checks: modality completeness, duration bounds, frame-rate sanity, near-duplicate detection against prior submissions from the same entity (perceptual hashing).

This is cheap to implement, visually demonstrable in the demo (show the two traces overlaid — real vs. spoofed), and it is a real answer to "how do you know this is real?"

### 6.4 Trust levels **[PROTOCOL]**

Every episode carries a declared trust level. This is how the protocol stays honest while hardware improves:

| Level | Source | Guarantee |
|---|---|---|
| `self_reported` | Any upload | None beyond attribution |
| `heuristic` **[MVP]** | PWA + validator checks | Statistical plausibility |
| `attested` **[ROADMAP]** | Native client + App Attest / Play Integrity | Device-signed capture |
| `hardware` **[ROADMAP]** | Dedicated sensor with secure element | Cryptographic capture provenance |

Buyers filter by trust level and price accordingly. The MVP produces `heuristic` data and says so on every card in the UI.

**[ROADMAP]** Running the validator inside a TEE would let buyers verify that the scoring code is the code that ran, without trusting the operator.

---

## 7. Data marketplace and bounties

Listing static datasets is the wrong primitive for a network with no data yet. **Bounties are demand-first**: a buyer describes what they need, contributors go generate it.

**Bounty [MVP]:**

```json
{
  "bounty_id": "bounty_004",
  "title": "Cup pick-and-place, indoor",
  "task_spec": "Pick up a cup from a surface, move it, place it down. Head-mounted view.",
  "required_modalities": ["rgb", "imu"],
  "min_episodes": 100,
  "duration_range_s": [8, 30],
  "min_plausibility": 0.75,
  "min_trust_level": "heuristic",
  "budget_usdc": 100,
  "per_episode_usdc": 0.60,
  "utility_pool_usdc": 40,
  "license": "commercial_ai_training",
  "deadline": 1757894400
}
```

Note the budget split: a **flat per-episode rate** plus a **utility pool** distributed by measured model contribution (§8.3). This is the mechanism that moves the network off paying-per-gigabyte.

Buyers escrow USDC at creation. Contracts release on validation and on utility settlement.

**[PROTOCOL]** Licensing models: one-time purchase, time-limited, research-only, commercial training, inference royalty, revenue share. **[MVP]** ships one: commercial training license, one-time.

---

## 8. World model **[MVP]**

The demo needs to prove that contributed data does something. A manipulation policy cannot be trained on 100 phone episodes, and claiming otherwise gets caught. So we train the thing that *is* tractable and *is* the right conceptual primitive.

### 8.1 What we build: a latent forward-dynamics model

A world model predicts what happens next. We train the smallest honest version:

```
frame_t ──[frozen encoder]──> z_t ─┐
                                   ├──> [small GRU] ──> ẑ_{t+k}
motion_t (from IMU) ───────────────┘

Loss: || ẑ_{t+k} − z_{t+k} ||²  on held-out episodes
```

- **Encoder:** frozen pretrained vision backbone (DINOv2 or CLIP ViT-B). Not trained — we do not have the data for that and we do not pretend to.
- **Dynamics head:** small GRU or MLP, a few hundred thousand parameters. Trainable on a laptop in minutes.
- **Conditioning:** IMU-derived motion tokens — the contributor's own head movement is the action signal. This is why egocentric capture is the right format: the camera is attached to the actor, so ego-motion is a free action label.
- **Eval:** latent prediction error at horizon k on a fixed held-out set of episodes, never used in training.

### 8.2 What the demo shows: a data-scaling curve

Not a single fabricated before/after number. A curve:

```
Held-out latent prediction error (lower = better)

  0.42 │ ●
       │    ●
  0.36 │        ●
       │             ●
  0.30 │                  ●
       └──────────────────────────
        10   25   50   75   100
              episodes contributed
```

Real numbers from a real run, with the noise visible. If the curve is flat between two points, we show it flat. A judge who has trained models will trust a noisy honest curve and distrust a clean fake one.

**Secondary demo, if time allows:** rollout visualization — feed the model a frame and a motion sequence, decode nearest-neighbour frames from the latent predictions, show the model's guess at what the wearer will see next. This is the moment the "world model" claim becomes visceral rather than abstract.

### 8.3 Utility scoring → payment

This closes the loop the original spec only asserted.

1. Train baseline on dataset D.
2. For each contributor c, compute a **leave-one-contributor-out** delta: retrain without c's episodes, measure held-out error change.
3. Normalize deltas into utility shares.
4. `UtilityOracle` posts the scores on-chain; `RewardDistributor` splits the bounty's utility pool proportionally.

**Honest caveats, stated in the doc and the demo:**
- Leave-one-out is a crude Shapley approximation. Exact Shapley is combinatorially infeasible and we are not pretending to compute it.
- With small N, deltas are noisy. We report variance across seeds.
- The oracle is centralized in the MVP. Decentralizing utility measurement — multiple independent trainers reaching consensus on a score — is genuinely hard and is roadmap, not claim.

---

## 9. Federated learning **[MVP — narrow slice]**

The value proposition for organizations: *contribute to a model without releasing data.* A factory will never upload production footage. It might run training locally.

### 9.1 What we build

Two simulated organizations, each holding a private episode partition that never leaves their node.

```
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
               global model
                     ↓
        eval on shared held-out set
                     ↓
        FederatedRound contract pays per round
```

**On-chain per round:** round ID, participant list, each participant's update hash, resulting global model hash, eval metric, payment release.

**Off-chain:** the data, the local training, the weight deltas.

Because the dynamics head from §8 is small, FedAvg over it is genuinely fast — this is why the world model and the federated slice are the *same* model. One artifact, two demos.

### 9.2 What this does and does not demonstrate

**Does:** the coordination pattern. Raw data never moves. Contribution is on-chain-verifiable. Payment is tied to participation in a round with a measurable outcome.

**Does not:** provide privacy guarantees. FedAvg alone is not private — gradient inversion attacks against shared updates are a real and published problem, especially with few clients. Differential privacy noise, secure aggregation, and client-count thresholds are **[ROADMAP]**, and the demo will say so on screen.

Claiming "private federated learning" from a two-client FedAvg would be the single most checkable false claim in this project. We claim "federated coordination," which is what we built.

---

## 10. Architecture

### 10.1 System

```
        ┌──────────────────────────────────────┐
        │  Contributor PWA  (phone + strap)    │
        │  capture → manifest → hash → upload  │
        └───────────────┬──────────────────────┘
                        │
        ┌───────────────▼──────────────────────┐
        │  Validator service                   │
        │  flow↔gyro • completeness • dedupe   │
        │  → plausibility score                │
        └───────────────┬──────────────────────┘
                        │
   ┌────────────────────▼────────────────────┐   ┌──────────────────┐
   │  Contracts                              │◄──┤  Trainer /       │
   │  Entity • Asset • Episode • Dataset      │   │  UtilityOracle   │
   │  Bounty(escrow) • Rewards • FedRound     │   │  world model     │
   └────────────────────┬────────────────────┘   └──────────────────┘
                        │
        ┌───────────────▼──────────────────────┐
        │  Buyer / Org dashboard               │
        │  create bounty • browse • license    │
        │  • scaling curve • fed rounds        │
        └──────────────────────────────────────┘
```

### 10.2 On-chain vs off-chain

**On-chain:** entity identity, asset registration + capability manifest, episode hashes, validation results, dataset IDs and hashes, bounties and escrow, licenses, payments, contribution scores, model registry, federated round records.

**Off-chain:** video, audio, IMU streams, manifests, embeddings, model weights, training artifacts.

The chain provides coordination and verification. Not bulk storage. A 20-second episode is tens of megabytes; the network's job is to make that blob *accountable*, not to hold it.

### 10.3 Stack **[MVP]**

| Layer | Choice | Note |
|---|---|---|
| Client | React PWA, Wake Lock, `getUserMedia`, `DeviceMotionEvent` | No install |
| Wallet | Embedded wallet w/ social login, sponsored gas | Onboarding friction is the whole game |
| Chain | L2 testnet with USDC support | Choose to match a live ETHOnline prize track |
| Storage | Content-addressed decentralized storage | Candidate: 0G, IPFS/Filecoin — pick by sponsor track |
| Indexing | Subgraph over the provenance graph | The Graph |
| Validator | Python: OpenCV optical flow + numpy | Runs as a service |
| Trainer | PyTorch, frozen DINOv2/CLIP + small GRU | Laptop-trainable |

**Sponsor note (superseded):** this project explored Hedera (asset tokenization), Chainlink (confidential validation), and World Network (proof-of-personhood) as candidate sponsor tracks; all three were tried and then removed from the repo. The stack now follows `attestcoin.md` exclusively — DePIN settlement on Ethereum Sepolia, verified cross-chain via the Attestcoin Protocol onto Creditcoin testnet.

---

## 11. Contracts

Six contracts. Deliberately small.

**`EntityRegistry`** — `registerEntity(type, metadataURI)`, `getEntity(id)`. Individuals may stay pseudonymous. Organizations may attach optional verifiable credentials. **No PII on-chain, ever.**

**`AssetRegistry`** — `registerAsset(entityId, assetType, capabilityManifest)`, `getEligibleAssets(requiredModalities)`. The capability manifest is what makes the protocol asset-agnostic in practice.

**`EpisodeRegistry`** — `submitEpisode(assetId, bountyId, manifestHash, storageCID)`, `recordValidation(episodeId, score, trustLevel, validator)`.

**`BountyEscrow`** — `createBounty(spec, budget)` (pulls USDC), `acceptEpisode(episodeId)` (releases per-episode rate), `settleUtility(scores[])` (releases utility pool), `refundExpired()`.

**`DatasetRegistry`** — `mintDataset(episodeIds[], license, revenueRules)`, `purchaseLicense(datasetId)`. A dataset is a bundle of episode hashes plus licensing terms — the RWA object.

**`FederatedRound`** — `openRound(modelId, participants[])`, `submitUpdate(roundId, updateHash)`, `finalizeRound(roundId, globalHash, metric)`, releases per-round payment.

**[ROADMAP] `ModelRegistry`** — model versions, training runs, dataset lineage, contributor lists. Stubbed in the MVP as a single event emitted at training time so the provenance graph is queryable end to end.

---

## 12. Reputation **[PROTOCOL / partial MVP]**

Reputation is a derived score, not a contract in the MVP. Computed from: mean plausibility score, acceptance rate, duplicate rate, and utility contribution history.

Affects: bounty eligibility, reward multipliers, dataset ranking, and stake requirements.

**MVP scope:** compute and display it. Do not gate on it — with a demo-sized network there is nothing to gate.

---

## 13. Economics

USDC from day one. **No token.** A speculative token in a hackathon demo distracts from the mechanism and invites the wrong questions.

Example flow on a $100 bounty:

```
Buyer escrows                     100.00 USDC
  → per-episode payments (100 × $0.60)   60.00
  → utility pool (model contribution)    30.00
  → validators                            5.00
  → protocol treasury                     5.00
```

**[ROADMAP]** A native token has plausible functions — staking against data quality, validator bonding, governance, machine-to-machine settlement — but every one of them requires a network that exists first.

---

## 14. Demo script

Six scenes, ~4 minutes. Everything below is buildable in the scope of §16.

**1 — Capture.** Phone in a head strap. Presenter picks up a cup, moves it, sets it down. 15 seconds. Live.

**2 — Verification.** Upload lands. Validator overlays the gyro trace against optical-flow-derived rotation — they track. Score 0.89, trust level `heuristic`. Manifest hash lands on-chain.

**3 — The spoof.** Upload a screen recording of the same task. Traces diverge visibly. Score 0.11. Rejected. *This is the scene that earns credibility.*

**4 — The market.** Buyer wallet posts a bounty for 100 cup-manipulation episodes, escrows 100 USDC. Contributor's episode is accepted; USDC lands in their wallet on screen.

**5 — The model.** Dataset of 100 episodes trains the latent dynamics head. Data-scaling curve renders with real, noisy numbers. Rollout visualization: the model's prediction of what the wearer sees next.

**6 — The organization.** Two org nodes hold private partitions. Neither uploads data. Both submit weight update hashes. FedAvg produces a global model; eval improves; `FederatedRound` pays both. Closing frame: the provenance graph, physical act → episode → dataset → model → payment, queried live from the subgraph.

---

## 15. Differentiation

Not "a data marketplace." The specific combination:

- **Zero-friction supply.** No app, no hardware, no recruiter. A QR code and a head strap. Every competing physical-data play requires you to buy or install something.
- **A validation story that survives scrutiny.** Cross-modal consistency plus an explicit trust-level ladder, instead of hand-waving about hashes.
- **Payment tied to measured model utility**, not gigabytes.
- **Federated participation** so organizations that will never upload data can still join.
- **World models as the destination**, not generic dataset brokerage.

---

## 16. Build plan — 10 days

Assumes a submission deadline around Sept 13 (**verify on the official event page**).

| Days | Deliverable |
|---|---|
| 1–2 | Contracts: Entity, Asset, Episode, BountyEscrow. Deployed to testnet, tested. |
| 2–4 | PWA capture: camera + IMU + manifest + hash + upload. **Test on a real head strap, on both iOS and Android, early.** |
| 4–5 | Validator: flow↔gyro correlation, completeness, dedupe. Tuned against a deliberately spoofed sample. |
| 5–6 | Collect real data. Target 100+ episodes. Recruit friends — this is a real time cost, budget it. |
| 6–7 | World model: encoder, dynamics head, held-out eval, scaling curve, leave-one-out utility. |
| 7–8 | Federated slice: two nodes, FedAvg, `FederatedRound` contract, on-chain round record. |
| 8–9 | Buyer dashboard, subgraph, provenance graph view. |
| 9–10 | Demo video, README, submission. |

**Ship-order rule:** the loop must work end-to-end thin before anything gets deep. If day 7 arrives and the loop is broken, the federated slice is the first cut, then the rollout visualization, then the subgraph.

**The one thing that must be polished:** the contributor PWA. It is the part that makes the thesis feel inevitable — a stranger scans a QR code, straps on a phone, and is paid in ninety seconds.

---

## 17. Explicitly out of scope

Named so nobody asks why they're missing: native mobile clients, hardware attestation, TEE validators, differential privacy, secure aggregation, decentralized utility consensus, multi-tier licensing, inference royalties, robot fleet integration, token, governance, staking, slashing, cross-chain settlement.

All are real roadmap. None are hackathon.

---

## 18. Roadmap

**Phase 1 — Data protocol.** Registries, episodes, provenance, bounties, marketplace. *(ETHOnline MVP)*

**Phase 2 — Trust.** Native clients with device attestation, TEE validators, decentralized validation, reputation with real stakes.

**Phase 3 — AI network.** Federated learning with real privacy guarantees, model registry, decentralized utility measurement, VLA training.

**Phase 4 — Physical intelligence economy.** Robot fleets as contributors, model royalties, autonomous collection, machine-to-machine settlement.

---

## 19. North star

```
    PHYSICAL WORLD
          ↓
       Sensors
          ↓
    Data network
          ↓
     Marketplace
          ↓
   AI / world model
          ↓
   Physical action
          ↓
      Outcome
          └──→ new physical data ──┐
                                   └──→ (repeat)
```

> The next generation of AI will not only consume internet data. It will learn from the physical world.

World Mod is the layer that lets the people generating that world own what it teaches.
