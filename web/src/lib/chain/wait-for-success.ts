/**
 * `waitForTransactionReceipt` alone does not throw on a reverted transaction
 * — every write in relay.ts/escrow.ts/withdraw-client.ts used to `await` it
 * directly and carry on as if a `status: "reverted"` receipt were success.
 * This makes a revert an actual thrown Error instead.
 */

import type { Hash, PublicClient } from "viem";

export async function waitForSuccess(
  client: Pick<PublicClient, "waitForTransactionReceipt">,
  hash: Hash,
  step: string,
) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`${step} reverted (${hash})`);
  }
  return receipt;
}
