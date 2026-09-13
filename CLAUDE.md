# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

World Mod: a DePIN product where a contributor records a short video episode on a
phone PWA, the episode is scored server-side, and an accepted episode pays out in
USDC on-chain (Ethereum Sepolia). Buyers post bounties, buy datasets bundled from
accepted episodes, and can fund federated training rounds. The full spec is
[`product-spec.md`](product-spec.md) — code and comments cite it by section (e.g.
"§8.1", "§10.3"); [`README.md`](README.md) is the practical walkthrough of what
actually works; [`PRODUCT.md`](PRODUCT.md) is a short list of product principles;
[`DESIGN.md`](DESIGN.md) is the visual design system, not product logic.

`attestcoin.md` at the repo root is the current build brief for a Creditcoin/
Attestcoin cross-chain integration (verifying Sepolia settlement transactions
from an ASC on Creditcoin testnet). It supersedes any other sponsor-track notes
in this repo — World App (Worldcoin), a Hedera testnet migration, and a
Chainlink CRE confidential-workflow experiment were all built and then removed
from this codebase; don't reintroduce them or treat old comments referencing
them as current.

That integration's ASC lives in a **separate repo**,
[github.com/Ashar20/attestcoin](https://github.com/Ashar20/attestcoin) — not a
subdirectory here. This repo's side of it is just the `EpisodeAcceptedForAttestation`
event on `BountyEscrow` and the `POST /api/chain/attestation` webhook the other
repo's readability worker calls back into (see README's "Attestcoin" section).

## Commands

```sh
# web/ — Next.js 16 PWA
cd web
npm install && npm run dev        # predev fetches vision assets (MediaPipe/model files) first
npm run build                     # prebuild does the same
npm run lint                      # eslint
npm run typecheck                 # tsc --noEmit
npm test                          # vitest run — all tests
npx vitest run path/to/file.test.ts   # a single test file
npx vitest run -t "test name"         # a single test by name

# contracts/ — Foundry
cd contracts
forge install foundry-rs/forge-std   # not vendored
forge test                                    # unit tests, offline
SEPOLIA_RPC_URL=<url> forge test              # + fork tests against real Sepolia USDC
forge test --match-test test_someName         # a single test
forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --verify
forge script script/DeployDatasetsAndFederation.s.sol --rpc-url sepolia \
  --broadcast --verify --sig "run(address)" <episodeRegistryAddress>

# trainer/ — standalone Python, only useful once episodes exist
cd trainer && python3 -m venv --system-site-packages .venv
.venv/bin/pip install torchvision
.venv/bin/python run.py --data ../web/.data                 # writes web/public/model-results.json
.venv/bin/pip install onnx onnxruntime
.venv/bin/python export_live.py --data ../web/.data --out ../web/public/models/world
```

On a phone over USB: `adb reverse tcp:3000 tcp:3000` (localhost is a secure
context, so capture works without a TLS cert). `/c` is the contributor capture
route, `/b/bounties` is the buyer side.

## Architecture

### Contracts (`contracts/src/`, Foundry, Ethereum Sepolia)

Six registries, deployed addresses in `contracts/deployments.json` (chain
`"11155111"` — the only entry; don't add others without a real reason):

- `EntityRegistry` — individuals/orgs, no PII on-chain.
- `AssetRegistry` — registered sensors/phones and a capability bitmask, tied to an entity.
- `EpisodeRegistry` — episode manifest commitments and validator results (score, trust level).
- `BountyEscrow` — a buyer escrows USDC per bounty; payout on acceptance reads validation
  from `EpisodeRegistry` rather than trusting the caller. `acceptEpisode` also emits
  `EpisodeAcceptedForAttestation`, a dedicated event the separate Attestcoin ASC repo
  proves via the block-prover precompile — don't rename or drop its fields without
  updating that repo's `sourceEmitter`/decoder expectations.
- `DatasetRegistry` — bundles episode commitments into a licensed dataset.
- `FederatedRound` — coordinates federated training rounds; only hashes/metrics move on-chain, never data.

`Relayable.sol` is the shared piece: contributor actions are signed off-chain
(EIP-712) and submitted by an untrusted relayer, attributed to the *recovered
signer*, not whoever paid gas. This is how someone with a phone and no funded
account can still act — it's the answer to the "contributors never send a
transaction" constraint, and the registries' tests pin that a relayer can
decline a submission but can't alter or claim it.

`*.fork.t.sol` tests run against Circle's real Sepolia USDC (not a mock — it
reverts rather than returning `false`, and is an upgradeable proxy) and
self-skip without `SEPOLIA_RPC_URL` set, so `forge test` alone still runs clean
offline.

