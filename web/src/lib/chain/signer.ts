"use client";

/**
 * Who signs an episode: a device key in localStorage.
 *
 * It signs exactly as well as any other identity and cannot be recovered —
 * clear site data and the address, and anything owed to it, is gone. There is
 * no second, recoverable identity right now; product-spec §10.3's ask for one
 * is unmet.
 */

import {
  deviceAddress,
  signRegisterAsset,
  signRegisterEntity,
  signSubmitEpisode,
} from "./identity";

export type IdentityKind = "device";

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

let cachedDevice: Signer | null = null;

/**
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
