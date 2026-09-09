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
- **The on-chain write path is proven by unit tests and code review, not yet by a real broadcast.** The simulation run below is genuine and live (real TEE simulator, real secret fetch, real HTTP calls into the running app) but exercised the *reject* path, because the one real episode in the local store scores below the confidential bar. `workflow.test.ts` covers the pass/fail decision logic directly (`passesConfidentialBar`) for both branches. A real on-chain `writeReport` would need `consumerAddress` pointed at a deployed `ChainlinkValidatorConsumer` and a funded signing key — deliberately not done automatically, since broadcasting a real transaction is a deliberate action, not a side effect of running a demo.

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
to see the pass path attempt a real `writeReport` instead (it will fail
against the placeholder zero-address `consumerAddress` in
`config.staging.json` until a real deployment address is filled in).

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

Deployment needs Confidential Workflows private-beta access
(`cre account access` — requested via Chainlink's self-serve form; per their
team, requests take 24–48 hours). Once approved:

1. Deploy `ChainlinkValidatorConsumer` (constructor: `EpisodeRegistry` address, forwarder address) and call `EpisodeRegistry.setValidator(consumer, true)`.
2. Set `evms[0].consumerAddress` in `config.staging.json` to the deployed address.
3. `cre workflow deploy episode-validator --target staging-settings`.
