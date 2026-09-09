/**
 * Where the contracts live, and whether the chain is wired up at all.
 *
 * Everything here is deliberately optional. The marketplace works without a
 * chain — episodes are scored, accepted and paid in the local store — and
 * anchoring is an addition on top, not a dependency. A missing RPC or relayer
 * key disables anchoring and leaves the rest untouched, because a demo that
 * cannot record an episode when an RPC is flaky is worse than one that records
 * it and anchors late.
 *
 * Two networks are wired up, not one. The Sepolia-to-Hedera migration moved
 * the six core contracts to Hedera testnet — real, deployed, independently
 * verified (contracts/deployments.json's "296" entry) — but Sepolia's own
 * entry ("11155111") is kept, not deleted, as a rollback fallback: `ACTIVE_CHAIN`
 * picks between them, defaulting to Sepolia until Hedera has been proven
 * end-to-end from the running app, not just from standalone scripts.
 */

import { defineChain } from "viem";
import { sepolia, hederaTestnet } from "viem/chains";

export type ActiveChainName = "sepolia" | "hedera";

// NEXT_PUBLIC_-prefixed deliberately: this module is imported by client
// components too (withdraw-client.ts signs its own transaction from the
// browser), and only NEXT_PUBLIC_* vars get inlined into a client bundle —
// a bare ACTIVE_CHAIN would silently read as undefined there, leaving the
// withdraw button on Sepolia even after the server switched to Hedera. Not
// a secret either way; which testnet the app targets is fine to ship in JS.
export const ACTIVE_CHAIN: ActiveChainName =
  process.env.NEXT_PUBLIC_ACTIVE_CHAIN === "hedera" ? "hedera" : "sepolia";

/** product-spec §10.3 asks for an L2 with USDC; Circle issues real USDC on both. */
export const CHAIN = ACTIVE_CHAIN === "hedera" ? hederaTestnet : sepolia;

export interface ChainAddresses {
  entityRegistry: `0x${string}`;
  assetRegistry: `0x${string}`;
  episodeRegistry: `0x${string}`;
  bountyEscrow: `0x${string}`;
  datasetRegistry: `0x${string}`;
  federatedRound: `0x${string}`;
  usdc: `0x${string}`;
}

/** Deployed 2026-09-04. Mirrors contracts/deployments.json's "11155111" entry. */
const SEPOLIA_ADDRESSES: ChainAddresses = {
  entityRegistry: "0x5f73D8d846AC9E8d487072f7Bd09af5e4E5c8928",
  assetRegistry: "0xd167a52404E546FF1342faf91f6c097568039708",
  episodeRegistry: "0xA5dB7Ad4BcCA2E2a189c257606c4B96AD32b563F",
  bountyEscrow: "0x0Be163d4795D77dC8CdB2cAedF08e213ADef27D6",
  datasetRegistry: "0x1df8feDf50394A9e0f78cb0EF8F187D587812cbB",
  federatedRound: "0x65297C410B96C3604b0A41921e355B24E6cf782e",
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
};

/**
 * Deployed 2026-09-09 via contracts/script/deploy-hedera.mjs (raw viem, not
 * forge — see that script's header). Mirrors contracts/deployments.json's
 * "296" entry. `usdc` is Hedera testnet's real HTS token (0.0.429274), not a
 * plain ERC-20 — BountyEscrow/DatasetRegistry/FederatedRound self-associated
 * with it in their own constructors, independently confirmed via the mirror
 * node before this address was ever wired in here.
 */
const HEDERA_ADDRESSES: ChainAddresses = {
  entityRegistry: "0xCa4B07748704dDD01C3F22108D7f3eeAE2799B5a",
  assetRegistry: "0x81c7cd9156215db1AB704C2d9cDbEEE1ba460F9A",
  episodeRegistry: "0x328C505E7aC99C966f09275aAE8F4265A5612dAb",
  bountyEscrow: "0x455b3DD688d92DC9eE0F0A26301A1E356123Cb87",
  datasetRegistry: "0xEe83C802Bb7E0B999bd74E57452752be4b7b667e",
  federatedRound: "0xd48Fa193303260061af52cF4232f81a26A994aDE",
  usdc: "0x0000000000000000000000000000000000068cDa",
};

export const ADDRESSES: ChainAddresses =
  ACTIVE_CHAIN === "hedera" ? HEDERA_ADDRESSES : SEPOLIA_ADDRESSES;

export const RPC_URL =
  ACTIVE_CHAIN === "hedera"
    ? (process.env.HEDERA_TESTNET_RPC_URL ?? "https://testnet.hashio.io/api")
    : (process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com");

/**
 * The relayer's key, server-side only.
 *
 * Testnet only, and never referenced from client code — this module is imported
 * by route handlers, and Next would fail the build if a client component pulled
 * a bare process.env secret into a bundle. Absent means anchoring is off.
 *
 * A different key per network, not a shared one: on Hedera the relayer has
 * to be the account that actually owns the deployed contracts (episode
 * registry owner/validator, escrow oracle/treasury — the deploy script's own
 * convention), which is `HEDERA_PRIVATE_KEY`, the same key this project's
 * Hedera work has used all along — not the Sepolia relayer's key.
 */
export function relayerKey(): `0x${string}` | null {
  const key =
    ACTIVE_CHAIN === "hedera" ? process.env.HEDERA_PRIVATE_KEY : process.env.RELAYER_PRIVATE_KEY;
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

export { defineChain };
