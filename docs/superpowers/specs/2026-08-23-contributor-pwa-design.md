# World Mod PWA — Design

**Date:** 2026-08-23
**Scope:** Both web surfaces — contributor capture client and buyer dashboard
**Owner:** Solo (all six system components)
**Parent spec:** [`product-spec.md`](../../../product-spec.md)

---

## 1. Purpose and boundaries

This document designs the web application described in §3 and §14 of the product
spec: the contributor capture flow, and the buyer dashboard that consumes what it
produces. It does not design the validator, the contracts, the trainer, or the
federated slice — but it fixes the interfaces the PWA presents to each of them.

Success is the §3 loop working on a real phone in a real head strap: QR to first
earning in under 90 seconds, on both iOS Safari and Android Chrome, producing an
episode manifest that the validator can score and the contracts can attribute.

### Constraints that shape every decision below

- **Solo builder, ~12 days before the event opens.** Every choice is biased
  toward less code and fewer moving parts.
- **Both mobile platforms matter equally.** Neither is the designated demo
  device, so the client detects capability and records what it actually got.
- **Three downstream choices are unresolved** — chain, storage provider, and
  sponsor tracks. Nothing in the build may block on them.

---

## 2. Architecture: client-authoritative manifest, server-mediated settlement

Three arrangements were considered for where the episode manifest is assembled
and hashed.

**A — Thin client.** The phone uploads raw streams; the backend hashes, pins,
and submits. Least device code, but the manifest hash is computed by a server
that already holds the data, so the integrity guarantee in product-spec §6.1
begins at the server's submission rather than the contributor's.

**B — Fat client.** The phone hashes, signs, submits on-chain, and uploads
direct to storage. Strongest provenance, but it puts delegated storage
credentials and a paymaster call on a thermally-throttled mobile browser
immediately after recording — three failure modes on the least debuggable
device in the system.

**C — Client hashes and signs, server pins and relays. → CHOSEN.**
The phone computes stream hashes, assembles the canonical manifest, hashes it,
and signs it with the embedded wallet. It then hands the signed manifest and the
blobs to the backend, which pins to storage and relays the submission on-chain.

C is chosen because the commitment is made on the device before any byte leaves
it — which is exactly what product-spec §6.1 claims — while storage and gas
plumbing stay on a server with a real terminal attached. It also sharpens the
§14 scene-3 spoof demo: the signature binds a wallet to a specific byte
sequence, so honest and spoofed submissions are distinguishable in the ledger
and not only in the validator's output.

C's one real cost is that canonicalization must be byte-exact across the browser
and the server. §4 addresses this directly.

---

## 3. Stack and application skeleton

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js (App Router) | `app/api/*` hosts the pin-and-relay backend in the same repo and deploy; the canonicalization module is *imported* by both sides rather than reimplemented across a boundary. |
| PWA shell | Serwist | `next-pwa` is unmaintained. Installability and offline app shell only. |
| Wallet (contributor) | Privy embedded wallet | Signer only — see §6. Passkey/email login, strong mobile-PWA support. |
| Wallet (buyer) | Standard connect | Different persona, different needs. See §7. |
| Local persistence | IndexedDB (`idb`) | Episode blobs survive a failed upload. |
| Charts | Chosen when §7's views are built | Deferred deliberately — the `dataviz` skill is loaded before the scaling curve is written, and it drives the choice. |

Route groups: `app/(contributor)` and `app/(buyer)`, sharing a shell. All
capture components are `'use client'`.

**Offline capture queuing is explicitly out of scope.** The service worker
provides installability and the app shell. Queuing captures across sessions is a
real feature with real edge cases and there is no time for it.

### Development environment note

`getUserMedia` and `DeviceMotionEvent` require a secure context. `localhost`
qualifies; the laptop's LAN IP does not. Testing on a physical phone therefore
requires `next dev --experimental-https` or a tunnel. This blocks the very first
strap test, so it is set up on day one.

