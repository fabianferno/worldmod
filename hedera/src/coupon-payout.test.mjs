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
