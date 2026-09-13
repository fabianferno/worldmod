# World Mod

A permissionless network for physical-world data — starting with a phone strapped
to your head.

Anyone with a phone opens a web page, performs a short physical task, and their
recording is scored on their own device before it is uploaded. A buyer posts a
bounty describing what they need and escrows what it pays. The protocol
underneath is asset-agnostic: a factory sensor network registers the same way a
phone does.

Full specification: [`product-spec.md`](product-spec.md).

---

## What is here

| Path | What it is |
|---|---|
| [`web/`](web) | The PWA — contributor capture, buyer dashboard, validator, marketplace API |
| [`contracts/`](contracts) | Solidity registries and escrow (Foundry) |
| [`trainer/`](trainer) | World model, scaling curve, federated rounds (PyTorch) |
| [`subgraph/`](subgraph) | The provenance graph, indexed from the six contracts |
| [`docs/superpowers/specs/`](docs/superpowers/specs) | Design document for the PWA |
| [attestcoin](https://github.com/Ashar20/attestcoin) (separate repo) | The Attestcoin ASC on Creditcoin testnet that proves a Sepolia settlement — see below |

## Running it

```sh
# The app
cd web && npm install && npm run dev

# On a phone, over USB — localhost is a secure context, so no certificate warning
adb reverse tcp:3000 tcp:3000
```

Open `/c` to contribute, `/b/bounties` to post and inspect.

```sh
# Contracts
cd contracts && forge install foundry-rs/forge-std && forge test

# Trainer, once episodes exist
cd trainer && python3 -m venv --system-site-packages .venv
.venv/bin/pip install torchvision
.venv/bin/python run.py --data ../web/.data

# Export the live-capture model — /c has no world-model overlay without this
.venv/bin/pip install onnx onnxruntime
.venv/bin/python export_live.py --data ../web/.data --out ../web/public/models/world
```

## How an episode moves through the system

```
 phone                              server                        buyer
 ─────                              ──────                        ─────
 record 15s
   └─ hand landmarks → skeleton overlay only
        │
   seal manifest (JCS + SHA-256)
        │
   IndexedDB ─── retryable upload ──→ verify every hash from the
                                      bytes received, or refuse
                                            │
                                      decode every frame
                                      hands → framing
                                      optical flow + gyro → motion
                                      perceptual hash → duplicates
                                            │
                                      accept / reject ──→ $0.60
                                            │
                                      licensed download ──────────→ video
```

**The phone draws a skeleton and nothing else.** It used to score too, and the
recordings showed the cost: 26.9fps against a nominal 30, and gaps up to 818ms
landing during movement — the device was damaging the footage in order to grade
it. A client-computed score was never authoritative anyway, since the
contributor owns the phone.

The commitment is still computed on the device before any byte leaves it, so
§6.1's integrity claim holds. Everything that decides acceptance or payment is
measured on the server from the bytes that arrived. Scoring takes about a
minute, so an upload does not wait on it: episodes arrive `scoring` and the
client polls.

## Attestcoin: proving a settlement cross-chain, without a centralized oracle

`BountyEscrow.acceptEpisode` (above) emits a dedicated
`EpisodeAcceptedForAttestation(episodeId, contributor, score, bountyId)` event.
A separate ASC (Attestcoin Smart Contract) on **Creditcoin CC3 testnet** —
[`AttestcoinSettlement`](https://github.com/Ashar20/attestcoin) — verifies that
this exact Sepolia transaction happened via the Attestcoin Protocol's native
block-prover precompile (Merkle + continuity proofs, real receipt-status
check), then credits the contributor on Creditcoin. No relayer, no trusted
bridge operator: the ASC's own on-chain verification is what makes it true.

```
Sepolia BountyEscrow.acceptEpisode → EpisodeAcceptedForAttestation
              ↓
     Attestcoin attestors + hosted Proof Builder
              ↓
     AttestcoinSettlement.execute() on Creditcoin (block-prover precompile @ 0xFD2)
              ↓
     SettlementRecorded — contributorPoints / settlementCount, POSTed back to
     this app's /api/chain/attestation, shown as "verified on Creditcoin" next
     to the episode on both the buyer and contributor pages
```

Proven live, not simulated: a real `acceptEpisode` tx
([`0x30bb6678...`](https://sepolia.etherscan.io/tx/0x30bb667870eb96941b0822e0c6e80d068e9e5c08f970b2ff60aefe339c161ce0))
produced a real proof from the hosted Proof Builder, which a real
`execute()` call ([`0x5361a404...`](https://creditcoin-testnet.blockscout.com/tx/0x5361a4047173abb976e1233d7849609fc47e6adbcea216a36952322076b9b11c))
verified on Creditcoin testnet — full writeup, contract, and tests in the
[attestcoin](https://github.com/Ashar20/attestcoin) repo.

## What works, and what is honestly not there yet

**Working, verified on a device.** Capture on Android Chrome with a live hand
skeleton and a live world-model overlay (below). Sealed manifests, verified
server-side from the uploaded bytes. Server-side scoring across every frame,
with near-duplicate detection. Marketplace with bounties, acceptance reasons
and licensed download. Real USDC moving on Ethereum Sepolia: a bounty escrows
its budget before it is listed, acceptance releases the per-episode rate, and
a contributor withdraws with their own signature. All six §11 contracts are
live (see [`contracts/deployments.json`](contracts/deployments.json)),
including relayed submission so a contributor never needs gas of their own.
Every episode gets a real IPFS content address, pinned to a local node. A
subgraph indexes all six contracts, built and ready to deploy. A world model
and federated rounds over the real episodes, with a working account page for
a contributor to see their own history and collect their own balance.

**Measured and not good enough yet.** The world model does not beat a
"predict no change" baseline. Five episodes across three contributors now,
which is enough for the scaling curve to show a real trend and for utility
scoring to compute something for the first time — but still far short of
being enough data for the model to actually work. The curve falls steeply
enough that it should cross the baseline somewhere near 8–12 episodes, and
that is an extrapolation labelled as one, not a promise.

**Not deployed.** The subgraph — built, compiles, needs a Graph Studio key.

**Not durable.** IPFS pinning runs on one local node. The content addresses
are real and independently verified against kubo's own output; nothing
guarantees they resolve once that node stops.

**Not provable, by construction.** Nothing here attests that pixels came from a
real camera at a real time. A browser has no App Attest, no Play Integrity, no
secure enclave. Every episode carries `heuristic` as its trust level and the UI
says so on every card. The checks measure whether a capture is *plausible*.

## The anti-spoof check, measured

The flow-vs-gyro check is the one claim worth testing rather than asserting, so
it is tested against real recordings by pairing one episode's frames with
another's motion — which is what a screen replay looks like to a validator.

| | Genuine | Mismatched |
|---|---|---|
| 24526d93 | **75.4%** | 23.4%, 8.7% |
| 57cbf6bd | **59.6%** | 24.7%, 25.6% |
| 149d2df5 | **42.7%** | 22.8%, 39.7% |

Mean genuine 59%, mean spoof 24%; at a 45% threshold every spoof is rejected and
one genuine take is a false negative. The margin in the third row is three
points, so this is evidence the check works, not proof it is hard to beat.

Finding it required fixing a real bug: the frame and IMU clocks are offset, and
correlating them at zero lag scored a genuine capture *below* a spoof. The
validator now estimates the lag, which took that episode from 5.2% to 59.6%.

## The world model, live during capture

§8.2's secondary demo item — feed the model a frame and a motion sequence,
decode the nearest-neighbour frame from its prediction, show the wearer's own
device what it thinks happens next — runs live now, during the take, instead
of once over a finished episode.

The phone streams a centre-cropped frame and the current motion sample to the
server roughly twice a second; the server runs the trained encoder and
dynamics head one step at a time, keeping the GRU's hidden state in memory
between requests, and returns the frame — from earlier in *this same take* —
closest to where the model expects the wearer is heading. That "closest to"
is the honest claim: a live prediction can only point at a frame that has
already been captured, never a genuinely future one, so the panel says
"model's guess," not "next frame."

Nothing was ported approximately. The exported ONNX graph is checked against
the PyTorch model it came from over an eight-step recurrent sequence with the
hidden state carried forward — worst-case difference `2.5e-5`, floating-point
noise, not drift — and the server's own crop-and-normalise pipeline is checked
against the trainer's on a real captured frame, matching to `4.4e-6`. Both are
scripts in `trainer/`, not assertions in a comment.

What it will not do is look impressive. With five episodes the model does not
beat its own baseline (above), and a live guess drawn from an undertrained
head mostly returns whichever frame was least different, which most of the
time is just the most recent one. Building it before there is enough data to
make it good was deliberate: getting the plumbing — the export, the
per-session recurrent state, the nearest-neighbour bank, the honest framing of
what a live guess is — right now means every additional recorded episode
improves what is already live, rather than what a plausible mock would have
been asserting.

## Departures from the specification

Each is deliberate, and the reasoning lives next to the code.

- **Manifest canonicalisation.** §5 defines no rule, so integrity is
  unenforceable across implementations. RFC 8785 (JCS), one shared module.
- **CIDs left out of the signed commitment.** §5's schema is circular — a CID
  exists only after pinning, which happens after signing. Addressing is attached
  afterwards; the SHA-256 binds the bytes either way.
- **IMU as a hashed binary stream**, not JSON floats — float formatting across
  two runtimes is where byte-exactness dies.
- **`fps_observed` is nullable.** Safari cannot report it at signing time, and a
  placeholder zero inside a signed manifest is a number nobody measured.
- **Capability bitmask** instead of §11's `getEligibleAssets` loop, which is
  unbounded and eventually uncallable. Enumeration belongs in the subgraph.
- **Utility holds out contributors, not episodes.** §8.3's random split lets a
  contributor be paid for correlating with their own evaluation clips.
- **Bounties declare a motion policy.** Seated tasks barely rotate the head, so
  requiring the gyro check would reject every honest keyboard submission.

## Known gaps worth stating plainly

Bystander privacy is absent from the specification entirely and is only
partially addressed here — location is coarsened to a ~10km grid at capture and
is opt-in, but a head-mounted camera still records third parties who did not
consent. Face blurring is not implemented.

The guide region that framing is scored against was placed by hand before any
head-mounted capture existed. It fits desk tasks and is wrong for anything at
arm's length; recalibrating it needs more episodes, not more code.
