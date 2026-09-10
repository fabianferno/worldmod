# Episode validation, as a Chainlink CRE Confidential Workflow

## What this replaces

World Mod's episode validator used to be one EOA doing three jobs at once:
gas relayer, sole validator, and sole utility oracle. It compared an
episode's plausibility/framing score against the buyer's acceptance
threshold itself, then wrote the result on-chain with its own key —
product-spec §8.3 names this plainly as the MVP's centralized trust limit.

`episode-validator/` moves that comparison into a Chainlink CRE Confidential
Workflow. The buyer's threshold is fetched as a secret *inside a TEE*; the
comparison happens there; only the pass/fail verdict crosses back out, via a
DON-signed report to [`ChainlinkValidatorConsumer.sol`](../contracts/src/ChainlinkValidatorConsumer.sol),
a new registered `EpisodeRegistry` validator
(`EpisodeRegistry.setValidator(consumer, true)` — no redeploy of the
registry itself).

## What's confidential vs. public

| Value | Where it lives now |
|---|---|
| `min_plausibility` / `min_framing` (the buyer's acceptance bar) | **Secret, fetched inside the enclave.** No longer served by `GET /api/bounties*`, no longer shown on the buyer bounty page, no longer named in an episode's rejection reason. |
| Episode `plausibility` / `framing` score | Public — computed by the existing local scorer (`web/src/lib/validator/score.ts`, ffmpeg + TF.js, no external calls), unchanged. |
| The pass/fail verdict | Public, but *only as a side effect*: a passing episode gets a `ValidationRecorded` event; a failing one gets none. The workflow makes no on-chain call at all for a rejection — the absence of a record **is** the reject verdict, so no numeric threshold or margin is ever inferable from what lands on-chain. |

## Architecture

```
episode submitted → scored (ffmpeg/TF.js, unchanged)
                        │
                        ▼
        POST /api/chain/anchor — commits the manifest hash on-chain
        (no longer also calls recordValidation itself)
                        │
                        ▼
   CRE cron trigger → cre.handlerInTee (TEE, AWS Nitro / us-west-2)
     1. runtime.getSecret({id: MIN_FRAMING})        ┐ fetched inside
        runtime.getSecret({id: MIN_PLAUSIBILITY})   ┘ the enclave
     2. HTTPClient → GET /api/bounties/{id}          — motion_policy (public)
     3. HTTPClient → GET /api/episodes?bounty={id}   — scored, anchored episodes
     4. compare each episode's score against the secret threshold, in-enclave
     5a. fail → log only, no on-chain call at all
     5b. pass → donRuntime.report(...) → evmClient.writeReport(...)
                        │
                        ▼
        ChainlinkValidatorConsumer.onReport (gated: msg.sender == forwarder)
                        │
                        ▼
        EpisodeRegistry.recordValidation(episodeId, score, trustLevel)
```

`workflow.ts` follows the real, CLI-scaffolded `hello-confidential-workflows-ts`
template (`cre.handlerInTee`, `runtime.getSecret`, `cre.capabilities.HTTPClient`)
for the enclave logic, and the real `keeper-bot-ts` template's
`prepareReportRequest` → `donRuntime.report` → `evmClient.writeReport` pattern
for the on-chain delivery — both scaffolded and read directly from the
installed `cre` CLI (`v1.33.0`), not guessed from docs.

## Scope, honestly

- **One bounty per deployed workflow instance** (`bountyId` in `config.staging.json`/`config.production.json`). Multi-bounty support would need per-bounty dynamic secret ids — a real next step, not done here.
- **Utility scoring is out of scope.** `BountyEscrow.settleUtility` has no callers anywhere in the app; wiring it up would be new product functionality, not confidentializing something that already exists.
- **The on-chain receiver is live and fully wired; only the CRE-side `writeReport` broadcast remains.** `ChainlinkValidatorConsumer` is deployed on Sepolia at [`0xe0ca68241159A635Bc383f79c7095dC09d9C3dde`](https://sepolia.etherscan.io/address/0xe0ca68241159A635Bc383f79c7095dC09d9C3dde), registered as an `EpisodeRegistry` validator (`isValidator` = true), and wired into both configs' `evms[0].consumerAddress` — so the pass path no longer targets a zero address. It accepts **two** forwarders, mirroring the reference [`perjury`](https://github.com/krishnan74/perjury) `VerdictSink`: the production Sepolia `KeystoneForwarder` [`0xF8344CFd5c43616a4366C34E3EEE75af79a74482`](https://sepolia.etherscan.io/address/0xF8344CFd5c43616a4366C34E3EEE75af79a74482) and the tenant's mock forwarder [`0x15fC6ae953E024d975e77382eEeC56A9101f9F88`](https://sepolia.etherscan.io/address/0x15fC6ae953E024d975e77382eEeC56A9101f9F88), both confirmed against this org with `cre workflow supported-chains`. A report therefore lands whether delivered by the live DON or a mock/test path, and either slot is owner-rotatable (`setForwarder` / `setAltForwarder`). The contract shape otherwise matches Chainlink's official `ReceiverTemplate` (`IReceiver` + `onReport(bytes,bytes)` + forwarder gating + ERC-165). The only thing left for a real `writeReport` is deploying the workflow itself live to the DON (the on-chain CRE Workflow Registry is mainnet-anchored, so link-key + deploy need a funded mainnet owner key — `cre account access` already reports deploy access enabled); until then the simulation below exercises both branches — `getSecrets` in-enclave, reject with no on-chain call, and the pass path reaching `writeReport` through the simulator's mock forwarder.

## Running the simulation

Chainlink's own qualification bar for this bounty accepts a CLI simulation as
sufficient proof (no live TEE deployment required — deployment is separately
gated behind Confidential Workflows' private beta, requested but not yet
approved for this account).

```bash
# 1. Install the CRE CLI (installs to ~/.cre, adds it to PATH)
curl -sSL https://app.chain.link/install.sh | bash

# 2. Authenticate (opens a browser; a free app.chain.link account is enough —
#    this is separate from, and does not require, Confidential Workflows deploy access)
cre login

# 3. Install workflow dependencies
cd cre/episode-validator && bun install && cd ..

# 4. Run the app locally (the workflow calls its API from inside the enclave)
cd ../web && npm run dev &

# 5. Simulate
cd ../cre
cre workflow simulate episode-validator --target staging-settings --non-interactive --trigger-index 0
```

### Real output (this was actually run, not fabricated)

```
✓ Workflow compiled
✓ Simulation limits enabled
  Binary hash: 6f11c2815a27f544e52c916b19c7afa58225cae8800f56fb5ef2a8e8b1f92011

2026-09-10T15:54:05Z [SIMULATION] Running trigger trigger=cron-trigger@1.0.0
╭────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ Trigger requested TEE Execution your trigger will run in one of the following Tees:                │
│     - AWS Nitro in us-west-2                                                                       │
│ The simulator is not a real TEE, and is meant to debug.                                            │
╰────────────────────────────────────────────────────────────────────────────────────────────────────╯

2026-09-10T15:54:05Z [USER LOG] episode-validator-getsecrets-ok
2026-09-10T15:54:05Z [USER LOG] episode-validator-reject episode_id=ep_c314f7a15300395dbe2a34b3
2026-09-10T15:54:05Z [USER LOG] episode-validator-complete candidates=1

✓ Workflow Simulation Result:
"{\"bountyId\":\"bounty_keyboard_001\",\"results\":[{\"episodeId\":\"ep_c314f7a15300395dbe2a34b3\",\"verdict\":\"fail\"}]}"
```

The one real episode in the local demo store scored `framing: 0.512` against
the confidential bar of `0.7` (from `SECRET_MIN_FRAMING` in `.env`, matching
`web/src/lib/market/seed.ts`'s bounty) — correctly rejected, entirely inside
the enclave, with **no on-chain call attempted** for the reject case. Lower
`SECRET_MIN_FRAMING`/`SECRET_MIN_PLAUSIBILITY` in `.env` below `0.512`/`0.714`
to see the pass path attempt a real `writeReport` against the deployed
`ChainlinkValidatorConsumer` now wired into `config.staging.json`. On a live
DON deployment that write is delivered by the Sepolia `KeystoneForwarder`
(`0xF8344CFd5c43616a4366C34E3EEE75af79a74482`), which the consumer's `onReport`
already trusts; the local simulator routes it through a mock forwarder instead.

### Unit tests

```bash
cd episode-validator && bun test
```

10/10 pass — decision logic for both the pass and fail branches
(`passesConfidentialBar`), the "unanchored episode is skipped" case, and that
neither secret threshold value ever appears in a log line.

## Configuration

`episode-validator/config.staging.json` / `config.production.json`:

| Field | Description |
|-------|-------------|
| `schedule` | Cron expression (6 fields, seconds first) |
| `appBaseUrl` | World Mod app base URL, called from inside the enclave |
| `bountyId` | Which bounty this workflow instance validates |
| `secretIds.minFramingId` / `.minPlausibilityId` | Secret IDs fetched with `runtime.getSecret()`; must match `../secrets.yaml` |
| `evms[0].chainSelectorName` / `.consumerAddress` / `.gasLimit` | Where the passing verdict is delivered on-chain |

`secrets.yaml` maps those IDs to environment variables (`SECRET_MIN_FRAMING`,
`SECRET_MIN_PLAUSIBILITY` in `.env`) — in a real deployment these are held by
the Vault DON and released only into the attested enclave.

## Deploying for real

The on-chain receiver is already deployed and wired (see "Scope" above):

1. ✅ `ChainlinkValidatorConsumer` is deployed on Sepolia and registered as an
   `EpisodeRegistry` validator, via
   `forge script script/DeployChainlinkValidatorConsumer.s.sol --broadcast --sig "run(address,address,address)" <episodeRegistry> <forwarder> <altForwarder>`
   (see `contracts/deployments.json`).
2. ✅ `evms[0].consumerAddress` in both config files points at it.
3. ✅ Its two forwarders are set to the real Sepolia `KeystoneForwarder`
   (`0xF8344CFd5c43616a4366C34E3EEE75af79a74482`) and the tenant mock forwarder
   (`0x15fC6ae953E024d975e77382eEeC56A9101f9F88`), both confirmed against this
   org with `cre workflow supported-chains`. Repoint either with
   `consumer.setForwarder(...)` / `consumer.setAltForwarder(...)` if a value
   ever changes.

What still needs a funded mainnet owner key (the CRE Workflow Registry is
anchored on ethereum-mainnet, so `cre account link-key` and the deploy both
broadcast a small mainnet tx — ~0.00001 ETH at current gas; `cre account
access` already reports deploy access enabled):

4. Link the workflow owner: `cre account link-key --target staging-settings`.
5. Upload secrets to the Vault DON: `cre secrets create secrets.yaml --target staging-settings`.
6. `cre workflow deploy episode-validator --target staging-settings`.
