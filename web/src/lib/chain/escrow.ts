import "server-only";

/**
 * Moving actual USDC.
 *
 * product-spec §13 is USDC from day one and no token, and demo scene 4 turns
 * on a contributor watching it arrive. Everything here is real Circle USDC on
 * Ethereum Sepolia — no mock, no token we minted, because settling in a token
 * we control would make every payment in the demo meaningless.
 *
 * The relayer is the buyer here. In a real deployment they are different
 * parties with different keys; in the MVP one key funds bounties, pays gas and
 * validates, and pretending otherwise would be theatre. §8.3 already says the
 * oracle is centralized for the same reason.
 *
 * Every function is best-effort and reports what happened. The marketplace's
 * own ledger stays the source of truth for whether an episode was accepted —
 * a chain that is briefly unreachable must not turn an accepted episode into
 * a rejected one.
 */

import { keccak256, parseUnits, toHex, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { bountyEscrowAbi, erc20Abi } from "./abi";
import { ADDRESSES, CHAIN, RPC_URL, relayerKey } from "./config";
import { publicClient } from "./relay";
import { waitForSuccess } from "./wait-for-success";

/** USDC has six decimals. Money is integers here, never floats. */
export function toUsdc(amount: number): bigint {
  return parseUnits(amount.toFixed(6), 6);
}

export function fromUsdc(amount: bigint): number {
  return Number(amount) / 1e6;
}

/** The marketplace's string ids are hashed to the bytes32 the contract uses. */
export function bountyKey(bountyId: string): `0x${string}` {
  return keccak256(toHex(bountyId));
}

function wallet() {
  const key = relayerKey();
  if (!key) return null;
  return createWalletClient({
    account: privateKeyToAccount(key),
    chain: CHAIN,
    transport: http(RPC_URL),
  });
}

export function relayerAddress(): `0x${string}` | null {
  const key = relayerKey();
  return key ? privateKeyToAccount(key).address : null;
}

export interface ChainResult {
  ok: boolean;
  txs: { step: string; hash: Hash }[];
  error?: string;
}

export async function usdcBalance(account: `0x${string}`): Promise<bigint> {
  return (await publicClient.readContract({
    address: ADDRESSES.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  })) as bigint;
}

/** What the escrow currently owes an address, before they withdraw it. */
export async function credited(account: `0x${string}`): Promise<bigint> {
  return (await publicClient.readContract({
    address: ADDRESSES.bountyEscrow,
    abi: bountyEscrowAbi,
    functionName: "balanceOf",
    args: [account],
  })) as bigint;
}

export async function bountyExists(bountyId: string): Promise<boolean> {
  try {
    const bounty = (await publicClient.readContract({
      address: ADDRESSES.bountyEscrow,
      abi: bountyEscrowAbi,
      functionName: "getBounty",
      args: [bountyKey(bountyId)],
    })) as { buyer: `0x${string}` };
    return bounty.buyer !== "0x0000000000000000000000000000000000000000";
  } catch {
    // getBounty reverts with UnknownBounty rather than returning an empty
    // struct, so a revert here is the answer, not a failure.
    return false;
  }
}

export interface BountyTerms {
  bountyId: string;
  budgetUsdc: number;
  perEpisodeUsdc: number;
  maxEpisodes: number;
  utilityPoolUsdc: number;
  validatorFeeUsdc: number;
  treasuryFeeUsdc: number;
  deadline: number;
}

/**
 * Escrow a bounty's whole budget on-chain.
 *
 * Approve first, then create. The allowance is set to exactly the budget
 * rather than the unlimited amount that is conventional: this key holds real
 * testnet funds and there is no reason for the escrow to be able to take more
 * than the bounty it is being asked to hold.
 */
export async function createBountyOnChain(terms: BountyTerms): Promise<ChainResult> {
  const client = wallet();
  if (!client) return { ok: false, txs: [], error: "No relayer key configured." };

  const txs: { step: string; hash: Hash }[] = [];
  const budget = toUsdc(terms.budgetUsdc);

  try {
    const buyer = client.account.address;

    const balance = await usdcBalance(buyer);
    if (balance < budget) {
      return {
        ok: false,
        txs: [],
        error:
          `The buyer holds ${fromUsdc(balance).toFixed(2)} USDC but the bounty ` +
          `escrows ${terms.budgetUsdc.toFixed(2)}.`,
      };
    }

    const approveHash = await client.writeContract({
      address: ADDRESSES.usdc,
      abi: erc20Abi,
      functionName: "approve",
      args: [ADDRESSES.bountyEscrow, budget],
    });
    txs.push({ step: "approve", hash: approveHash });
    await waitForSuccess(publicClient, approveHash, "approve");

    const createHash = await client.writeContract({
      address: ADDRESSES.bountyEscrow,
      abi: bountyEscrowAbi,
      functionName: "createBounty",
      args: [
        bountyKey(terms.bountyId),
        budget,
        toUsdc(terms.perEpisodeUsdc),
        terms.maxEpisodes,
        toUsdc(terms.utilityPoolUsdc),
        toUsdc(terms.validatorFeeUsdc),
        toUsdc(terms.treasuryFeeUsdc),
        BigInt(terms.deadline),
      ],
    });
    txs.push({ step: "createBounty", hash: createHash });
    await waitForSuccess(publicClient, createHash, "createBounty");

    return { ok: true, txs };
  } catch (err) {
    return { ok: false, txs, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Release an episode's per-episode payment.
 *
 * The escrow reads the validation from EpisodeRegistry itself and refuses to
 * pay an episode nobody checked, so this only works once the episode has been
 * anchored — which is the correct order, not a limitation.
 */
export async function acceptEpisodeOnChain(
  bountyId: string,
  onchainEpisodeId: string,
): Promise<ChainResult> {
  const client = wallet();
  if (!client) return { ok: false, txs: [], error: "No relayer key configured." };

  try {
    const alreadyPaid = (await publicClient.readContract({
      address: ADDRESSES.bountyEscrow,
      abi: bountyEscrowAbi,
      functionName: "episodePaid",
      args: [BigInt(onchainEpisodeId)],
    })) as boolean;

    if (alreadyPaid) {
      return { ok: false, txs: [], error: "That episode has already been paid." };
    }

    const hash = await client.writeContract({
      address: ADDRESSES.bountyEscrow,
      abi: bountyEscrowAbi,
      functionName: "acceptEpisode",
      args: [bountyKey(bountyId), BigInt(onchainEpisodeId)],
    });
    await waitForSuccess(publicClient, hash, "acceptEpisode");

    return { ok: true, txs: [{ step: "acceptEpisode", hash }] };
  } catch (err) {
    return { ok: false, txs: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Send a contributor enough gas to collect their own payment.
 *
 * The escrow credits a balance and the recipient pulls it, which is the right
 * shape — one contributor with a reverting fallback cannot block payment for
 * everyone. But a phone that has never held ETH cannot call withdraw at all,
 * so §3's "no gas prompt" needs the gas to arrive from somewhere.
 *
 * A relayed withdraw would be better and belongs in the contract; this is the
 * version that does not require redeploying one.
 */
export async function fundGas(recipient: `0x${string}`, wei: bigint): Promise<ChainResult> {
  const client = wallet();
  if (!client) return { ok: false, txs: [], error: "No relayer key configured." };

  try {
    const existing = await publicClient.getBalance({ address: recipient });
    if (existing >= wei) return { ok: true, txs: [] };

    const hash = await client.sendTransaction({ to: recipient, value: wei - existing });
    await waitForSuccess(publicClient, hash, "fundGas");

    return { ok: true, txs: [{ step: "fundGas", hash }] };
  } catch (err) {
    return { ok: false, txs: [], error: err instanceof Error ? err.message : String(err) };
  }
}
