# Hedera: close the identity bridge and coupon-payout gaps

Date: 2026-09-12
Status: approved design, pre-implementation

## Problem

Two honest gaps remain in the World Mod × Hedera ATS integration
(`hedera/README.md`, T1–T6), both stemming from one root cause — **no Bond
units are ever minted to anyone** (`numberOfUnits` is only a supply cap):

1. **Identity bridge unbuilt.** A dataset's `creator` (an EVM EOA) has no
   ownership of the ATS Bond that represents it. `diamondOwnerAccount` is the
   platform relayer, not the creator.
2. **Coupon payout not wired.** `setCoupon` (T5) records a rate, but every
   holder balance is zero, so `getCouponAmountFor` has nothing to pay, and no
   real value ever moves.

Minting units to the creator is the single lever that closes both: it makes
the creator the real economic holder **and** gives the coupon a holder to pay.

## Decisions (from the user)

- **Identity:** mint the Bond's licence seats to the KYC'd creator; the
  relayer keeps compliance/admin roles. Economic ownership = token holding,
  distinct from diamond-admin control.
- **Payout:** real testnet **USDC (HTS `0.0.429274`)** transfer to holders,
  computed from the coupon, verified on the mirror node.
- **Surface:** verified scripts **and** app UI, matching T3's pattern.

## Confirmed against the SDK (`@hashgraph/asset-tokenization-sdk@4.2.0`)

- Mint: `Security.issue(new IssueRequest({ securityId, amount, targetId }))`
  (also `mint` / `batchMint`). Issuing to a holder is expected to be KYC-gated
  because every Bond carries `internalKycActivated: true` — so KYC precedes
  the mint (spike to confirm in T9-1).
- Holder enumeration for the coupon snapshot: `GetSecurityHoldersRequest` /
  `GetTotalSecurityHoldersRequest`.
- KYC path already proven in `kyc-exercise.mjs`: grant `_KYC_ROLE` +
  `_SSI_MANAGER_ROLE`, `SsiManagement.addIssuer`, self-issued Terminal3 ECDSA
  VC, `Kyc.grantKyc`.
- USDC payout: `@hiero-ledger/sdk` `TransferTransaction` (fungible HTS) +
  `TokenAssociateTransaction`, against USDC `0.0.429274`.

## The lifecycle, end to end (visible in the app)

Issue → **Mint to creator** → Set coupon → **Distribute USDC**

### Capability A — `mint-to-creator`

Given a Bond and a dataset id:
1. Connect (raw-key path, identical to existing scripts).
2. Read the dataset live from the registry; take `creator`.
3. Ensure the relayer holds `_ISSUER_ROLE` (for `issue`) and the KYC roles;
   register the relayer as a trusted VC issuer if not already
   (idempotent — check `hasRole` first, as `set-coupon.mjs` does).
4. KYC the creator's EVM address (self-issued VC), if not already `GRANTED`.
5. `Security.issue({ securityId, amount: numberOfUnits, targetId: creator })`.
6. Read the creator's balance back on-chain (non-zero) and mirror-node verify.

Amount = the Bond's `numberOfUnits` (the full licence-seat supply). The creator
holds all seats initially and can later transfer/sell them.

### Capability B — `distribute-coupon`

Given a Bond and a coupon id:
1. Connect; read the coupon (`Bond.getCoupon`) and its holders
   (`GetSecurityHoldersRequest`).
2. For each holder, compute the USDC payout from `coupon-payout.mjs` (pure):
   `amountUsdcSmallest = round(unitsHeld × nominalValueCents × rate% )` scaled
   from cents (2 dp) to USDC (6 dp). Exact formula fixed by a known-value test.
3. Transfer real USDC (HTS `0.0.429274`) from the relayer to each holder via
   `@hiero-ledger/sdk`; associate the holder first when the account is one we
   control. Mirror-node verify each transfer.

### App surface (T3 pattern)

- Three child-process scripts emitting one JSON line on stdout:
  `scripts/mint-to-creator-json.mjs`, `scripts/set-coupon-json.mjs`,
  `scripts/distribute-coupon-json.mjs`.
- Three spawn wrappers in `web/src/lib/hedera/`:
  `mint-to-creator.ts`, `set-coupon.ts`, `distribute-coupon.ts` (mirror
  `issue.ts` — isolate the SDK's `window` stub in a child process).
- Three API routes under `web/src/app/api/hedera/`: `mint-to-creator`,
  `set-coupon`, `distribute-coupon` (mirror `issue-bond/route.ts`, 501 when
  Hedera not configured).
- `/b/datasets`: follow-on action buttons that light up as prerequisites are
  met (a bond exists → Mint; a bond exists → Set coupon; a coupon exists →
  Distribute). `set-coupon` gets an app route because the demo needs it before
  distribution and it is currently script-only.

## Testing

- Pure-logic `hedera/src/coupon-payout.mjs` + `coupon-payout.test.mjs`
  (`node --test`): amount computation incl. a known-value round-trip and
  decimal-scaling edge cases. Written test-first.
- Network scripts self-verify at runtime against the mirror node (existing
  convention), not mocked.

## Honest caveats (documented, not hidden)

- **USDC receipt requires association.** An arbitrary creator EOA may have no
  Hedera account / USDC association. The identity bridge (holding Bond units)
  is real regardless; USDC *receipt* depends on association. Scripts associate
  accounts they control and document the constraint for external EOAs.
- The coupon→amount formula is our defined mapping, not an ATS-native currency
  payout (ATS returns a numerator/denominator fraction over balance).

## Files

New in `hedera/`: `mint-to-creator.mjs`, `distribute-coupon.mjs`,
`src/coupon-payout.mjs` (+ `src/coupon-payout.test.mjs`),
`scripts/{mint-to-creator,set-coupon,distribute-coupon}-json.mjs`.

New in `web/src/`: `lib/hedera/{mint-to-creator,set-coupon,distribute-coupon}.ts`,
`app/api/hedera/{mint-to-creator,set-coupon,distribute-coupon}/route.ts`,
`/b/datasets` UI additions.

Updated: `hedera/README.md` (new verified T-sections with real tx links),
`dataset-to-bond` header notes (identity bridge now built).

## Out of scope

- Selling/transferring individual seats between buyers (secondary market).
- Auto-onboarding external creator EOAs to Hedera (account creation +
  association for arbitrary addresses).
- Flipping the default chain to Hedera (separate migration work).
