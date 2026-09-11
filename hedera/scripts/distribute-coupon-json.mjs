/**
 * Machine-consumable distribute-coupon: one line of JSON on stdout, logs to
 * stderr. Spawned by web/src/lib/hedera/distribute-coupon.ts.
 *
 * Holders are passed explicitly (argv[4..]) — SDK holder-enumeration fails when
 * a holder is an external EOA without a Hedera account (see distribute-coupon.mjs).
 *
 *     node scripts/distribute-coupon-json.mjs <bondEvmAddress> <couponId> <holder> [holder ...]
 */
import { connect } from "../src/hedera-connect.mjs";
import { distributeCoupon } from "../src/distribute-coupon.mjs";

function fail(message) {
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

const securityId = process.argv[2];
const couponId = process.argv[3];
const holders = process.argv.slice(4);
if (!securityId || !couponId) fail("bondEvmAddress (argv[2]) and couponId (argv[3]) are required.");

try {
  const conn = await connect();
  const r = await distributeCoupon(conn, {
    securityId,
    couponId,
    holders: holders.length ? holders : undefined,
    log: (...a) => console.error(...a),
  });
  console.log(JSON.stringify({ ok: true, ...r }));
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
