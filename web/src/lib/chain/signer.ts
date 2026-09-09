"use client";

/**
 * Who signs an episode.
 *
 * Two identities can do it and they are not equivalent:
 *
 *   The wallet already inside World App, reachable again from any device by
 *   being signed into World App there. Payments credited to it survive a lost
 *   phone, which is the entire reason §10.3 asks for a recoverable identity
 *   rather than a bare key.
 *
 *   A device key in localStorage. It signs exactly as well and cannot be
 *   recovered — clear site data and the address, and anything owed to it, is
 *   gone.
 *
 * The device key remains the fallback rather than being removed. World App's
 * wallet needs the mini app to actually be running inside World App; a
 * contributor on plain mobile web should still be able to record, and the UI
 * says which identity they are using rather than implying custody that is not
 * there.
 */

import { MiniKit } from "@worldcoin/minikit-js";
import type { TypedData, TypedDataDomain } from "viem";
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

export type IdentityKind = "worldapp" | "device";

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
 * A signer backed by the wallet already inside World App.
 *
 * `MiniKit.signTypedData` is the same EIP-712-over-the-wire shape Privy's
 * `eth_signTypedData_v4` used — domain, types, primaryType, message — so
 * every call site that built a request for Privy needed only its transport
 * swapped, not its content. The private key never leaves World App; this
 * page only ever sees the resulting signature, which is what makes the
 * identity recoverable at all.
 */
export function worldAppSigner(address: `0x${string}`): Signer {
  async function signTypedData(payload: {
    domain: TypedDataDomain;
    types: TypedData;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`> {
    const result = await MiniKit.signTypedData({
      domain: payload.domain,
      types: payload.types,
      primaryType: payload.primaryType,
      message: payload.message,
    });
    if (!("signature" in result.data)) {
      throw new Error(`World App declined to sign: ${JSON.stringify(result.data)}`);
    }
    return result.data.signature as `0x${string}`;
  }

  // EIP-712 over the wire needs the domain type declared explicitly; viem
  // adds it for you and a raw signTypedData call does not.
  const EIP712Domain = [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ];

  return {
    kind: "worldapp",
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
