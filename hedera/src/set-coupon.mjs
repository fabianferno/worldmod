/**
 * The coupon-setting core, extracted so both the human CLI (set-coupon.mjs)
 * and the machine child script (scripts/set-coupon-json.mjs) drive one
 * implementation instead of two copies. The behaviour is exactly what
 * set-coupon.mjs proved (T5): grant the corporate-actions role if needed, read
 * the Bond's own starting date, and fix a licence-fee coupon whose timestamps
 * are all strictly in the future when the transaction mines.
 *
 * See set-coupon.mjs's original header for the two bugs this path found:
 * _CORPORATEACTIONS_ROLE is not an owner privilege (must be granted), and
 * every timestamp must still be in the future at mine-time, not build-time.
 */

import { decodedRevertReason } from "./hedera-connect.mjs";

const DAY = 24 * 60 * 60;

/**
 * @param conn `{ ports, ownEvmAddress }` from hedera-connect.mjs `connect()`.
 * @param opts `{ securityId, rate = "5", termDays = 30, log }`.
 * @returns `{ couponId, setTxId, rate, period: { start, end } }`
 */
export async function setCoupon({ ports, ownEvmAddress }, { securityId, rate = "5", termDays = 30, log = () => {} }) {
  const { Bond, Role, requests, internal } = ports;
  const { SetCouponRequest, GetCouponRequest, GetBondDetailsRequest, RoleRequest } = requests;
  const { RateStatus, CastRateStatus } = internal("domain/context/bond/RateStatus.js");
  const { SecurityRole } = internal("domain/context/security/SecurityRole.js");

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

  // _CORPORATEACTIONS_ROLE is a delegable role the diamond owner does not hold
  // automatically; grantRole is not idempotent, so check first.
  const hasRole = await runOp("Checking _CORPORATEACTIONS_ROLE", () =>
    Role.hasRole(new RoleRequest({ securityId, targetId: ownEvmAddress, role: SecurityRole._CORPORATEACTIONS_ROLE })),
  );
  if (!hasRole) {
    await runOp("Granting _CORPORATEACTIONS_ROLE to self", () =>
      Role.grantRole(new RoleRequest({ securityId, targetId: ownEvmAddress, role: SecurityRole._CORPORATEACTIONS_ROLE })),
    );
  }

  const details = await runOp("Reading the Bond's starting date", () =>
    Bond.getBondDetails(new GetBondDetailsRequest({ bondId: securityId })),
  );
  const periodStart = Math.floor(details.startingDate.getTime() / 1000);
  const periodEnd = periodStart + termDays * DAY;

  // Every timestamp must be strictly future at mine-time, not build-time.
  const now = Math.floor(Date.now() / 1000);
  const fixingTimestamp = now + 30;
  const recordTimestamp = now + 60;
  const executionTimestamp = recordTimestamp + 3600;

  const setResult = await runOp("Setting the coupon", () =>
    Bond.setCoupon(
      new SetCouponRequest({
        securityId,
        rate,
        recordTimestamp: recordTimestamp.toString(),
        executionTimestamp: executionTimestamp.toString(),
        startTimestamp: periodStart.toString(),
        endTimestamp: periodEnd.toString(),
        fixingTimestamp: fixingTimestamp.toString(),
        rateStatus: CastRateStatus.toNumber(RateStatus.SET),
      }),
    ),
  );
  const couponId = String(setResult.payload);

  // Read it back from the chain, not from the write's own return value.
  const coupon = await runOp("Reading the coupon back", () =>
    Bond.getCoupon(new GetCouponRequest({ securityId, couponId })),
  );
  log(`Coupon ${couponId} set at ${rate}% (record ${coupon.recordDate?.toISOString?.() ?? "n/a"}).`);

  return { couponId, setTxId: setResult.transactionId, rate, period: { start: periodStart, end: periodEnd } };
}
