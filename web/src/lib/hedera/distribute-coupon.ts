import "server-only";

/**
 * Spawns the distribute-coupon flow in the isolated `hedera` child process.
 * See hedera/scripts/distribute-coupon-json.mjs.
 *
 * Holders are passed explicitly: the SDK's holder enumeration fails when a
 * holder is an external EOA without a Hedera account. The caller (the API
 * route) supplies the known minted-to holder(s).
 */

import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { hederaConfigured } from "./issue";

const run = promisify(execFile);
const HEDERA_PACKAGE_ROOT = join(process.cwd(), "..", "hedera");

export interface CouponPayout {
  holder: string;
  unitsHeld: string;
  amountUsdcSmallest: string;
  transferTxId: string | null;
  note: string;
}

export interface DistributeResult {
  couponId: string;
  ratePercent: number;
  nominalValueCents: string;
  payouts: CouponPayout[];
}

/** Pay each holder their licence-fee coupon in real testnet USDC. */
export async function distributeCoupon(
  securityId: string,
  couponId: string,
  holders: string[] = [],
): Promise<DistributeResult> {
  if (!hederaConfigured()) {
    throw new Error("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY are not configured.");
  }

  const { stdout } = await run(
    "node",
    ["scripts/distribute-coupon-json.mjs", securityId, couponId, ...holders],
    {
      cwd: HEDERA_PACKAGE_ROOT,
      env: process.env,
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  const lastLine = stdout.trim().split("\n").pop() ?? "";
  const result = JSON.parse(lastLine) as { ok: boolean; error?: string } & Partial<DistributeResult>;
  if (!result.ok) {
    throw new Error(result.error ?? "Hedera distribute-coupon failed with no error message.");
  }
  return result as DistributeResult;
}
