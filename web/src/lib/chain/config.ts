/**
 * Where the contracts live, and whether the chain is wired up at all.
 *
 * Everything here is deliberately optional. The marketplace works without a
 * chain — episodes are scored, accepted and paid in the local store — and
 * anchoring is an addition on top, not a dependency. A missing RPC or relayer
 * key disables anchoring and leaves the rest untouched, because a demo that
 * cannot record an episode when an RPC is flaky is worse than one that records
 * it and anchors late.
 */

import { defineChain } from "viem";
import { sepolia } from "viem/chains";

/** product-spec §10.3 asks for an L2 with USDC; Circle issues real USDC here. */
export const CHAIN = sepolia;

export interface ChainAddresses {
  entityRegistry: `0x${string}`;
  assetRegistry: `0x${string}`;
  episodeRegistry: `0x${string}`;
  bountyEscrow: `0x${string}`;
  datasetRegistry: `0x${string}`;
  federatedRound: `0x${string}`;
  usdc: `0x${string}`;
}

/** Mirrors contracts/deployments.json. BountyEscrow redeployed 2026-09-10 for EpisodeAcceptedForAttestation. */
export const ADDRESSES: ChainAddresses = {
  entityRegistry: "0x5f73D8d846AC9E8d487072f7Bd09af5e4E5c8928",
  assetRegistry: "0xd167a52404E546FF1342faf91f6c097568039708",
  episodeRegistry: "0xA5dB7Ad4BcCA2E2a189c257606c4B96AD32b563F",
  bountyEscrow: "0x08310053F696a09B837fdcA8b65E041570ff2CE3",
  datasetRegistry: "0x1df8feDf50394A9e0f78cb0EF8F187D587812cbB",
  federatedRound: "0x65297C410B96C3604b0A41921e355B24E6cf782e",
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
};

export const RPC_URL =
  process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

/**
 * The relayer's key, server-side only.
 *
 * Testnet only, and never referenced from client code — this module is imported
 * by route handlers, and Next would fail the build if a client component pulled
 * a bare process.env secret into a bundle. Absent means anchoring is off.
 */
export function relayerKey(): `0x${string}` | null {
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!key) return null;
  const prefixed = key.startsWith("0x") ? key : `0x${key}`;
  return /^0x[0-9a-fA-F]{64}$/.test(prefixed) ? (prefixed as `0x${string}`) : null;
}

export function chainEnabled(): boolean {
  return relayerKey() !== null;
}

/** A link a judge can click, rather than a hash they have to paste. */
export function explorerTx(hash: string): string {
  return `${CHAIN.blockExplorers?.default.url ?? "https://sepolia.etherscan.io"}/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `${CHAIN.blockExplorers?.default.url ?? "https://sepolia.etherscan.io"}/address/${address}`;
}

/** Creditcoin CC3 testnet — where the Attestcoin ASC's proof lands. See attestcoin.md. */
export const CREDITCOIN_CHAIN_ID = 102031;

export function explorerCreditcoinTx(hash: string): string {
  return `https://creditcoin-testnet.blockscout.com/tx/${hash}`;
}

export { defineChain };
