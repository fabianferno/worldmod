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

## What works, and what is honestly not there yet

**Working, verified on a device.** Capture on Android Chrome with a live hand
skeleton. Sealed manifests, verified server-side from the uploaded bytes.
Server-side scoring across every frame, with near-duplicate detection.
Marketplace with bounties, acceptance reasons and licensed download. Four
contracts with 45 tests, including relayed submission so a contributor never
needs gas. A world model and federated rounds over the real episodes.

**Measured and not good enough yet.** The world model does not beat a
"predict no change" baseline (0.85 against 0.67), and federated rounds do not
improve across rounds. Both are the same cause — six episodes — and shrinking
the model does not rescue it. The scaling curve falls steeply enough that it
should cross the baseline somewhere near 8–12 episodes, but that is an
extrapolation and it is labelled as one.

**On-chain.** All six contracts of §11 are live on Ethereum Sepolia (see
[`contracts/deployments.json`](contracts/deployments.json)) against Circle's
real testnet USDC, and the app calls them: an episode's manifest hash and its
validation are committed as the contributor's own signature, with a relayer
paying the gas, so the wearer never needs a funded account.

**Not moving yet.** USDC. The relayer holds none, so no bounty is escrowed
on-chain and payment is still the local ledger's.

**Not built.** The subgraph. Utility scoring needs two contributors and every
episode so far came from one device.

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
