"use client";

/**
 * Who signs an episode.
 *
 * Two identities can do it and they are not equivalent:
 *
 *   A Privy embedded wallet, reachable again from any device by logging in.
 *   Payments credited to it survive a lost phone, which is the entire reason
 *   §10.3 asks for social login rather than a bare key.
 *
 *   A device key in localStorage. It signs exactly as well and cannot be
 *   recovered — clear site data and the address, and anything owed to it, is
 *   gone.
 *
 * The device key remains the fallback rather than being removed. Social login
 * needs a network round trip and an account; a contributor with a phone and no
 * patience should still be able to record, and the UI says which identity they
 * are using rather than implying custody that is not there.
 */

import type { ConnectedWallet } from "@privy-io/react-auth";
import { ADDRESSES, CHAIN } from "./config";
import {
  DOMAIN_NAMES,
  REGISTER_ASSET_TYPES,
  REGISTER_ENTITY_TYPES,
  SUBMIT_EPISODE_TYPES,
} from "./abi";
import {
  deviceAddress,
  signRegisterAsset,
  signRegisterEntity,
  signSubmitEpisode,
} from "./identity";

export type IdentityKind = "privy" | "device";

export interface Signer {
  kind: IdentityKind;
  address: `0x${string}`;
  /** True when the address can be recovered on another device. */
  recoverable: boolean;
  signRegisterEntity(entityType: number, metadataURI: string, nonce: bigint): Promise<`0x${string}`>;
  signRegisterAsset(
    assetType: string,
    capabilities: number,
    metadataURI: string,
    nonce: bigint,
  ): Promise<`0x${string}`>;
  signSubmitEpisode(
    assetId: bigint,
    bountyId: `0x${string}`,
    manifestHash: `0x${string}`,
    storageURI: string,
    nonce: bigint,
  ): Promise<`0x${string}`>;
}

function domain(name: string, verifyingContract: `0x${string}`) {
  return { name, version: "1", chainId: CHAIN.id, verifyingContract } as const;
}

/**
 * A signer backed by a Privy embedded wallet.
 *
 * Signs through EIP-1193 `eth_signTypedData_v4` rather than a viem account:
 * the private key lives in Privy's enclave and is never in this page, which is
 * the property that makes it recoverable at all.
 */
export function privySigner(wallet: ConnectedWallet): Signer {
  const address = wallet.address as `0x${string}`;

  async function signTypedData(payload: Record<string, unknown>): Promise<`0x${string}`> {
    const provider = await wallet.getEthereumProvider();
    return (await provider.request({
      method: "eth_signTypedData_v4",
      params: [address, JSON.stringify(payload)],
    })) as `0x${string}`;
  }

  // EIP-712 over the wire needs the domain type declared explicitly; viem adds
  // it for you and a raw provider does not.
  const EIP712Domain = [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ];

  return {
    kind: "privy",
    address,
    recoverable: true,

    signRegisterEntity: (entityType, metadataURI, nonce) =>
      signTypedData({
        domain: domain(DOMAIN_NAMES.entity, ADDRESSES.entityRegistry),
        types: { EIP712Domain, ...REGISTER_ENTITY_TYPES },
        primaryType: "RegisterEntity",
        message: { entityType, metadataURI, nonce: nonce.toString() },
      }),

    signRegisterAsset: (assetType, capabilities, metadataURI, nonce) =>
      signTypedData({
        domain: domain(DOMAIN_NAMES.asset, ADDRESSES.assetRegistry),
        types: { EIP712Domain, ...REGISTER_ASSET_TYPES },
        primaryType: "RegisterAsset",
        message: { assetType, capabilities, metadataURI, nonce: nonce.toString() },
      }),

    signSubmitEpisode: (assetId, bountyId, manifestHash, storageURI, nonce) =>
      signTypedData({
        domain: domain(DOMAIN_NAMES.episode, ADDRESSES.episodeRegistry),
        types: { EIP712Domain, ...SUBMIT_EPISODE_TYPES },
        primaryType: "SubmitEpisode",
        message: {
          assetId: assetId.toString(),
          bountyId,
          manifestHash,
          storageURI,
          nonce: nonce.toString(),
        },
      }),
  };
}

let cachedDevice: Signer | null = null;

/**
 * The unrecoverable fallback. Signs the same, survives nothing.
 *
 * Cached because useSyncExternalStore compares snapshots by identity: a fresh
 * object on every read would loop forever.
 */
export function deviceSigner(): Signer {
  if (cachedDevice) return cachedDevice;

  cachedDevice = {
    kind: "device",
    address: deviceAddress(),
    recoverable: false,
    signRegisterEntity,
    signRegisterAsset,
    signSubmitEpisode,
  };
  return cachedDevice;
}
