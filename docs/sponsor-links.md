# Where each sponsor's technology lives in this repo

One page for judges. Each section lists the exact files and lines where the
integration happens, plus the on-chain state that proves it ran.

## Chainlink

CRE Confidential Workflows replace the single EOA that used to act as both
validator and utility oracle. Full write-up: [`cre/README.md`](../cre/README.md).

| What | Where |
|---|---|
| `cre.handlerInTee` registration (episode validator) | [`cre/episode-validator/workflow.ts#L174`](../cre/episode-validator/workflow.ts#L174) |
| `runtime.getSecrets` fetched inside the enclave | [`cre/episode-validator/workflow.ts#L92`](../cre/episode-validator/workflow.ts#L92) |
| In-enclave comparison, pass/fail decision | [`cre/episode-validator/workflow.ts#L100-L145`](../cre/episode-validator/workflow.ts#L100-L145) |
| `donRuntime.report` + `evmClient.writeReport` on a pass | [`cre/episode-validator/workflow.ts#L146`](../cre/episode-validator/workflow.ts#L146) |
| Second workflow: utility settlement with a secret weighting policy | [`cre/utility-oracle/workflow.ts#L159`](../cre/utility-oracle/workflow.ts#L159) |
| On-chain receiver, forwarder-gated `onReport` → `EpisodeRegistry.recordValidation` | [`contracts/src/ChainlinkValidatorConsumer.sol#L83`](../contracts/src/ChainlinkValidatorConsumer.sol#L83) |
| On-chain receiver, `onReport` → `BountyEscrow.settleUtility` | [`contracts/src/ChainlinkUtilityOracleConsumer.sol#L82`](../contracts/src/ChainlinkUtilityOracleConsumer.sol#L82) |
| Deploy scripts | [`contracts/script/DeployChainlinkValidatorConsumer.s.sol`](../contracts/script/DeployChainlinkValidatorConsumer.s.sol), [`contracts/script/DeployChainlinkUtilityOracleConsumer.s.sol`](../contracts/script/DeployChainlinkUtilityOracleConsumer.s.sol) |
| Unit tests (10/10, including "no secret ever appears in a log line") | [`cre/episode-validator/`](../cre/episode-validator/) — `bun test` |
| Simulation output, real run | [`cre/README.md`](../cre/README.md#real-output-this-was-actually-run-not-fabricated) |

On-chain (Ethereum Sepolia):

- `ChainlinkValidatorConsumer`: [`0xe0ca68241159A635Bc383f79c7095dC09d9C3dde`](https://sepolia.etherscan.io/address/0xe0ca68241159A635Bc383f79c7095dC09d9C3dde), registered as an `EpisodeRegistry` validator
- `ChainlinkUtilityOracleConsumer`: [`0x47Ad260F6930392Df5109F3293500e8026b71f90`](https://sepolia.etherscan.io/address/0x47Ad260F6930392Df5109F3293500e8026b71f90), now `BountyEscrow`'s registered oracle
- Production `KeystoneForwarder` trusted by both: [`0xF8344CFd5c43616a4366C34E3EEE75af79a74482`](https://sepolia.etherscan.io/address/0xF8344CFd5c43616a4366C34E3EEE75af79a74482)
- All addresses and notes: [`contracts/deployments.json`](../contracts/deployments.json)

## Hedera

Two things. The core DePIN contracts are deployed on Hedera testnet, and a
licensed dataset is tokenised as an Asset Tokenization Studio (ATS) Bond.
Full write-up: [`hedera/README.md`](../hedera/README.md).

| What | Where |
|---|---|
| `Bond.create` against a real dataset read live from `DatasetRegistry` | [`hedera/issue-dataset-bond.mjs#L112`](../hedera/issue-dataset-bond.mjs#L112) |
| Dataset → Bond mapping (asset class definition, tested) | [`hedera/src/dataset-to-bond.mjs`](../hedera/src/dataset-to-bond.mjs) |
| KYC grant with a real Verifiable Credential, then mint licence seats to the creator | [`hedera/src/mint-to-creator.mjs#L118`](../hedera/src/mint-to-creator.mjs#L118) |
| Coupon set on the Bond | [`hedera/src/set-coupon.mjs`](../hedera/src/set-coupon.mjs) |
| Coupon paid out in real HTS USDC | [`hedera/src/distribute-coupon.mjs`](../hedera/src/distribute-coupon.mjs) |
| App-side issuance (buyer clicks "Issue as Hedera Bond") | [`web/src/lib/hedera/issue.ts`](../web/src/lib/hedera/issue.ts) and [`web/src/app/api/hedera/`](../web/src/app/api/hedera/) |
| Core contracts self-associating with USDC via the HTS precompile | [`contracts/src/BountyEscrow.sol`](../contracts/src/BountyEscrow.sol), deployed via [`contracts/script/deploy-hedera.mjs`](../contracts/script/deploy-hedera.mjs) |
| Sourcify verification tooling for the ATS `ResolverProxy` | [`hedera/verify-contract.mjs`](../hedera/verify-contract.mjs) |

On-chain (Hedera testnet, chain 296):

- Verified ATS Bond: [HashScan `0x3cb31106…`](https://hashscan.io/testnet/contract/0x3cb31106a89e77e582b6a9ad08f9829399cef271), [Sourcify](https://repo.sourcify.dev/296/0x3cb31106a89e77e582b6a9ad08f9829399cef271/)
- KYC grant tx: [`0x95c8f03c…`](https://hashscan.io/testnet/transaction/0x95c8f03cacdfb3145977a564db36a329a7c31cdd0521b47ff5f4e031501a4ae3)
- Coupon set tx: [`0x3c87b5a7…`](https://hashscan.io/testnet/transaction/0x3c87b5a7dec48a9dd8af95514dbdb63a9e9f849c0cfb9c2535574e52af2f7d83)
- USDC coupon payout: [`0.0.7290316@1789228282.954601437`](https://hashscan.io/testnet/transaction/0.0.7290316-1789228282-954601437)
- Core DePIN contracts on Hedera testnet: [`contracts/deployments.json`](../contracts/deployments.json) under `"296"`

## World

World Mod is a MiniKit mini app. World App wallet auth is the contributor's
recoverable identity, and a Selfie Check is a hard gate before their first
recording. Full write-up: [`world/README.md`](../world/README.md).
Sponsor feedback document: [`world/FEEDBACK.md`](../world/FEEDBACK.md).

| What | Where |
|---|---|
| Selfie Check hard gate before the first recording | [`web/src/app/(contributor)/c/capture-client.tsx#L902`](<../web/src/app/(contributor)/c/capture-client.tsx#L902>) |
| `IDKitRequestWidget` with the `selfieCheckLegacy` preset | [`web/src/app/(contributor)/c/account/selfie-check.tsx#L146`](<../web/src/app/(contributor)/c/account/selfie-check.tsx#L146>) |
| Server-side verification against World's production `v4/verify` API | [`web/src/app/api/world/verify/route.ts#L41`](../web/src/app/api/world/verify/route.ts#L41) |
| RP context signed with `@worldcoin/idkit-server` | [`web/src/lib/world/rp-context.ts#L32`](../web/src/lib/world/rp-context.ts#L32) |
| `MiniKit.walletAuth` | [`web/src/lib/chain/signer-context.tsx#L116`](../web/src/lib/chain/signer-context.tsx#L116) |
| `MiniKit.signTypedData` for the EIP-712 submissions the relayer anchors | [`web/src/lib/chain/signer.ts#L84`](../web/src/lib/chain/signer.ts#L84) |
| MiniKit provider wrapping the app | [`web/src/app/minikit-client-provider.tsx`](../web/src/app/minikit-client-provider.tsx) |
| Verification store (a real record with `mock: false` exists) | [`web/src/lib/world/verification-store.ts`](../web/src/lib/world/verification-store.ts) |

Feedback document, mapped to the qualification list:

- SelfieCheck docs and integration flow: [`world/FEEDBACK.md#selfie-check-docs-and-integration-flow`](../world/FEEDBACK.md#selfie-check-docs-and-integration-flow)
- Developer Portal navigation, search, product discovery, debugging: [`world/FEEDBACK.md#developer-portal-navigation-search-product-discovery-debugging`](../world/FEEDBACK.md#developer-portal-navigation-search-product-discovery-debugging)
- Sandbox App states, proof flows, test users, errors, edge cases: [`world/FEEDBACK.md#sandbox-app-states-proof-flows-test-users-errors-edge-cases`](../world/FEEDBACK.md#sandbox-app-states-proof-flows-test-users-errors-edge-cases)
- What was confusing, missing, broken, or hard to test: [`world/FEEDBACK.md#what-was-confusing-missing-broken-or-hard-to-test`](../world/FEEDBACK.md#what-was-confusing-missing-broken-or-hard-to-test)
