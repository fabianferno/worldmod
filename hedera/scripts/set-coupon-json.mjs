/**
 * Machine-consumable set-coupon: one line of JSON on stdout, logs to stderr.
 * Spawned by web/src/lib/hedera/set-coupon.ts.
 *
 *     node scripts/set-coupon-json.mjs <bondEvmAddress>
 */
import { connect } from "../src/hedera-connect.mjs";
import { setCoupon } from "../src/set-coupon.mjs";

function fail(message) {
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

const securityId = process.argv[2];
if (!securityId) fail("bondEvmAddress (argv[2]) is required.");

try {
  const conn = await connect();
  const r = await setCoupon(conn, { securityId, log: (...a) => console.error(...a) });
  console.log(JSON.stringify({ ok: true, ...r }));
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
