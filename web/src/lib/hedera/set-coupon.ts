import "server-only";

/**
 * Spawns the set-coupon flow in the isolated `hedera` child process.
 * See hedera/scripts/set-coupon-json.mjs.
 */

import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { hederaConfigured } from "./issue";

const run = promisify(execFile);
const HEDERA_PACKAGE_ROOT = join(process.cwd(), "..", "hedera");

export interface CouponResult {
  couponId: string;
  setTxId: string;
  rate: string;
  period: { start: number; end: number };
}

/** Fix a licence-fee coupon on the Bond and read it back. */
export async function setDatasetCoupon(securityId: string): Promise<CouponResult> {
  if (!hederaConfigured()) {
    throw new Error("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY are not configured.");
  }

  const { stdout } = await run("node", ["scripts/set-coupon-json.mjs", securityId], {
    cwd: HEDERA_PACKAGE_ROOT,
    env: process.env,
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  const lastLine = stdout.trim().split("\n").pop() ?? "";
  const result = JSON.parse(lastLine) as { ok: boolean; error?: string } & Partial<CouponResult>;
  if (!result.ok) {
    throw new Error(result.error ?? "Hedera set-coupon failed with no error message.");
  }
  return result as CouponResult;
}