---

## 4. Manifest, canonicalization, and hashing

### 4.1 Canonicalization

RFC 8785 (JCS) over the manifest object, with the `manifest_hash` field itself
excluded from the hashed payload. SHA-256 over the resulting bytes.

This lives in `lib/manifest/` and is imported by both the capture client and the
API route, so exactly one implementation exists.

**It is tested first.** A frozen fixture manifest with an asserted hash, run in
both the browser and Node. Written before any capture UI. If those two
implementations ever disagree, nothing downstream reconciles — this is the
single highest-consequence bug in the PWA.

> **Product-spec gap:** §5 of the product spec defines no canonicalization rule.
> Without one, "integrity" is unenforceable across implementations. This must be
> added to the parent spec.

### 4.2 Streams are hashed as bytes, never embedded

The manifest *describes* streams; it never contains them. Each stream — video,
audio, IMU — is a blob, hashed as bytes, with only its `sha256` and observed
parameters in the manifest.

This matters most for IMU. Serializing IMU samples as JSON floats makes
byte-exact reproducibility hostage to float formatting across two runtimes.
Instead IMU is serialized to its own fixed-format binary blob and hashed like
any other stream, carrying `rate_hz_observed` and `samples` as metadata.

### 4.3 On-device hashing

`crypto.subtle.digest` has no streaming API, so hashing is
`await blob.arrayBuffer()` then digest, **in a Web Worker** — the UI thread must
stay responsive immediately after a thermally-stressed recording.

At episode sizes (tens of MB) this is acceptable. If it stalls on real hardware,
the fallback is `hash-wasm` with chunked streaming; the change is contained
because hashing sits behind a single function.

### 4.4 Order of operations

This ordering *is* approach C, and must not be reordered for convenience:

```
record → hash each stream → build manifest → JCS-hash manifest → sign → upload
```

The commitment exists before a byte leaves the device.

### 4.5 Signature

**EIP-712 typed data**, not `personal_sign`, over:

```
{ episode_id, manifest_hash, bounty_id, chainId }
```

Binding chainId and episode_id prevents the relay from replaying a signature on
another chain or against another episode, and the wallet shows the contributor
something legible rather than a hex blob.

### 4.6 The CID ordering problem

Product-spec §5 places a `cid` inside each stream entry. The CID is only known
after pinning, which happens on the backend — after the manifest has already
been signed. As written, the schema is circular.

Computing CIDs on-device is possible (they are deterministic from bytes) but
requires the client's chunker configuration to match the pinner's exactly, or
identical bytes yield different CIDs. With the storage provider still unpicked,
that is a coupling to avoid.

**Resolution — split the record.** The signed commitment covers each stream's
`sha256` plus all metadata. CIDs are attached afterward as an unsigned
resolution annotation. Integrity is unaffected: the sha256 binds the bytes
regardless of how they are addressed, and switching storage providers costs
nothing.

> **Product-spec gap:** §5's schema needs this split before the EpisodeRegistry
> contract is written against it.

### 4.7 Server-side verification

Before pinning or relaying anything, the API route:

1. Recomputes each stream's `sha256` from the received bytes.
2. Re-derives the JCS hash from the received manifest.
3. Recovers the EIP-712 signer and confirms it matches the claimed entity.

Any mismatch rejects the submission before it touches storage or the chain.

---

## 5. Capture layer

### 5.1 One interface, two implementations

```ts
interface CaptureBackend {
  probe(): Promise<CaptureCapabilities>   // lenses, resolutions, frame-timing support
  start(opts: CaptureOpts): Promise<void>
  stop(): Promise<RawCapture>             // blobs + timing sidecar + observed params
}
```

A capability-detecting factory selects the implementation at runtime.

**`ChromiumCapture`** runs `MediaRecorder` for the encoded blob and
`MediaStreamTrackProcessor` as a *timestamp sidecar*, yielding real per-frame
capture times from `VideoFrame.timestamp`. Reading a track through a processor
consumes its frames, so the track is `clone()`d and each path gets its own copy.

