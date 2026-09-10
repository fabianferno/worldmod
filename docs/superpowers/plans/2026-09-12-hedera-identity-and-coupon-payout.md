# Hedera Identity Bridge & Coupon Payout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dataset creator the real holder of the ATS Bond (via KYC'd minting) and pay a coupon out in real testnet USDC, exposed both as verified scripts and in the `/b/datasets` app UI.

**Architecture:** Minting Bond units to the KYC'd creator is the one lever that closes both gaps — it makes the creator the economic owner and gives the coupon a non-zero holder. New pure math lives in `hedera/src/coupon-payout.mjs`; a shared `hedera/src/hedera-connect.mjs` wires the SDK once; thin CLI + child-process-JSON scripts drive the ops; the web app spawns the JSON scripts through `lib/hedera/*` wrappers and API routes, mirroring the existing `issue.ts` / `issue-bond/route.ts` pattern.

**Tech Stack:** Node ESM (`.mjs`), `@hashgraph/asset-tokenization-sdk@4.2.0` (CJS internals reached via `createRequire`), `@hiero-ledger/sdk` (HTS transfers), `@terminal3/ecdsa_vc` (KYC VCs), `ethers@6`, Next.js (App Router) for routes/UI.

**Spec:** `docs/superpowers/specs/2026-09-12-hedera-identity-and-coupon-payout-design.md`

## Global Constraints

- ATS SDK pinned to `4.2.0` — do NOT upgrade; 8.0.0 breaks against the live 4.0.0 testnet factory (silent zero-data revert). Verbatim from spec.
- Testnet infra (verbatim): factory `0.0.7708432`, resolver `0.0.7707874`, mirror `https://testnet.mirrornode.hedera.com/api/v1/`, RPC `https://testnet.hashio.io/api`, USDC HTS token `0.0.429274`, chain id `296`.
- The SDK's `globalThis.window` stub is process-wide and permanent — it MUST only run in short-lived scripts/child processes, NEVER inside the Next.js server process. All web access goes through spawned child processes (see `web/src/lib/hedera/issue.ts`).
- Bond config id (Bond, not Equity): `0x0000000000000000000000000000000000000000000000000000000000000002`.
- Every network op must be verified by reading state back from the mirror node / chain, not trusted from the SDK's return value (existing convention).
- Credentials come from env: `HEDERA_ACCOUNT_ID`, `HEDERA_PRIVATE_KEY` (raw hex, ECDSA). Never hardcode or log the private key. `hedera/.env` and `web/.env.local` are gitignored.
- Commit only when a task's steps say to; do not push. Commit-message trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01DEx5MYXK6Nc5rdUcEP7Aaf
  ```

---

### Task 1: Pure coupon-payout math

**Files:**
- Create: `hedera/src/coupon-payout.mjs`
- Test: `hedera/src/coupon-payout.test.mjs`

**Interfaces:**
- Produces: `couponPayoutUsdcSmallest({ unitsHeld, nominalValueCents, ratePercent }) -> bigint` — payout in USDC smallest units (6 dp). `unitsHeld` and `nominalValueCents` are integers (bigint or number); `ratePercent` is a number like `5` for 5%.
- Produces: `USDC_DECIMALS = 6`, `BOND_NOMINAL_DECIMALS = 2` (re-exported for callers).

**Formula (spec):** payout in dollars = `unitsHeld × (nominalValueCents / 100) × (ratePercent / 100)`. Convert to USDC smallest units by multiplying by `10^6`. Because `nominalValueCents` is already cents (2 dp), the cents→USDC scale is `10^(6-2) = 10^4`. So: `amount = unitsHeld × nominalValueCents × ratePercent × 10^4 / 100`, rounded to nearest integer. Keep the `/100` (percent) as the only division and round half-up.

- [ ] **Step 1: Write the failing test**

```javascript
// hedera/src/coupon-payout.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { couponPayoutUsdcSmallest } from "./coupon-payout.mjs";

test("100 units × $1.00 nominal × 5% = $5.00 = 5_000000 USDC smallest", () => {
  assert.equal(
    couponPayoutUsdcSmallest({ unitsHeld: 100n, nominalValueCents: 100n, ratePercent: 5 }),
    5_000000n,
  );
});

test("1 unit × $6.00 nominal × 5% = $0.30 = 300000 USDC smallest", () => {
  assert.equal(
    couponPayoutUsdcSmallest({ unitsHeld: 1n, nominalValueCents: 600n, ratePercent: 5 }),
    300000n,
  );
});

