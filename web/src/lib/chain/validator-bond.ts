/**
 * Reads the live state of WMOD + ValidatorBond — the one real function that
 * earns the native token its [MVP] label (product-spec §13).
 *
 * A validator stakes WMOD; `isBonded` gates on `minBond`; the EpisodeRegistry
 * owner can slash a stake for bad validation, and slashed stake is burned
 * rather than paid to the slasher. This module only reads that state so the
 * buyer UI can show the token is wired to something real, not minted in a
 * vacuum.
 *
 * Both contracts are deployed on Ethereum Sepolia (see contracts/deployments.json,
 * chain 11155111). The shared `publicClient` reads whichever chain config.ts
 * points at, so this only attempts a read when that chain IS Sepolia — on any
 * other active chain the contracts don't exist and we return null rather than
 * read garbage.
 */

import { publicClient } from "@/lib/chain/relay";
import { CHAIN } from "@/lib/chain/config";
import { validatorAddress } from "@/lib/chain/relay";

const SEPOLIA_ID = 11155111;

// From contracts/deployments.json → "11155111". Immutable deployed addresses,
// kept here beside the ABIs the way config.ts keeps the registry addresses.
export const WMOD_ADDRESS = "0x404C3F4cf93ad608449f222da1b6b0f824c64ed0" as const;
export const VALIDATOR_BOND_ADDRESS = "0xe82c07EbA59EBa7De02cd84DC5c093cf257D0605" as const;

const erc20Abi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const validatorBondAbi = [
  { type: "function", name: "minBond", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalBonded", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "bondOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "isBonded", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isRegisteredValidator", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
] as const;

export interface ValidatorBondState {
  token: { symbol: string; decimals: number; totalSupply: bigint };
  bond: { minBond: bigint; totalBonded: bigint };
  /** Null when the network has no configured validator address to inspect. */
  validator:
    | { address: string; bondOf: bigint; isBonded: boolean; isRegistered: boolean }
    | null;
}

/** True only where the token/bond contracts actually live. */
export function bondChainSupported(): boolean {
  return CHAIN.id === SEPOLIA_ID;
}

export async function readValidatorBond(): Promise<ValidatorBondState | null> {
  if (!bondChainSupported()) return null;

  const [symbol, decimals, totalSupply, minBond, totalBonded] = await Promise.all([
    publicClient.readContract({ address: WMOD_ADDRESS, abi: erc20Abi, functionName: "symbol" }) as Promise<string>,
    publicClient.readContract({ address: WMOD_ADDRESS, abi: erc20Abi, functionName: "decimals" }) as Promise<number>,
    publicClient.readContract({ address: WMOD_ADDRESS, abi: erc20Abi, functionName: "totalSupply" }) as Promise<bigint>,
    publicClient.readContract({ address: VALIDATOR_BOND_ADDRESS, abi: validatorBondAbi, functionName: "minBond" }) as Promise<bigint>,
    publicClient.readContract({ address: VALIDATOR_BOND_ADDRESS, abi: validatorBondAbi, functionName: "totalBonded" }) as Promise<bigint>,
  ]);

  const validatorAddr = validatorAddress();
  let validator: ValidatorBondState["validator"] = null;
  if (validatorAddr) {
    const addr = validatorAddr as `0x${string}`;
    const [bondOf, isBonded, isRegistered] = await Promise.all([
      publicClient.readContract({ address: VALIDATOR_BOND_ADDRESS, abi: validatorBondAbi, functionName: "bondOf", args: [addr] }) as Promise<bigint>,
      publicClient.readContract({ address: VALIDATOR_BOND_ADDRESS, abi: validatorBondAbi, functionName: "isBonded", args: [addr] }) as Promise<boolean>,
      publicClient.readContract({ address: VALIDATOR_BOND_ADDRESS, abi: validatorBondAbi, functionName: "isRegisteredValidator", args: [addr] }) as Promise<boolean>,
    ]);
    validator = { address: validatorAddr, bondOf, isBonded, isRegistered };
  }

  return {
    token: { symbol, decimals, totalSupply },
    bond: { minBond, totalBonded },
    validator,
  };
}