**`SafariCapture`** runs `MediaRecorder` alone, anchoring `performance.now()` at
`onstart`. Per-frame timestamps are recovered from decoded container PTS on the
backend.

**`MockCaptureBackend`** returns fixture data, for UI tests.

### 5.2 Timing honesty

Product-spec §5 declares a constant `est_skew_ms: 35`. That is not measurable
from the client on Safari, and thermal throttling makes real frame rate drift
mid-episode, so skew *accumulates* rather than staying constant.

The client therefore emits both `fps_nominal` and a measured `fps_observed`, and
skew is reported from what was measured rather than asserted as a constant.

### 5.3 IMU recorder (shared across backends)

A `devicemotion` listener pushing `{t: performance.now(), accel, rotationRate}`.

- On iOS, `DeviceMotionEvent.requestPermission()` must fire inside a genuine
  user gesture — so the permission grant is a button tap, never an on-mount
  effect.
- Sample rate is **measured**, never assumed. Actual inter-sample interval is
  computed and written as `rate_hz_observed`, which also catches iOS Low Power
  Mode silently dropping the rate well below 60Hz.

### 5.4 Axis labelling, not axis normalizing

The validator's flow↔gyro correlation needs to map gyro axes into camera axes.
`DeviceMotionEvent.rotationRate` conventions vary by platform and screen
orientation.

The client **labels** rather than normalizes: it records
`screen.orientation.type`, the observed `rotationRate` convention, and a declared
`imu_frame` tag, and leaves the mapping to the validator. Normalizing on-device
means debugging a coordinate-frame bug on a phone; labelling means debugging it
in Python.

### 5.5 Field of view

Product-spec §3.2 omits this: a phone rear camera is ~65–70° FOV against the
~110–150° of Ego4D/Aria rigs. Head-mounted at that FOV, manipulation at chest or
waist level leaves frame constantly. This is a data-quality risk to the core
dataset.

The API-level mitigation is partial — probe `enumerateDevices` and
`getCapabilities().zoom`, prefer the widest lens — because Safari will not
reliably surface the ultra-wide. **The real mitigation is UI**: a viewfinder
framing guide overlaying where the hands must stay.

Whatever was actually obtained (`getSettings()`, resolution, device label) is
written into the manifest, so the dataset is self-describing.

> **Product-spec gap:** FOV belongs in §3.2's stated-limitations list.

### 5.6 Session integrity and failure handling

**Invariant: `stop()` returns either a complete `RawCapture` or nothing.** A
partial episode is discarded, never uploaded.

| Failure | Handling |
|---|---|
| Permission denied | Explicit UI state with re-request path (must be gesture-driven on iOS) |
| No camera / no motion sensor | Capability screen, blocks entry to capture |
| Interrupted by call or backgrounding | Discard, inform, offer re-record |
| Storage quota exceeded | Surface before recording, via quota estimate |

Wake Lock is acquired on the capture screen and re-acquired on
`visibilitychange`. Episodes hard-cap at the bounty's `duration_range_s`
ceiling, which doubles as the thermal mitigation from §3.2.

---

## 6. Upload, storage, and the chain path

### 6.1 Upload is retryable and decoupled from capture

Blobs land in IndexedDB the moment `stop()` returns. Upload is a separate step
against `app/api/episodes`, retryable without re-recording, with an "unsent
episodes" tray making pending work visible.

Scene 1 of the demo is a live recording. A dropped upload must cost a tap, not a
re-take.

### 6.2 Storage behind an interface

`lib/storage/` exposes a single `pin(blob) → {uri}`, with a local/S3-compatible
implementation available from day one. The production provider (0G, IPFS,
Filecoin) is selected when sponsor tracks are confirmed. No build work waits on
that decision.

### 6.3 The contributor never sends a transaction

