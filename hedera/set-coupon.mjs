/**
 * T5: a lifecycle op beyond issuance — set a licence-fee coupon on a real Bond
 * and read it back. The coupon-setting logic now lives in src/set-coupon.mjs so
 * this CLI and scripts/set-coupon-json.mjs share one implementation; this file
 * is the human-facing driver.
 *
 *     node --env-file=.env set-coupon.mjs <bondEvmAddress>
 *
 * Note: setCoupon fixes a rate and a payout window on-chain; distribute-coupon.mjs
 * is what turns that rate into a real USDC transfer to the Bond's holders.
 */

import { connect } from "./src/hedera-connect.mjs";
import { setCoupon } from "./src/set-coupon.mjs";

const securityId = process.argv[2];
if (!securityId) {
  throw new Error(
    "Usage: node --env-file=.env set-coupon.mjs <bondEvmAddress>\n" +
      "  e.g. a Bond issued by issue-dataset-bond.mjs or the app's /b/datasets page.",
  );
}

const conn = await connect();
console.log("Connected as", conn.ownEvmAddress);
console.log("Bond:", securityId);

const out = await setCoupon(conn, { securityId, log: (...a) => console.log(...a) });

console.log("\n=== COUPON SET ===");
console.log("couponId:", out.couponId);
console.log("setTx:   ", out.setTxId);
console.log("rate:    ", `${out.rate}%`);
console.log(
  "period:  ",
  new Date(out.period.start * 1000).toISOString(),
  "→",
  new Date(out.period.end * 1000).toISOString(),
);
