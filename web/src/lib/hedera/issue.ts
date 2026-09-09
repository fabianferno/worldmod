import "server-only";

/**
 * The bridge, running from World Mod's own app instead of a script run by
 * hand — but not IN the app's own process.
 *
 * A first version wired the ATS SDK's connection path directly into this
 * module and called it straight from the API route. It worked for exactly
 * one call: the SDK needs a `!!global.window` truthy check satisfied (see
 * hedera/spike-issue-bond.mjs's header for why), and setting one on
 * `globalThis` inside Next.js's own long-lived server process broke server
 * rendering for the *entire app* — React and Next.js check `typeof window`
 * throughout their own internals to decide server-vs-client behaviour, and
 * a fake one satisfies those checks too. `/c` started 500ing a moment later,
 * recovered only by restarting the dev server.
 *
 * The fix is isolation, not a narrower stub: the SDK's global mutation runs
 * in a child process that starts, issues one Bond, and exits — never in the
 * process serving the rest of the app. hedera/scripts/issue-bond-json.mjs is
 * that process; this module only spawns it and parses its one line of JSON.
 */

import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SepoliaDataset } from "./dataset-to-bond";

const run = promisify(execFile);

const HEDERA_PACKAGE_ROOT = join(process.cwd(), "..", "hedera");

export interface IssueBondResult {
  hederaContractId: string;
  evmAddress: string;
  transactionId: string;
  hashscanUrl: string;
}

export function hederaConfigured(): boolean {
  return Boolean(process.env.HEDERA_ACCOUNT_ID && process.env.HEDERA_PRIVATE_KEY);
}

export async function issueDatasetBond(
  dataset: SepoliaDataset,
  datasetRegistryAddress: string,
): Promise<IssueBondResult> {
  if (!hederaConfigured()) {
    throw new Error("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY are not configured.");
  }

  // bigint has no JSON representation; the child process reconstructs it.
  const datasetJson = JSON.stringify({ ...dataset, priceUsdc: dataset.priceUsdc.toString() });

  const { stdout } = await run(
    "node",
    ["scripts/issue-bond-json.mjs", datasetRegistryAddress, datasetJson],
    {
      cwd: HEDERA_PACKAGE_ROOT,
      // Child processes inherit the parent's env by default — this app's own
      // HEDERA_ACCOUNT_ID / HEDERA_PRIVATE_KEY (web/.env.local) pass straight
      // through, so the child needs no .env file of its own to find them.
      env: process.env,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  const lastLine = stdout.trim().split("\n").pop() ?? "";
  const result = JSON.parse(lastLine) as { ok: boolean; error?: string } & Partial<IssueBondResult>;

  if (!result.ok) {
    throw new Error(result.error ?? "Hedera issuance failed with no error message.");
  }
  return result as IssueBondResult;
}