The relay submits `submitEpisode` with the contributor's EIP-712 signature
passed as an argument, and the contract attributes the episode to the
**recovered signer**, not the relayer. Entity registration is relayed the same
way.

This removes the paymaster problem from the contributor path entirely: no gas,
no sponsored-transaction plumbing, no wallet prompt beyond a signature. It also
lowers the stakes on the embedded-wallet vendor choice, since the wallet is only
ever a signer.

> **Contract requirement:** `EpisodeRegistry.submitEpisode` and
> `EntityRegistry.registerEntity` must accept a signature and attribute to the
> recovered signer. This is a hard dependency of the PWA design.

### 6.4 Earnings display

USDC arrives at the contributor's address from `BountyEscrow`. The UI reads the
ERC-20 balance directly. The demo runs on testnet and the UI says so — an
unqualified claim that a payment landed is checkable.

---

## 7. Buyer surface

Read-heavy and deliberately thin.

| Route | Purpose | Demo scene |
|---|---|---|
| `/b/bounties/new` | Create bounty; USDC approve + escrow | 4 |
| `/b/bounties/[id]` | Episode list, plausibility scores, trust-level badges, accept/reject, real-vs-spoof trace overlay | 3, 4 |
| `/b/datasets/[id]` | Scaling curve, federated round records, provenance graph | 5, 6 |

Buyers connect a standard wallet rather than using an embedded one. They are
crypto-native, they escrow real USDC, and the 90-second onboarding story does
not apply to them. Serving both personas through one wallet path is how that
code becomes unmaintainable.

Create-bounty is the only place in the entire application where a user sends a
real transaction.

Every episode card displays its trust level, per product-spec §6.4's requirement
that the MVP produce `heuristic` data and say so.

---

## 8. Testing

| Target | Approach |
|---|---|
| Canonicalization | Golden-vector fixture asserted in both browser and Node. **Written first.** |
| Capture UI | `MockCaptureBackend` behind the interface |
| Real capture path | Playwright with Chrome's fake media device |
| IMU | Synthetic `devicemotion` event injection |
| Contract interaction | Local anvil chain |
| Manifest round-trip | Client-built manifest verified by the same server-side check as §4.7 |

**The test that matters most cannot be automated.** A physical strap test on both
an iPhone and an Android device — checking framing, thermals, permission flow,
wake lock, and IMU rate under real conditions — is run on **day 2**, not day 5.
Every FOV, thermal, and sync assumption in this document is falsifiable only
that way, and discovering a broken assumption on day 5 costs the demo.

---

## 9. Build order

1. Canonicalization module + golden-vector test.
2. HTTPS dev environment; skeleton app installable on a phone.
3. `CaptureBackend` interface, both implementations, IMU recorder. **Strap test.**
4. Manifest assembly, worker hashing, EIP-712 signing.
5. IndexedDB persistence, upload endpoint, server-side verification, storage stub.
6. Relay path and contract integration.
7. Contributor UI polish — the one thing product-spec §16 says must be polished.
8. Buyer surface.

Steps 1–3 are the critical path; everything after is additive. If time runs out,
the buyer surface degrades to a read-only view over the subgraph before the
contributor flow gives up anything.

---

## 10. Required changes to the parent product spec

Surfaced by this design and needing to land before the contracts are written:

1. **§5** — add a canonicalization rule (RFC 8785 / JCS, `manifest_hash` excluded).
2. **§5** — split the signed commitment from the CID resolution annotation (§4.6).
3. **§5** — IMU as a hashed binary stream, not JSON floats in the manifest.
4. **§5** — replace constant `est_skew_ms` with measured `fps_observed`.
5. **§3.2** — add field of view to the stated limitations.
6. **§11** — `submitEpisode` / `registerEntity` must accept a signature and
   attribute to the recovered signer.

Two further product-spec gaps fall outside the PWA but are noted for tracking:
bystander privacy is absent from §3.2 and §17 entirely, and §7's bounty budget
arithmetic contradicts §13's split.
