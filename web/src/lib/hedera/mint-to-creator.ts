import "server-only";

/**
 * Spawns the mint-to-creator flow in the isolated `hedera` child process — the
 * same reason issue.ts does: the ATS SDK's `window` stub is process-wide and
 * would break the Next.js server if run in-process. See hedera/scripts/mint-to-creator-json.mjs.
 */

import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { hederaConfigured } from "./issue";

const run = promisify(execFile);
const HEDERA_PACKAGE_ROOT = join(process.cwd(), "..", "hedera");

export interface MintResult {
  creator: string;
  unitsMinted: string;
  kycTxId: string | null;
  mintTxId: string;
  balanceAfter: string;
}

/** KYC the dataset's creator and mint the Bond's licence seats to them. */
export async function mintToCreator(datasetId: number, securityId: string): Promise<MintResult> {
  if (!hederaConfigured()) {
    throw new Error("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY are not configured.");
  }

  const { stdout } = await run(
    "node",
    ["scripts/mint-to-creator-json.mjs", securityId, String(datasetId)],
    {
      cwd: HEDERA_PACKAGE_ROOT,
      env: process.env,
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  const lastLine = stdout.trim().split("\n").pop() ?? "";
  const result = JSON.parse(lastLine) as { ok: boolean; error?: string } & Partial<MintResult>;
  if (!result.ok) {
    throw new Error(result.error ?? "Hedera mint-to-creator failed with no error message.");
  }
  return result as MintResult;
}
