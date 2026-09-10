/**
 * `waitForTransactionReceipt` alone does not throw on a reverted transaction
 * — every write in relay.ts/escrow.ts/withdraw-client.ts used to `await` it
 * directly and carry on as if a `status: "reverted"` receipt were success.
 * That was always a latent bug (true on Sepolia too), but Hedera's own
 * empty-revert-data problem (see hedera-mirror.ts) makes silently missing a
 * revert far more likely to go unnoticed than a normal decoded-reason
 * failure would. This makes a revert an actual thrown Error, and enriches
 * it with the mirror node's own decoded reason on Hedera specifically, where
 * the RPC's own error can carry nothing useful.
 */

import type { Hash, PublicClient } from "viem";
import { ACTIVE_CHAIN } from "./config";
import { decodeHederaRevertReason } from "./hedera-mirror";

export async function waitForSuccess(
  client: Pick<PublicClient, "waitForTransactionReceipt">,
  hash: Hash,
  step: string,
) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    let reason = `${step} reverted (${hash})`;
    if (ACTIVE_CHAIN === "hedera") {
      const decoded = await decodeHederaRevertReason(hash);
      if (decoded) reason += `: ${decoded}`;
    }
    throw new Error(reason);
  }
  return receipt;
}
