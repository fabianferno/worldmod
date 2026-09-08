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

**T2 — done, verified, bridges both chains for real.** `src/dataset-to-bond.mjs`
is the asset-class definition: a World Mod dataset licence, expressed as an
ATS Bond. `issue-dataset-bond.mjs` reads a real `DatasetRegistry.Dataset` live
off Ethereum Sepolia and issues it on Hedera testnet — not two scripts that
happen to use similar numbers, one program that reads one chain and writes
the other:

```
Sepolia dataset  #1  0x1df8feDf50394A9e0f78cb0EF8F187D587812cbB  (6 episodes, $6.00, commercial_ai_training)
Hedera bond          0x5220521e6048c849460d1a32b120897ca74d25a7
HashScan: https://hashscan.io/testnet/contract/0x5220521e6048c849460d1a32b120897ca74d25a7
```

The dataset itself is real, not a fixture — minted on Sepolia from six
episodes already validated by World Mod's own flow-vs-gyro plausibility
check (`EpisodeRegistry`, ids 1–6, all `recorded: true`). Its metadata is
pinned to IPFS (`ipfs://bafkreihusmtjgfjz4xrjrfwsfujz5cf6krtenchrftetuz3rzhsfsw4oyy`)
and referenced from both chains: Sepolia's own `metadataURI` field, and the
Hedera Bond's `info` field, which also names the Sepolia registry address,
dataset id, episode count, licence type and `episodesRoot` — a Bond holder
can verify what they hold traces to a specific, inspectable bundle without
trusting this script's word for it.

13 tests, `node --test src/*.test.mjs` — including one against the *known
checksum digit a real transaction confirmed on-chain*, and a completeness
check added after a real run failed client-side validation for a field the
mapping had silently omitted (`regulationType`/`regulationSubType`) — caught
before any gas was spent, not after.

**What T2 does not solve, on purpose stated rather than hidden:** a Sepolia
dataset's `creator` is an Ethereum EOA. Hedera has no native equivalent, so
`diamondOwnerAccount` is the issuing Hedera account passed in — currently
this project's own relayer account — not a derivation from the real creator.
Whoever owns the Sepolia dataset does not yet own the Hedera Bond that
represents it. That identity bridge is unbuilt.

## Running it

```sh
cd hedera && npm install
npm run spike                       # T1: a standalone Bond, proves the SDK path works at all
node --env-file=.env issue-dataset-bond.mjs <datasetId>   # T2: issue against a real Sepolia dataset
node --test src/*.test.mjs          # the pure mapping and checksum logic, no network needed
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

## Design decisions T2 made, and why

**A Bond, not an Equity.** A dataset licence is closer to a receivable with a
term than to a share of an enterprise — no voting rights, no dividends in the
ATS sense, just "pays for access, expires." `setCoupon` (T5) is a licence-fee
distribution; Equity's machinery has nothing to attach to here.

**`numberOfUnits` is a Hedera-side cap, decoupled from Sepolia's actual count.**
`purchaseLicense` on Sepolia has no limit — any number of buyers can each
independently license the same dataset. ATS fixes `numberOfUnits` at
issuance. The two cannot literally mirror each other; the mapping picks a
generous, documented ceiling (100 seats) rather than pretending they match.

**`startingDate` is issuance time, not `mintedAt`.** `onlyValidBondDates`
requires the starting date to be at or after the current block time,
and `mintedAt` is a real past timestamp the moment this script runs. The
Sepolia dataset's true mint time still lives in its own `mintedAt` field
and in the pinned metadata; the Bond's starting date is honestly "when this
licence instrument went live," which is later.

**The licence term (1 year) is asserted, not researched.** Sepolia's licence,
once purchased, never expires. Hedera's does, because ATS Bonds need a
maturity date. A year is `DEFAULT_LICENSE_TERM_SECONDS`, overridable, and not
a number anyone has validated against how these deals actually get priced.

## Next

- T3: issue from World Mod's own app (a buyer-side action calling this
  mapping), not a standalone script invoked by hand.
- T4: KYC / compliance — `internalKycActivated: true` is set on every Bond
  above; nothing has exercised granting or checking it against a real second
  account yet.
- T5: a lifecycle op beyond issuance — `setCoupon`, the licence-fee
  distribution `numberOfUnits`'s design note above sets up.
- T6/T7: HashScan verification, public repo section.
- The identity bridge (Sepolia creator → Hedera issuing account) named above
  and left open.
