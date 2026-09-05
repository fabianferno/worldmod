"use client";

/**
 * The contributor collecting their own USDC.
 *
 * Sent from the device key, not by the relayer. The escrow credits a balance
 * and the holder pulls it — so the transaction that moves money to a
 * contributor is signed by the contributor, and nobody else can redirect it.
 * The relayer's only part is having sent the gas dust that makes the call
 * possible at all, which is §3's "no gas prompt" kept honest rather than
 * quietly dropped.
 */

import { createPublicClient, createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";
import { bountyEscrowAbi } from "./abi";
import { ADDRESSES } from "./config";
import { deviceAccount } from "./identity";

const RPC = "https://ethereum-sepolia-rpc.publicnode.com";

function clients() {
  const account = deviceAccount();
  return {
    account,
    publicClient: createPublicClient({ chain: sepolia, transport: http(RPC) }),
    walletClient: createWalletClient({ account, chain: sepolia, transport: http(RPC) }),
  };
}

/** What the escrow owes this device, in USDC. */
export async function pendingWithdrawal(): Promise<number> {
  try {
    const { account, publicClient } = clients();
    const credited = (await publicClient.readContract({
      address: ADDRESSES.bountyEscrow,
      abi: bountyEscrowAbi,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;
    return Number(credited) / 1e6;
  } catch {
    // An unreachable RPC means "unknown", and the button stays hidden rather
    // than claiming a balance of zero.
    return 0;
  }
}

export interface WithdrawResult {
  ok: boolean;
  hash?: string;
  error?: string;
}

export async function withdrawEarnings(): Promise<WithdrawResult> {
  try {
    const { account, publicClient, walletClient } = clients();

    const gas = await publicClient.getBalance({ address: account.address });
    if (gas === BigInt(0)) {
      return {
        ok: false,
        error: "No gas yet. It arrives with your first accepted episode.",
      };
    }

    const hash = await walletClient.writeContract({
      address: ADDRESSES.bountyEscrow,
      abi: bountyEscrowAbi,
      functionName: "withdraw",
      args: [],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    return { ok: true, hash };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
