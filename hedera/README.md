# World Mod × Hedera Asset Tokenization Studio

Working towards Hedera's "Tokenization of Anything" bounty track — see the
task notes this directory doesn't track (`hedera.md`, gitignored, has real
credentials in it) for the full plan. Short version: tokenize licensed
dataset / bounty-receivable cashflows as ATS assets on Hedera testnet,
alongside World Mod's existing Sepolia DePIN loop rather than replacing it.

## Status

**T1 — done, verified, reproducible.** `spike-issue-bond.mjs` issues a real
ATS Bond on Hedera testnet from a plain Node script, signed by a raw account
key — no browser, no MetaMask extension. Three clean runs so far, e.g.:

```
Hedera contract ID: 0.0.10417439
EVM address:        0x2c05b7d46d08fd0de45febdc132ef0c30b9bc1b0
HashScan: https://hashscan.io/testnet/contract/0x2c05b7d46d08fd0de45febdc132ef0c30b9bc1b0
```

Verified independently against the mirror node on every run — `result:
SUCCESS`, `status: 0x1`, `gas_used: ~1.29M` (a real full diamond deployment,
not an early abort), `created_contract_ids` naming the new contract — not
just trusted from the SDK's own return value.

## Running it

```sh
cd hedera && npm install
npm run spike
```

Needs `hedera/.env` with `HEDERA_ACCOUNT_ID`, `HEDERA_PRIVATE_KEY` (raw hex,
ECDSA), `HEDERA_NETWORK=testnet` — gitignored, never commit it.

## What this actually took

None of it is documented by Hedera. `spike-issue-bond.mjs`'s own header has
the full account, but the shape of it:

1. **The published SDK has no raw-key signing path.** Its public API
   (`SupportedWallets`: Metamask, WalletConnect, DFNS, Fireblocks, AWSKMS) is
   browser-wallet or enterprise-custody only. The SDK's own integration tests
   reveal the real mechanism — "Metamask mode" is really "sign via any
   `ethers.Signer`" — by reaching into internals the package's `exports` map
   doesn't expose to a consumer, wiring an `ethers.Wallet(privateKey)`
   directly onto the transaction adapter, and defeating a hard
   `!!global.window` gate with a stub.

2. **The published SDK is the wrong version for the live infrastructure.**
   `@hashgraph/asset-tokenization-sdk@8.0.0` (npm latest) is an explicit
   breaking rewrite — "every resolver key, storage slot... changes...
   greenfield redeploy required." The actual testnet factory
   (`deployed-addresses.md`) is still "Smart Contract Version: 4.0.0", from
   before that rewrite. Calling it with 8.0.0's bindings produces a **mined
   transaction that reverts with zero revert data** — indistinguishable from
   a parameter bug unless you know to suspect a version mismatch. Pinned to
   `4.2.0`, the latest release still on the 4.x line, to match.

3. **The config ID isn't documented anywhere in the SDK's own README.**
   `configId: 0x0...000` isn't a registered configuration on the live
   Business Logic Resolver — a wrong config ID also produces zero revert
   data, because the failure happens inside a nested `CREATE` that neither
   Hashio's relay nor Hedera's own mirror-node simulation surfaces a reason
   for. The real IDs are only named in `apps/ats/web/.env.example`: `...001`
   is Equity, `...002` is Bond.

4. **Even the SDK's own test fixture ISIN is invalid.** `"ABCDE123456Z"`,
   copied verbatim from the SDK's passing integration test, reverts with a
   *decoded* `WrongISINChecksum` on this contract. A textbook ISIN checksum
   produces a different, still-wrong digit — the on-chain algorithm
   (`isinValidator.sol`) has its own bit-level details a generic
   implementation doesn't reproduce. `isinChecksum()` in the spike is a
   direct port of that Solidity, not a library call.

Getting a decoded reason for any of this needed asking Hedera's mirror node
directly (`/contracts/results/{hash}`) — the JSON-RPC relay's own error
response carried nothing.

## Next

- T2: define the asset class — dataset ID / episode-set hash / license terms
  as the Bond's metadata, tying it to World Mod's `DatasetRegistry` on Sepolia.
- T3: issue from World Mod itself (a script or a buyer-side action), not a
  standalone spike.
- T4: KYC / compliance — `internalKycActivated: true` is already set on
  every issued Bond above; nothing has exercised granting or checking it yet.
- T5: a lifecycle op beyond issuance — `setCoupon` is the natural fit for a
  licence-fee distribution.
- T6/T7: HashScan verification, public repo section.
