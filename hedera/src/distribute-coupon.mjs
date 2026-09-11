/**
 * T5's coupon, paid for real: read a Bond's coupon rate, and for every holder
 * transfer the licence-fee they are owed in real testnet USDC (HTS 0.0.429274)
 * from the relayer. This is the step set-coupon.mjs explicitly did not take —
 * it fixed a rate but moved no value, because no one held a unit and the rate
 * was never turned into a currency amount.
 *
 * The amount math lives in the pure, tested `coupon-payout.mjs`. Units held
 * come from the security's CURRENT balance (`Security.getBalanceOf`), not the
 * on-chain coupon snapshot: `getCouponFor`'s snapshot is only populated after
 * the coupon's recordDate passes, so keying the payout to it would make a
 * demo either wait or silently pay zero. Current-balance is the honest,
 * reproducible basis and the coupon still supplies the rate. (Documented
 * design choice, not an oversight.)
 *
 * Honest caveat, handled rather than hidden: an ATS holder is an EVM address
 * inside the diamond; paying it real USDC needs a Hedera account associated
 * with the USDC token. A holder that is an external EOA (e.g. a Sepolia
 * dataset creator) with no Hedera account cannot receive USDC yet — that
 * holder's payout is computed and reported with a caveat, and the run
 * continues, rather than the whole distribution failing.
 *
 * Holders are passed in explicitly. The SDK's own `getSecurityHolders`
 * enumeration cannot be used here: it resolves every holder's Hedera account
 * info and throws (`10009 ... "" does not have the correct format`) the moment
 * a holder is an external EOA with no Hedera account — precisely the caveat
 * case above. Callers know their holders (the minted-to creator, plus anyone
 * else), so `distributeCoupon` takes the list and only falls back to
 * best-effort enumeration when none is given.
 *
 * NOT IDEMPOTENT: each call issues a fresh USDC transfer per holder computed
 * from their CURRENT balance — there is no per-(coupon, holder) paid-guard, so
 * running it twice for the same coupon pays every holder twice. This is a
 * manual, demo-grade payout step; do not re-run it for a coupon already
 * distributed. Making it a safe repeatable primitive (record and check prior
 * payments, or consume the coupon's snapshot) is deliberately left as
 * follow-up.
 */

import {
  Client,
  AccountId,
  PrivateKey,
  TokenId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { couponPayoutUsdcSmallest } from "./coupon-payout.mjs";
import { decodedRevertReason, USDC_TOKEN_ID, mirrorNode } from "./hedera-connect.mjs";

/** Resolve an ATS holder identifier (EVM address or 0.0.x) to a Hedera
 * AccountId via the mirror node, or null if no Hedera account exists for it. */
async function resolveHederaAccount(holder) {
  const res = await fetch(`${mirrorNode.baseUrl}accounts/${holder}`);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data || !data.account) return null;
  return AccountId.fromString(data.account);
}

function holderId(h) {
  if (typeof h === "string") return h;
  return h?.value ?? h?.id ?? String(h);
}

/**
 * @param conn `{ ports }` from hedera-connect.mjs `connect()`.
 * @param opts `{ securityId, couponId, holders?, log }` — `holders` is the
 *   explicit list of holder addresses (EVM or 0.0.x) to pay; when omitted a
 *   best-effort SDK enumeration is attempted and a clear error is thrown if it
 *   fails (a holder with no Hedera account breaks it).
 * @returns `{ couponId, ratePercent, nominalValueCents, payouts: [...] }`
 *   where each payout is `{ holder, unitsHeld, amountUsdcSmallest, transferTxId, note }`.
 */
