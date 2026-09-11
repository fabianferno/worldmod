# Environment variables

Every `.env` file in this repo is gitignored — none of the real values are in
git history. This doc lists what each app needs, why, and where to get it.
Ask a teammate for real values; **never commit a filled-in `.env` file.**

All keys here are testnet-only. Nothing in this repo holds or should ever
hold a mainnet private key.

---

## `web/.env.local` — the Next.js app

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_ACTIVE_CHAIN` | Yes | `"sepolia"` or `"hedera"` — which network `config.ts` wires the app against. Public because the browser needs the same answer the server gets. |
| `RELAYER_PRIVATE_KEY` | Yes | Testnet-only key that pays gas so a contributor never needs any. Same key as `contracts/.env`'s `PRIVATE_KEY`. Sepolia only. |
| `SEPOLIA_RPC_URL` | Yes | RPC endpoint for Ethereum Sepolia. |
| `HEDERA_TESTNET_RPC_URL` | Yes | Hedera testnet RPC (Hashio), e.g. `https://testnet.hashio.io/api`. |
| `NEXT_PUBLIC_WORLD_APP_ID` | Yes | World App mini app id (product-spec §10.3). Public — ships in the client bundle. |
| `WORLD_RP_ID` | Yes | RP registration id for IDKit v4 (Selfie Check). |
| `WORLD_RP_SIGNING_KEY` | Yes | Signs the RP context for Selfie Check requests. **Server-side only — must never reach the browser.** See `lib/world/rp-context.ts`. |
| `HEDERA_ACCOUNT_ID` | Yes (if using Hedera) | Hedera testnet account, for Asset Tokenization Studio issuance. Same account as `hedera/.env`. |
| `HEDERA_PRIVATE_KEY` | Yes (if using Hedera) | Matching private key. Same as `hedera/.env`. |
| `IPFS_API_URL` | No | Defaults to `http://127.0.0.1:5001` (a local IPFS daemon). Only set if pinning against a remote node. |

## `contracts/.env` — Foundry

| Variable | Required | Purpose |
|---|---|---|
| `PRIVATE_KEY` | Yes | Deployer key, read by `Deploy.s.sol` / `DeployDatasetsAndFederation.s.sol` via `vm.envUint`. Fund with testnet HBAR before deploying to Hedera. |
| `HEDERA_TESTNET_RPC_URL` | Yes | Referenced in `foundry.toml`'s `[rpc_endpoints]` as `hedera_testnet`. |
| `SEPOLIA_RPC_URL` | Yes | Used by the `*.fork.t.sol` tests (`vm.envString`) to fork Sepolia for integration tests, and for redeploying to Sepolia if needed. |

## `cre/.env` — Chainlink CRE workflow

| Variable | Required | Purpose |
|---|---|---|
| `CRE_ETH_PRIVATE_KEY` | Yes | Ethereum key or 1Password reference (`op://vault/item/field`) the CRE CLI uses. Placeholder value is fine for local `cre workflow simulate`. |
| `CRE_TARGET` | Yes | Which `workflow.yaml` target to use when `--target` isn't passed — `staging-settings` or `production-settings`. |
| `SECRET_MIN_FRAMING` | Yes | The bounty's confidential framing threshold. Fetched inside the TEE via `runtime.getSecret({id:'MIN_FRAMING'})` — never served by the public API. `0.7` matches the seeded demo bounty (`web/src/lib/market/seed.ts`). |
| `SECRET_MIN_PLAUSIBILITY` | Yes | Same, for the plausibility threshold. `0.7` for the demo bounty. |

## `hedera/.env` — standalone Hedera scripts (ATS bond issuance, KYC, coupon ops)

| Variable | Required | Purpose |
|---|---|---|
| `HEDERA_ACCOUNT_ID` | Yes | Hedera testnet account id. |
| `HEDERA_PRIVATE_KEY` | Yes | Matching private key. **Never commit, never use for mainnet.** |
| `HEDERA_EVM_ADDRESS` | No | EVM-alias form of the account, for scripts that need it directly instead of deriving it. |
| `HEDERA_NETWORK` | No | Present for reference; scripts default to testnet. |

## `subgraph/.env` — deprecated

The Graph subgraph was dropped when the core contracts migrated to Hedera
(subgraph indexed Sepolia only; see the migration plan). `GRAPH_DEPLOY_KEY`
is still in the directory but not part of the current app — no need to set
this unless you're specifically reviving subgraph work.

---

## Setup

```bash
cp contracts/.env.example contracts/.env
cp cre/.env.example cre/.env
```

`web/.env.local` has no `.example` file yet — copy the variable names from
the table above, or ask a teammate for a template.

Fill in real values from a teammate or your own testnet accounts (Sepolia
faucet, Hedera portal). Do not paste real values into Slack/chat history —
share via a password manager or secrets vault instead.
