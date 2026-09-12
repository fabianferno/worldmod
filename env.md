# Environment variables — deploy reference

The only thing you **deploy** is the **web app** (`web/`). The contracts and
CRE workflows are already deployed to testnet (see `contracts/deployments.json`);
their env blocks below are only for **re-deploying** them. The trainer runs
offline and needs no app env.

Audited against actual `process.env` / `vm.env*` / secret usage in the repo —
nothing here is speculative, and dead/legacy vars are called out in the last
section.

Legend: **public** = inlined into the browser bundle (not secret) · **server**
= server-only, safe but not secret · **secret** = never commit, never expose.

---

## A. Web app (`web/.env.local` / your host's env) — this is what you deploy

### Required for the full demo
| Var | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_ACTIVE_CHAIN` | public | `sepolia` or `hedera`. Selects which chain the app reads/anchors against. Default `sepolia`. |
| `NEXT_PUBLIC_WORLD_APP_ID` | public | World App / MiniKit app id — enables World sign-in and the Selfie Check. |
| `WORLD_RP_ID` | server | World relying-party id used to verify the Selfie Check proof. |
| `WORLD_RP_SIGNING_KEY` | secret | Signs the World RP context request. |

### Required depending on the active chain (the relayer that pays gas + anchors)
| Var | Scope | Needed when | Purpose |
|---|---|---|---|
| `RELAYER_PRIVATE_KEY` | secret | `ACTIVE_CHAIN=sepolia` | Relayer key that pays gas and anchors episodes on Sepolia. |
| `HEDERA_PRIVATE_KEY` | secret | `ACTIVE_CHAIN=hedera`, **and** for the Hedera Bond lifecycle either way | Hedera operator key (relayer when Hedera-active; Bond issue/mint/coupon/payout). |
| `HEDERA_ACCOUNT_ID` | secret | same as above | Hedera operator account id (e.g. `0.0.xxxxx`). Together with `HEDERA_PRIVATE_KEY` it gates whether the "Issue as Hedera Bond" UI appears. |

### Optional (have working defaults — set for production)
| Var | Scope | Default | Set it when |
|---|---|---|---|
| `SEPOLIA_RPC_URL` | server | `https://ethereum-sepolia-rpc.publicnode.com` | You want a private/rate-limited RPC instead of the public one. |
| `HEDERA_TESTNET_RPC_URL` | server | `https://testnet.hashio.io/api` | Same, for Hedera. |
| `IPFS_API_URL` | server | `http://127.0.0.1:5001` | **Recommended in prod** — the default is a local IPFS node that won't exist on your host, so point this at a real IPFS API for episode/stream pinning. |

> `NODE_ENV` is managed by the framework — **do not set it manually.**
>
> Graceful degradation: with none of the chain/World vars, the app still runs
> on a device key with anchoring off — but sign-in, Selfie Check, payouts, and
> the Bond lifecycle need the vars above.

**Paste-ready `web/.env.local` (Sepolia-active demo):**
```dotenv
NEXT_PUBLIC_ACTIVE_CHAIN=sepolia
NEXT_PUBLIC_WORLD_APP_ID=app_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
WORLD_RP_ID=
WORLD_RP_SIGNING_KEY=
RELAYER_PRIVATE_KEY=
# Hedera Bond lifecycle (also the relayer if ACTIVE_CHAIN=hedera):
HEDERA_ACCOUNT_ID=0.0.xxxxxxxx
HEDERA_PRIVATE_KEY=
# Optional overrides:
# SEPOLIA_RPC_URL=
# HEDERA_TESTNET_RPC_URL=
# IPFS_API_URL=
```

---

## B. Contracts (`contracts/.env`) — only to RE-deploy contracts
Already deployed; skip unless you're re-broadcasting.
| Var | Scope | Purpose |
|---|---|---|
| `PRIVATE_KEY` | secret | Deployer key (fund with testnet HBAR/ETH first). |
| `SEPOLIA_RPC_URL` | server | Broadcast/fork-test target on Sepolia. |
| `HEDERA_TESTNET_RPC_URL` | server | Broadcast target on Hedera (chain 296). |

## C. CRE workflows (`cre/.env`) — only to RE-deploy the confidential workflows
Already registered; skip unless re-deploying. `cre/.env` is gitignored and holds
the confidential secrets — never commit it.
| Var | Scope | Purpose |
|---|---|---|
| `CRE_ETH_PRIVATE_KEY` | secret | EOA that owns/runs the CRE workflows (or a `op://…` 1Password ref). |
| `CRE_TARGET` | server | Default target, e.g. `staging-settings` / `production-settings`. |
| `SECRET_MIN_FRAMING` | secret | Confidential acceptance threshold, fetched inside the enclave (demo `0.7`). |
| `SECRET_MIN_PLAUSIBILITY` | secret | Confidential acceptance threshold (demo `0.7`). |
| `SECRET_UTILITY_GAMMA` | secret | Utility-oracle weighting exponent (demo `1.5`). |

## D. Trainer (`trainer/`)
No app environment variables. It needs its Python/ML dependencies installed
(`torch`, `torchvision`, etc.); DP is a CLI flag (`--dp-epsilon …`), not an env var.

---

## E. Remove / do NOT set (unnecessary)
These are **not referenced anywhere** in the current codebase — safe to delete
if they linger in a `.env`, your host's config, or an old template:
- `NODE_ENV` — framework-managed; setting it by hand causes subtle build issues.
- Any **Privy** vars (`NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_*`) — the app moved to
  World App / MiniKit; Privy is gone.
- Any **Graph / subgraph** vars (`*SUBGRAPH*`, `NEXT_PUBLIC_GRAPH*`) — the
  subgraph was removed.
- Third-party pinning keys (`PINATA_*`, `WEB3_STORAGE_*`) — not used; pinning
  goes through `IPFS_API_URL`.
- RPC-provider keys (`ALCHEMY_*`, `INFURA_*`) — not used; RPC is a plain URL via
  `SEPOLIA_RPC_URL` / `HEDERA_TESTNET_RPC_URL`.

**Minimum to deploy the web app and demo everything:**
`NEXT_PUBLIC_ACTIVE_CHAIN`, `NEXT_PUBLIC_WORLD_APP_ID`, `WORLD_RP_ID`,
`WORLD_RP_SIGNING_KEY`, `RELAYER_PRIVATE_KEY`, `HEDERA_ACCOUNT_ID`,
`HEDERA_PRIVATE_KEY` — plus `IPFS_API_URL` for real uploads.
