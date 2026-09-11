// Usage: node --env-file=.env distribute-coupon.mjs <bondEvmAddress> <couponId> [holder ...]
// Pass holder addresses explicitly (recommended): SDK holder-enumeration fails
// when any holder is an external EOA without a Hedera account.
import { connect } from "./src/hedera-connect.mjs";
import { distributeCoupon } from "./src/distribute-coupon.mjs";

const securityId = process.argv[2];
const couponId = process.argv[3];
const holders = process.argv.slice(4);
if (!securityId || !couponId) throw new Error("Usage: node --env-file=.env distribute-coupon.mjs <bondEvmAddress> <couponId> [holder ...]");

const conn = await connect();
const out = await distributeCoupon(conn, { securityId, couponId, holders: holders.length ? holders : undefined, log: (...a) => console.log(...a) });
console.log("\n=== COUPON DISTRIBUTED ===");
console.log(JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