test("zero balance pays zero", () => {
  assert.equal(
    couponPayoutUsdcSmallest({ unitsHeld: 0n, nominalValueCents: 600n, ratePercent: 5 }),
    0n,
  );
});

test("rounds half up to the nearest USDC smallest unit", () => {
  // 3 units × 1 cent × 1% = $0.0003 = 300 smallest; a value that lands on .5 rounds up
  assert.equal(
    couponPayoutUsdcSmallest({ unitsHeld: 1n, nominalValueCents: 1n, ratePercent: 0.5 }),
    50n, // $0.00005 -> 50 smallest units
  );
});

test("accepts number inputs too", () => {
  assert.equal(
    couponPayoutUsdcSmallest({ unitsHeld: 100, nominalValueCents: 100, ratePercent: 5 }),
    5_000000n,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd hedera && node --test src/coupon-payout.test.mjs`
Expected: FAIL — `couponPayoutUsdcSmallest` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// hedera/src/coupon-payout.mjs
export const USDC_DECIMALS = 6;
export const BOND_NOMINAL_DECIMALS = 2;

/**
 * Payout for one holder, in USDC smallest units (6 dp).
 *
 * dollars = unitsHeld × (nominalValueCents / 100) × (ratePercent / 100)
 * usdcSmallest = dollars × 10^6
 *             = unitsHeld × nominalValueCents × ratePercent × 10^4 / 100
 *
 * ratePercent may be fractional (e.g. 0.5), so scale it to an integer
 * basis-points-like factor before doing bigint math, then round half-up on
 * the single final division.
 */
export function couponPayoutUsdcSmallest({ unitsHeld, nominalValueCents, ratePercent }) {
  const units = BigInt(unitsHeld);
  const nominal = BigInt(nominalValueCents);
  // Represent ratePercent with 4 decimal places of precision as an integer.
  const rateScaled = BigInt(Math.round(Number(ratePercent) * 10_000)); // e.g. 5 -> 50000
  const scale = 10n ** BigInt(USDC_DECIMALS - BOND_NOMINAL_DECIMALS); // 10^4
  // numerator = units × nominal × rateScaled × scale
  // denominator = 100 (percent) × 10_000 (rate precision)
  const numerator = units * nominal * rateScaled * scale;
  const denominator = 100n * 10_000n;
  // round half up
  return (numerator + denominator / 2n) / denominator;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd hedera && node --test src/coupon-payout.test.mjs`
Expected: PASS (5 tests). Also run the whole suite: `node --test src/*.test.mjs` — all still green.

- [ ] **Step 5: Commit**

```bash
cd /Users/silas/worldmod
git add hedera/src/coupon-payout.mjs hedera/src/coupon-payout.test.mjs
git commit -m "feat(hedera): pure coupon-payout USDC math with tests"
```

---

### Task 2: Shared SDK connection helper

**Files:**
- Create: `hedera/src/hedera-connect.mjs`

**Interfaces:**
- Produces: `async connect() -> { ports, ownEvmAddress, provider }` where `ports` exposes the resolved SDK port objects `{ Network, Bond, Security, Kyc, Role, SsiManagement, requests }` and `requests` is the whole `port/in/index.js` barrel (so callers pull request classes like `IssueRequest`, `RoleRequest`, `GetSecurityHoldersRequest`, `GetCouponForRequest` from one place). `ownEvmAddress` is `ethers.computeAddress(PRIVATE_KEY)`.
- Produces: `decodedRevertReason(err) -> Promise<{hash,errorMessage,status}|null>` (moved out of the existing scripts, same body).
- Produces: constants `FACTORY_ADDRESS`, `RESOLVER_ADDRESS`, `mirrorNode`, `rpcNode`, `USDC_TOKEN_ID = "0.0.429274"`.

This factors the connection boilerplate duplicated across `spike-issue-bond.mjs`, `issue-dataset-bond.mjs`, `kyc-exercise.mjs`, `set-coupon.mjs`, and `scripts/issue-bond-json.mjs`. Do NOT modify those existing proven scripts in this task — only add the helper the NEW scripts use.

**IMPORTANT (window stub):** the helper sets `globalThis.window ??= {...}` at module top before requiring the SDK, exactly as the existing scripts do. It stays a script-only helper — never imported from anything under `web/src`.

- [ ] **Step 1: Write the helper**

```javascript
// hedera/src/hedera-connect.mjs
import "reflect-metadata";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ethers } from "ethers";

globalThis.window ??= {
  matchMedia: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {}, removeEventListener() {},
  navigator: { userAgent: "node" },
  document: { createElement: () => ({}), getElementsByTagName: () => [] },
};

export const FACTORY_ADDRESS = "0.0.7708432";
export const RESOLVER_ADDRESS = "0.0.7707874";
export const USDC_TOKEN_ID = "0.0.429274";
export const mirrorNode = { name: "hedera-testnet-mirror", baseUrl: "https://testnet.mirrornode.hedera.com/api/v1/" };
export const rpcNode = { name: "hashio-testnet", baseUrl: "https://testnet.hashio.io/api" };

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/ -> ../node_modules
const sdkRoot = join(__dirname, "..", "node_modules/@hashgraph/asset-tokenization-sdk/build/cjs/src");
const req = createRequire(join(sdkRoot, "package.json"));
const internal = (p) => req(join(sdkRoot, p));

export async function decodedRevertReason(err) {
  const message = err instanceof Error ? err.message : String(err);
  const hashMatch = message.match(/"hash":"(0x[0-9a-f]+)"/);
  if (!hashMatch) return null;
  const res = await fetch(`${mirrorNode.baseUrl}contracts/results/${hashMatch[1]}`);
  const data = await res.json();
  return { hash: hashMatch[1], errorMessage: data.error_message, status: data.status };
}

export async function connect() {
  const ACCOUNT_ID = process.env.HEDERA_ACCOUNT_ID;
  const PRIVATE_KEY = process.env.HEDERA_PRIVATE_KEY;
  if (!ACCOUNT_ID || !PRIVATE_KEY) throw new Error("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY must be set.");

  const { default: Injectable } = internal("core/injectable/Injectable.js");
  const { RPCTransactionAdapter } = internal("port/out/rpc/RPCTransactionAdapter.js");
  const { RPCQueryAdapter } = internal("port/out/rpc/RPCQueryAdapter.js");
  const { MirrorNodeAdapter } = internal("port/out/mirror/MirrorNodeAdapter.js");
  const { default: NetworkService } = internal("app/service/network/NetworkService.js");
  const requests = internal("port/in/index.js");
  const { default: ConnectRequest } = internal("port/in/request/network/ConnectRequest.js");
  const { Network, SupportedWallets } = requests;

  Injectable.resolve(MirrorNodeAdapter).set(mirrorNode);
  const transactionHandler = Injectable.resolve(RPCTransactionAdapter);
  const networkService = Injectable.resolve(NetworkService);
  Injectable.resolve(RPCQueryAdapter).init();
  networkService.environment = "testnet";
  networkService.configuration = { factoryAddress: FACTORY_ADDRESS, resolverAddress: RESOLVER_ADDRESS };
  networkService.mirrorNode = mirrorNode;
  networkService.rpcNode = rpcNode;

  await transactionHandler.init(true);
  const provider = new ethers.JsonRpcProvider(rpcNode.baseUrl);
  transactionHandler.setSignerOrProvider(new ethers.Wallet(PRIVATE_KEY, provider));

  await Network.connect(new ConnectRequest({
    account: { accountId: ACCOUNT_ID, privateKey: { key: PRIVATE_KEY, type: "ECDSA" } },
    network: "testnet", wallet: SupportedWallets.METAMASK, mirrorNode, rpcNode, debug: true,
  }));
  Injectable.resolveTransactionHandler();

  return {
    ports: {
      Network, Bond: requests.Bond, Security: requests.Security, Kyc: requests.Kyc,
      Role: requests.Role, SsiManagement: requests.SsiManagement, requests, internal,
    },
    ownEvmAddress: ethers.computeAddress(PRIVATE_KEY),
    provider,
  };
}
```

- [ ] **Step 2: Smoke-test the helper against testnet**

Run: `cd hedera && node --env-file=.env -e "import('./src/hedera-connect.mjs').then(async m => { const c = await m.connect(); console.log('connected as', c.ownEvmAddress); process.exit(0); })"`
Expected: prints `connected as 0x...` (the account the key controls) with no throw.

- [ ] **Step 3: Commit**

```bash
cd /Users/silas/worldmod
git add hedera/src/hedera-connect.mjs
git commit -m "feat(hedera): shared SDK connect helper for new lifecycle scripts"
```

---

### Task 3: Mint licence seats to the KYC'd creator (identity bridge)

**Files:**
- Create: `hedera/src/mint-to-creator.mjs` (core logic, importable)
- Create: `hedera/mint-to-creator.mjs` (human CLI wrapper)
- Uses: `hedera/read-sepolia-dataset.mjs` (existing — reads `creator`), `hedera/src/hedera-connect.mjs`

**Interfaces:**
- Produces: `async mintToCreator({ ports, ownEvmAddress }, { securityId, datasetId, log }) -> { creator, unitsMinted, kycTxId, mintTxId, balanceAfter }`.
- Consumes: `connect()` from Task 2; `SecurityRole` enum via `ports.internal("domain/context/security/SecurityRole.js")`; `KycStatus` via `ports.internal("domain/context/kyc/Kyc.js")`.

**Op sequence (all idempotent-guarded with `Role.hasRole` first, per `set-coupon.mjs`):**
1. Read dataset via `readSepoliaDataset(datasetId)` → `creator`, `numberOfUnits` derived from the Bond mapping (`DEFAULT_MAX_LICENSE_SEATS` = 100; read the Bond's actual `numberOfUnits` via `Bond.getBondDetails` if available, else use 100).
2. Ensure relayer roles on the Bond: `_ISSUER_ROLE` (mint), `_KYC_ROLE`, `_SSI_MANAGER_ROLE`. Grant any missing.
3. `SsiManagement.addIssuer({ securityId, issuerId: ownEvmAddress })` if not already an issuer (wrap in try/catch — re-adding reverts `AlreadyIssuer`; treat as ok).
4. KYC the creator: if `Kyc.getKycStatusFor(creator) !== GRANTED`, self-issue a Terminal3 ECDSA VC for `creator` (copy the VC-creation block from `kyc-exercise.mjs`) and `Kyc.grantKyc({ securityId, targetId: creator, vcBase64 })`.
5. Mint: `Security.issue(new IssueRequest({ securityId, amount: String(numberOfUnits), targetId: creator }))`.
6. Read back: `Bond.getCouponFor` needs a coupon; instead read the balance via the balance port — use `ports.internal("port/in/request/security/GetAccountBalanceRequest...")` if present, otherwise assert via mirror node token balance. Minimal check: re-query `Security` details / holders and assert `creator` appears with balance = `numberOfUnits`.
7. On any revert, print `decodedRevertReason(err)` and rethrow.

> **Spike note (do first, ≤10 min):** confirm the exact `IssueRequest` field names and the balance-read request class by listing `hedera/node_modules/@hashgraph/asset-tokenization-sdk/build/cjs/src/port/in/request/security/operations/` and `.../security/` (dirs confirmed to exist). Use the real class names found there. If `issue` reverts with a KYC error, that confirms step 4 must precede step 5 (expected).

- [ ] **Step 1: Write `src/mint-to-creator.mjs` core**

Implement `mintToCreator(...)` with the sequence above. Pull request classes (`IssueRequest`, `RoleRequest`, `GrantKycRequest`, `GetKycStatusForRequest`, `AddIssuerRequest`) from `ports.requests`. Reuse the VC-creation snippet verbatim from `kyc-exercise.mjs` (lines building `issuerDid`/`holderDid`/`createEcdsaCredential`/`vcBase64`). Log via the injected `log` callback so the CLI and JSON wrappers control output.

- [ ] **Step 2: Write `mint-to-creator.mjs` CLI wrapper**

```javascript
// hedera/mint-to-creator.mjs
// Usage: node --env-file=.env mint-to-creator.mjs <bondEvmAddress> [datasetId=1]
import { connect } from "./src/hedera-connect.mjs";
import { mintToCreator } from "./src/mint-to-creator.mjs";

const securityId = process.argv[2];
const datasetId = Number(process.argv[3] ?? 1);
if (!securityId) throw new Error("Usage: node --env-file=.env mint-to-creator.mjs <bondEvmAddress> [datasetId]");

const conn = await connect();
const out = await mintToCreator(conn, { securityId, datasetId, log: (...a) => console.log(...a) });
console.log("\n=== MINTED TO CREATOR ===");
console.log(out);
```

- [ ] **Step 3: Run against a freshly issued Bond and verify on-chain**

Run:
```bash
cd hedera
# issue a fresh bond to administer (its owner will be this project's account):
node --env-file=.env issue-dataset-bond.mjs 1   # note the printed EVM address
node --env-file=.env mint-to-creator.mjs <thatEvmAddress> 1
```
Expected: prints a grant/KYC/mint sequence ending with `balanceAfter` = the mapped `numberOfUnits` for the creator address, and mirror-node `status: SUCCESS` on the mint tx. Record the tx ids for the README.

- [ ] **Step 4: Commit**

```bash
cd /Users/silas/worldmod
git add hedera/src/mint-to-creator.mjs hedera/mint-to-creator.mjs
git commit -m "feat(hedera): mint licence seats to KYC'd dataset creator (identity bridge)"
```

---

### Task 4: Distribute a coupon in real USDC

**Files:**
- Create: `hedera/src/distribute-coupon.mjs` (core)
- Create: `hedera/distribute-coupon.mjs` (CLI wrapper)
- Uses: `hedera/src/coupon-payout.mjs` (Task 1), `hedera/src/hedera-connect.mjs` (Task 2), `@hiero-ledger/sdk`

**Interfaces:**
- Produces: `async distributeCoupon({ ports, ownEvmAddress }, { securityId, couponId, log }) -> { couponId, ratePercent, nominalValueCents, payouts: [{ holder, unitsHeld, amountUsdcSmallest, associateTxId|null, transferTxId }] }`.
- Consumes: `couponPayoutUsdcSmallest` from Task 1.

**Op sequence:**
1. Read the coupon: `Bond.getCoupon({ securityId, couponId })` → `rate`, `rateDecimals`; `Bond.getBondDetails` → `nominalValue` (cents). Compute `ratePercent = Number(rate) / 10^rateDecimals`.
2. Enumerate holders: `Security` via `GetSecurityHoldersRequest`/`GetTotalSecurityHoldersRequest` (paged). For each holder, `Bond.getCouponFor({ securityId, targetId: holder, couponId })` → `tokenBalance`.
3. For each holder with non-zero balance, `amount = couponPayoutUsdcSmallest({ unitsHeld: tokenBalance, nominalValueCents: nominalValue, ratePercent })`.
4. Pay real USDC via `@hiero-ledger/sdk`:
   - Build a `Client.forTestnet().setOperator(AccountId.fromString(HEDERA_ACCOUNT_ID), PrivateKey.fromStringECDSA(HEDERA_PRIVATE_KEY))`.
   - If the holder is an account we control (i.e. we can sign its association), run `TokenAssociateTransaction` for USDC `0.0.429274`; otherwise attempt the transfer and, on `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`, record `associateTxId: null` and a clear "holder must associate USDC" note (honest caveat, do not crash the whole run).
   - `TransferTransaction().addTokenTransfer(usdc, operator, -amount).addTokenTransfer(usdc, holder, +amount)` → execute → get receipt → record `transferTxId`.
   - Verify each transfer on the mirror node (`GET /transactions/{id}` → `result: SUCCESS`).

> **Spike note (do first, ≤10 min):** confirm `@hiero-ledger/sdk` exports `Client, AccountId, PrivateKey, TokenId, TransferTransaction, TokenAssociateTransaction` and the holder-enumeration request class name under `.../port/in/request/security/`. Adjust names to what's actually exported.

- [ ] **Step 1: Write `src/distribute-coupon.mjs` core** implementing the sequence; import `couponPayoutUsdcSmallest`; use bigint amounts throughout; guard USDC association per the caveat.

- [ ] **Step 2: Write `distribute-coupon.mjs` CLI wrapper**

```javascript
// hedera/distribute-coupon.mjs
// Usage: node --env-file=.env distribute-coupon.mjs <bondEvmAddress> <couponId>
import { connect } from "./src/hedera-connect.mjs";
import { distributeCoupon } from "./src/distribute-coupon.mjs";

const securityId = process.argv[2];
const couponId = process.argv[3];
if (!securityId || !couponId) throw new Error("Usage: node --env-file=.env distribute-coupon.mjs <bondEvmAddress> <couponId>");

const conn = await connect();
const out = await distributeCoupon(conn, { securityId, couponId, log: (...a) => console.log(...a) });
console.log("\n=== COUPON DISTRIBUTED ===");
console.log(JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
```

- [ ] **Step 3: End-to-end run and verify**

Run (against the Bond minted in Task 3):
```bash
cd hedera
node --env-file=.env set-coupon.mjs <bondEvmAddress>          # note the coupon id
node --env-file=.env distribute-coupon.mjs <bondEvmAddress> <couponId>
```
Expected: a non-zero USDC payout to the creator (or the documented "must associate" note), each `transferTxId` mirror-node `SUCCESS`. Record tx ids for the README.

- [ ] **Step 4: Commit**

```bash
cd /Users/silas/worldmod
git add hedera/src/distribute-coupon.mjs hedera/distribute-coupon.mjs
git commit -m "feat(hedera): distribute coupon to holders in real testnet USDC"
```

---

### Task 5: Child-process JSON scripts

**Files:**
- Create: `hedera/scripts/mint-to-creator-json.mjs`
- Create: `hedera/scripts/set-coupon-json.mjs`
- Create: `hedera/scripts/distribute-coupon-json.mjs`
- Pattern: `hedera/scripts/issue-bond-json.mjs` (existing — one JSON line on stdout, everything else stderr)

**Interfaces:**
- Each: reads args, calls the Task 3/4 core (or, for set-coupon, extract the op body from `set-coupon.mjs` into `hedera/src/set-coupon.mjs` exporting `setCoupon(conn, { securityId, log }) -> { couponId, setTxId, rate, period }` and call it), prints exactly `{"ok":true,...}` or `{"ok":false,"error":"..."}` to stdout, all logs to stderr (pass `log: (...a) => console.error(...a)`).

- [ ] **Step 1: Extract `hedera/src/set-coupon.mjs`** — move the coupon-setting body (role check/grant, read starting date, build timestamps, `Bond.setCoupon`, read back) out of `set-coupon.mjs` into an exported `setCoupon(conn, opts)`; update `set-coupon.mjs` CLI to call it (keep its human output). Run `node --env-file=.env set-coupon.mjs <bond>` to confirm parity.

- [ ] **Step 2: Write the three `*-json.mjs`** wrappers. Each mirrors `issue-bond-json.mjs`'s structure: connect via `connect()`, call the core with `log` → stderr, `console.log(JSON.stringify({ ok:true, ...result-with-bigints-as-strings }))`, and a `fail(msg)` that prints `{ok:false,error}` and `process.exit(1)`.

Example (mint):
```javascript
// hedera/scripts/mint-to-creator-json.mjs
import { connect } from "../src/hedera-connect.mjs";
import { mintToCreator } from "../src/mint-to-creator.mjs";
function fail(m){ console.log(JSON.stringify({ ok:false, error:m })); process.exit(1); }
const securityId = process.argv[2]; const datasetId = Number(process.argv[3] ?? 1);
if (!securityId) fail("bondEvmAddress required");
try {
  const conn = await connect();
  const r = await mintToCreator(conn, { securityId, datasetId, log:(...a)=>console.error(...a) });
  console.log(JSON.stringify({ ok:true, ...r, unitsMinted:String(r.unitsMinted), balanceAfter:String(r.balanceAfter) }));
} catch (e) { fail(e instanceof Error ? e.message : String(e)); }
```
(`set-coupon-json.mjs` and `distribute-coupon-json.mjs` follow the same shape.)

- [ ] **Step 3: Verify JSON contract** — run each with a real Bond and confirm the LAST stdout line parses as JSON with `ok:true`:
```bash
cd hedera && node scripts/mint-to-creator-json.mjs <bond> 1 2>/dev/null | tail -1 | node -e "JSON.parse(require('fs').readFileSync(0)); console.log('valid json')"
```

- [ ] **Step 4: Commit**

```bash
cd /Users/silas/worldmod
git add hedera/scripts/mint-to-creator-json.mjs hedera/scripts/set-coupon-json.mjs hedera/scripts/distribute-coupon-json.mjs hedera/src/set-coupon.mjs hedera/set-coupon.mjs
git commit -m "feat(hedera): JSON child-process scripts for mint/set-coupon/distribute"
```

---

### Task 6: Web spawn wrappers

**Files:**
- Create: `web/src/lib/hedera/mint-to-creator.ts`
- Create: `web/src/lib/hedera/set-coupon.ts`
- Create: `web/src/lib/hedera/distribute-coupon.ts`
- Pattern: `web/src/lib/hedera/issue.ts` (existing — `execFile` into the `hedera` package, parse last stdout line)

**Interfaces:**
- `mintToCreator(datasetId: number, securityId: string): Promise<MintResult>`
- `setDatasetCoupon(securityId: string): Promise<CouponResult>`
- `distributeCoupon(securityId: string, couponId: string): Promise<DistributeResult>`
- Reuse `hederaConfigured()` from `issue.ts` (import it; do not redefine).

- [ ] **Step 1: Write the three wrappers** — each `import "server-only"`, `execFile("node", ["scripts/<x>-json.mjs", ...args], { cwd: HEDERA_PACKAGE_ROOT, env: process.env, timeout: 120_000, maxBuffer: 10*1024*1024 })`, parse the last stdout line, throw on `!ok`. Copy `HEDERA_PACKAGE_ROOT` derivation from `issue.ts`. Define the result TS interfaces to match the JSON each script emits.

- [ ] **Step 2: Typecheck** — Run: `cd web && npx tsc --noEmit` (or the project's typecheck script from `package.json`). Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/silas/worldmod
git add web/src/lib/hedera/mint-to-creator.ts web/src/lib/hedera/set-coupon.ts web/src/lib/hedera/distribute-coupon.ts
git commit -m "feat(web): server wrappers spawning hedera mint/coupon scripts"
```

---

### Task 7: API routes

**Files:**
- Create: `web/src/app/api/hedera/mint-to-creator/route.ts`
- Create: `web/src/app/api/hedera/set-coupon/route.ts`
- Create: `web/src/app/api/hedera/distribute-coupon/route.ts`
- Pattern: `web/src/app/api/hedera/issue-bond/route.ts` (existing)

**Interfaces:**
- `POST /api/hedera/mint-to-creator` body `{ datasetId:number, securityId:string }` → `{ mint: MintResult }`.
- `POST /api/hedera/set-coupon` body `{ securityId:string }` → `{ coupon: CouponResult }`.
- `POST /api/hedera/distribute-coupon` body `{ securityId:string, couponId:string }` → `{ distribution: DistributeResult }`.
- All: 501 when `!hederaConfigured()`, 400 on bad body, 500 with `{error, stack}` on failure — copy the shape from `issue-bond/route.ts`.

- [ ] **Step 1: Write the three routes** mirroring `issue-bond/route.ts`, validating each required body field's type and calling the Task 6 wrapper.

- [ ] **Step 2: Verify routes respond** — Start the dev server (or use the running one), then:
```bash
curl -sS -X POST localhost:3000/api/hedera/mint-to-creator -H 'content-type: application/json' -d '{"datasetId":1,"securityId":"<bond>"}' | head -c 400
```
Expected: JSON with `mint` on success, or a clean `{error}` (501 if unconfigured) — not an HTML error page / server crash. Immediately re-check `/c` still returns 200 (confirms no in-process `window` leak): `curl -sS -o /dev/null -w "%{http_code}" localhost:3000/c`.

- [ ] **Step 3: Commit**

```bash
cd /Users/silas/worldmod
git add web/src/app/api/hedera/mint-to-creator/route.ts web/src/app/api/hedera/set-coupon/route.ts web/src/app/api/hedera/distribute-coupon/route.ts
git commit -m "feat(web): API routes for mint-to-creator, set-coupon, distribute-coupon"
```

---

### Task 8: /b/datasets lifecycle UI

**Files:**
- Modify: `web/src/app/(buyer)/b/datasets/issue-bond-button.tsx` (or add a sibling `bond-lifecycle-panel.tsx` and render it from `page.tsx`)
- Read first: `web/src/app/(buyer)/b/datasets/page.tsx`, `issue-bond-button.tsx` to match existing state/fetch patterns.

**Behavior:** after a Bond is issued (component already holds the returned bond `evmAddress`), reveal a small lifecycle panel with three sequential actions, each calling its route and showing the returned HashScan/tx links:
1. **Mint seats to creator** → `POST /api/hedera/mint-to-creator` `{datasetId, securityId}`. Enabled once a bond exists.
2. **Set licence coupon** → `POST /api/hedera/set-coupon` `{securityId}`. Enabled once a bond exists; stores the returned `couponId`.
3. **Distribute coupon (USDC)** → `POST /api/hedera/distribute-coupon` `{securityId, couponId}`. Enabled once a coupon exists. Renders each payout's holder + USDC amount + tx link.

Each button: idle/pending/done/error states like the existing "Issue as Hedera Bond" button; disable while pending; surface `error` text on failure.

- [ ] **Step 1: Read the two existing files** and note the exact state/fetch idiom used by the issue button.

- [ ] **Step 2: Implement the panel** following that idiom; keep copy factual (no fabricated numbers — show only what the routes return).

- [ ] **Step 3: Typecheck + manual click-through** — `cd web && npx tsc --noEmit`; then in the app: issue a bond → mint → set coupon → distribute, confirming each shows a real tx link and no console errors. (If a running dev server / browser node is available on the canvas, use it.)

- [ ] **Step 4: Commit**

```bash
cd /Users/silas/worldmod
git add "web/src/app/(buyer)/b/datasets"
git commit -m "feat(web): full Hedera Bond lifecycle actions on /b/datasets"
```

---

### Task 9: Docs — README T-sections and header note

**Files:**
- Modify: `hedera/README.md` (add T7/T8-style verified sections; renumber to follow existing T6 — call them **T9: Identity bridge (mint to creator)** and **T10: USDC coupon distribution**)
- Modify: `web/src/lib/hedera/dataset-to-bond.ts` header + `hedera/src/dataset-to-bond.mjs` header (the "identity bridge is unbuilt" note now describes what was built: minting to the creator; keep the honest remaining caveat about external-EOA USDC association)

- [ ] **Step 1: Add the two README sections** with the real contract/tx ids recorded in Tasks 3 and 4 (Bond address, mint tx, KYC tx, coupon id, each USDC transfer tx, HashScan links), plus a short "For judges" bullet update and a "Running it" update listing the new scripts and the `/b/datasets` in-app flow. Add the honest USDC-association caveat.

- [ ] **Step 2: Update the `dataset-to-bond` header notes** on both copies to reflect the built identity bridge (creator now holds the units) while keeping the remaining honest caveats (diamond-admin stays with the relayer; external-EOA USDC receipt needs association).

- [ ] **Step 3: Run the full pure test suite** — `cd hedera && node --test src/*.test.mjs`. Expected: all green (existing 13 + Task 1's tests).

- [ ] **Step 4: Commit**

```bash
cd /Users/silas/worldmod
git add hedera/README.md web/src/lib/hedera/dataset-to-bond.ts hedera/src/dataset-to-bond.mjs
git commit -m "docs(hedera): record identity-bridge mint and USDC coupon distribution (T9/T10)"
```

---

## Self-Review

**Spec coverage:**
- Identity bridge (mint to KYC'd creator) → Task 3. ✔
- Real USDC payout → Tasks 1 (math) + 4 (transfer). ✔
- Scripts surface → Tasks 2–5. ✔
- App surface (wrappers, routes, UI) → Tasks 6–8. ✔
- Tests → Task 1 (pure) + runtime mirror-node verification in Tasks 3/4. ✔
- Honest caveats documented → Task 9 (README + headers) + built into Task 4's association handling. ✔
- `set-coupon` app route (needed before distribute) → Tasks 5 (extract + json) / 6 / 7 / 8. ✔

**Placeholder scan:** Two explicit `Spike note` blocks (Tasks 3, 4) confirm exact SDK request-class names before coding — these are bounded verification steps against a confirmed directory, not deferred design. No "TODO/TBD/handle edge cases" placeholders remain.

**Type consistency:** `couponPayoutUsdcSmallest` signature identical in Tasks 1 and 4. `mintToCreator`/`distributeCoupon`/`setCoupon` core signatures match between the `src/` cores (Tasks 3/4/5), the JSON scripts (Task 5), and the web wrappers (Task 6). `hederaConfigured` reused, not redefined (Task 6). Route bodies match wrapper params (Tasks 6/7).

## Notes for the executor

- Other agents (Apollo, Atlas) are editing `web/src/app/(contributor)/c/*` and auth/UI — this plan touches `hedera/**`, `web/src/lib/hedera/**`, `web/src/app/api/hedera/**`, and `web/src/app/(buyer)/b/datasets/**`. Low collision risk, but re-read files before editing.
- Network tasks (3, 4, 5, 7, 8) require `hedera/.env` + `web/.env.local` with a valid, matching `HEDERA_ACCOUNT_ID`/`HEDERA_PRIVATE_KEY` pair (the README documents a prior mismatch bug — verify the key controls the account id before issuing).
- Do not push; commit locally per task.
