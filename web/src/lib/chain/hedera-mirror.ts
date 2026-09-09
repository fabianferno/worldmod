/**
 * Decodes a failed Hedera transaction's real reason via the mirror node.
 *
 * Hashio (Hedera's JSON-RPC relay) can return EMPTY revert data on a failed
 * call — confirmed for both the Hedera SDK path (hedera/spike-issue-bond.mjs's
 * header) and plain viem writes (hedera/spike-viem-write.mjs, run before this
 * migration touched a single real contract): a reverted transaction's own
 * RPC error can carry nothing more specific than "CONTRACT_REVERT_EXECUTED".
 * The mirror node's REST API carries the decoded reason when one exists,
 * independently of what the RPC call itself returned — the same recovery
 * this project has used throughout its Hedera work
 * (kyc-exercise.mjs/set-coupon.mjs/spike-issue-bond.mjs all do this).
 *
 * A plain fetch to a public, unauthenticated endpoint — safe to call from
 * client or server code.
 */
export async function decodeHederaRevertReason(hash: string): Promise<string | null> {
  try {
    const res = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${hash}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { error_message?: string | null };
    return data.error_message ?? null;
  } catch {
    return null;
  }
}