export async function distributeCoupon({ ports }, { securityId, couponId, holders: explicitHolders, log = () => {} }) {
  const { Bond, Security, requests } = ports;
  const { GetCouponRequest, GetBondDetailsRequest, GetAccountBalanceRequest, GetSecurityHoldersRequest, GetTotalSecurityHoldersRequest } = requests;

  const ACCOUNT_ID = process.env.HEDERA_ACCOUNT_ID;
  const PRIVATE_KEY = process.env.HEDERA_PRIVATE_KEY;

  async function runOp(label, fn) {
    log(`${label}...`);
    try {
      return await fn();
    } catch (err) {
      const reason = await decodedRevertReason(err).catch(() => null);
      if (reason) log("Decoded revert:", JSON.stringify(reason));
      throw err;
    }
  }

  // 1. Coupon rate + Bond nominal (cents).
  const coupon = await runOp("Reading coupon", () =>
    Bond.getCoupon(new GetCouponRequest({ securityId, couponId })),
  );
  const ratePercent = Number(coupon.rate) / 10 ** Number(coupon.rateDecimals ?? 0);
  const details = await runOp("Reading Bond details (nominal)", () =>
    Bond.getBondDetails(new GetBondDetailsRequest({ bondId: securityId })),
  );
  const nominalValueCents = BigInt(details.nominalValue);
  log(`Coupon ${couponId}: rate ${ratePercent}% of nominal ${nominalValueCents} cents/unit.`);

  // 2. Determine holders. Prefer the explicit list; fall back to SDK
  // enumeration only when none was given (it throws if any holder is an
  // external EOA without a Hedera account — the documented caveat case).
  let holders;
  if (explicitHolders && explicitHolders.length) {
    holders = explicitHolders.map(holderId);
  } else {
    try {
      const total = Number(
        await runOp("Reading total holders", () =>
          Security.getTotalSecurityHolders(new GetTotalSecurityHoldersRequest({ securityId })),
        ),
      );
      const rawHolders = total > 0
        ? await runOp(`Reading ${total} holders`, () =>
            Security.getSecurityHolders(new GetSecurityHoldersRequest({ securityId, start: 0, end: total })),
          )
        : [];
      holders = rawHolders.map(holderId);
    } catch (err) {
      throw new Error(
        "Could not enumerate holders via the SDK (a holder likely has no Hedera account, which breaks getSecurityHolders). " +
          "Pass the holder addresses explicitly. Underlying: " +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }
  log(`Holders: ${holders.length ? holders.join(", ") : "(none)"}`);

  // 3. Pay each holder their USDC.
  const client = Client.forTestnet().setOperator(
    AccountId.fromString(ACCOUNT_ID),
    PrivateKey.fromStringECDSA(PRIVATE_KEY),
  );
  const operatorAccountId = AccountId.fromString(ACCOUNT_ID);
  const usdc = TokenId.fromString(USDC_TOKEN_ID);
  const payouts = [];

  try {
    for (const holder of holders) {
      const balRes = await runOp(`Reading ${holder} balance`, () =>
        Security.getBalanceOf(new GetAccountBalanceRequest({ securityId, targetId: holder })),
      );
      const unitsHeld = balRes.value;
      const amount = couponPayoutUsdcSmallest({ unitsHeld, nominalValueCents, ratePercent });
      const base = { holder, unitsHeld: String(unitsHeld), amountUsdcSmallest: amount.toString() };

      if (amount <= 0n) {
        log(`  ${holder}: 0 units → nothing to pay.`);
        payouts.push({ ...base, transferTxId: null, note: "zero payout" });
        continue;
      }

      const hederaAccount = await resolveHederaAccount(holder);
      if (!hederaAccount) {
        log(`  ${holder}: owed ${amount} USDC smallest but has no Hedera account — needs onboarding + USDC association.`);
        payouts.push({ ...base, transferTxId: null, note: "no Hedera account; holder must onboard and associate USDC" });
        continue;
      }

      try {
        const resp = await new TransferTransaction()
          .addTokenTransfer(usdc, operatorAccountId, -Number(amount))
          .addTokenTransfer(usdc, hederaAccount, Number(amount))
          .execute(client);
        const receipt = await resp.getReceipt(client);
        const transferTxId = resp.transactionId.toString();
        log(`  ${holder}: paid ${amount} USDC smallest, tx ${transferTxId} (${receipt.status.toString()})`);
        payouts.push({ ...base, transferTxId, note: receipt.status.toString() });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // A holder can have a Hedera account yet not have associated the USDC
        // token. We cannot associate on their behalf (we don't hold their key),
        // so this is the same "holder must act" caveat as the no-account case —
        // surfaced specifically rather than as a generic failure.
        const note = /TOKEN_NOT_ASSOCIATED/i.test(msg)
          ? "holder has not associated USDC; they must associate the token to receive it"
          : `transfer failed: ${msg}`;
        log(`  ${holder}: ${note}`);
        payouts.push({ ...base, transferTxId: null, note });
      }
    }
  } finally {
    client.close();
  }

  return {
    couponId,
    ratePercent,
    nominalValueCents: nominalValueCents.toString(),
    payouts,
  };
}