### Web app (`web/`, Next.js 16 App Router)

Two route groups under `web/src/app/`:
- `(contributor)/c/*` — the capture flow (`capture-client.tsx`) and account/balance page.
- `(buyer)/b/*` — bounties (list/new/detail), datasets, contributors, the world-model
  dashboard, federated rounds.

`web/src/lib/` by subsystem:
- `chain/` — viem client, relayer, ABIs, contract addresses/config, the device-key signer.
- `market/` — bounty/episode acceptance logic (`acceptance.ts`), reputation, the file-backed store.
- `episode/` — builds the signed episode manifest, the offline upload queue.
- `analysis/` — the vision pipeline: framing, optical flow, hand landmarks, correlation, contamination probes.
- `validator/` — server-side scoring, duplicate/spoof (flow-vs-gyro) detection, perceptual hashing.
- `capture/` — device capture backends: camera, IMU, geolocation, alignment.
- `storage/` — CID computation and IPFS pinning.
- `worldmodel/` — the live ONNX predictor stepped during capture (see trainer/ below).

**Episode flow, capture to payout:** `capture-client.tsx` records and builds a
manifest → uploads to the marketplace store as `scoring` → server-side
validator scores every frame → `evaluateEpisode()` in `lib/market/acceptance.ts`
decides accept/reject with reasons → the client calls `anchorEpisode()`
(`lib/chain/anchor-client.ts`) → `POST /api/chain/anchor` re-verifies the
manifest hash against stored state (never trusts the client's own score) and
calls `lib/chain/relay.ts`, which submits the episode on-chain and records
validation via the relayer's key → an accepted episode's payment is released
through `BountyEscrow`, plus a small ETH dust transfer so the contributor can
later pay gas to withdraw. Separately and asynchronously, the Attestcoin
readability worker (other repo) proves that acceptance on Creditcoin and
`POST`s the result to `/api/chain/attestation`, which looks the episode up by
its on-chain id and attaches an `EpisodeAttestation` — rendered as a "verified
on Creditcoin" link on both the buyer bounty page and the contributor account
page.

**Identity:** a single kind — a device key generated client-side (viem,
secp256k1) and cached in `localStorage`. It signs everything
(`lib/chain/signer.ts`'s `deviceSigner()`) and is *not recoverable*: clearing
site data loses the key and anything owed to it. `signer-context.tsx` gates
this behind a client-mount check (`useSyncExternalStore`) since reading
`localStorage` during SSR crashes the route. There is no wallet-connect or
social-recovery path in the codebase right now — product-spec §10.3's ask for
a recoverable identity is unmet (World App/MiniKit was one attempt at this and
was removed; don't resurrect it without discussing scope first).

### `trainer/` — standalone, one live wiring point

Offline Python (PyTorch): `run.py` writes `web/public/model-results.json`,
which `/b/model` renders. `export_live.py` exports an ONNX model to
`web/public/models/world/` that the Node server behind `/c` steps through
frame-by-frame during capture (`lib/worldmodel/`) — this is the one live
wiring point between trainer output and the running app.

There is no subgraph or other indexer in this repo — provenance queries go
straight to the contracts (`lib/chain/relay.ts`'s `publicClient`,
`lib/chain/datasets.ts`) rather than through an indexed graph.
