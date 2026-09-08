"use client";

/**
 * The contributor's key, held on the device.
 *
 * product-spec §10.3 asks for an embedded wallet with social login, and this is
 * the honest subset of that: a real secp256k1 key generated in the browser and
 * kept in localStorage. There is no social login and no recovery — clearing
 * site data loses the key — and the UI says so rather than implying custody it
 * does not provide.
 *
 * It replaces an earlier placeholder that generated twenty random bytes and
 * formatted them as an address. That looked like an account and could never be
 * one: nobody held the key, so nothing could ever be signed with it, and every
 * relayed call would have failed signature recovery. §11's whole contributor
 * path depends on the phone being able to sign.
 *
 * The key never leaves the device. The relayer pays gas and cannot alter what
 * was signed or claim the result — the contracts attribute to the recovered
 * signer, not to the sender.
 */

import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { LocalAccount } from "viem";
import { ADDRESSES, CHAIN } from "./config";
import {
  DOMAIN_NAMES,
  REGISTER_ASSET_TYPES,
  REGISTER_ENTITY_TYPES,
  SUBMIT_EPISODE_TYPES,
} from "./abi";

const KEY_STORAGE = "worldmod.device_key";

function loadKey(): `0x${string}` {
  const existing = localStorage.getItem(KEY_STORAGE);
  if (existing && /^0x[0-9a-fA-F]{64}$/.test(existing)) return existing as `0x${string}`;

  const created = generatePrivateKey();
  localStorage.setItem(KEY_STORAGE, created);
  return created;
}

let cached: LocalAccount | null = null;

/**
 * The device's account, created on first use.
 *
 * Throws where storage is unavailable rather than falling back to a throwaway
 * key: a contributor whose address changed every session would be paid to an
 * address they cannot reach, which is worse than a clear failure.
 */
export function deviceAccount(): LocalAccount {
  cached ??= privateKeyToAccount(loadKey());
  return cached;
}

export function deviceAddress(): `0x${string}` {
  return deviceAccount().address;
}

/** Present, without touching storage — for rendering before any capture. */
export function hasDeviceKey(): boolean {
  try {
    return localStorage.getItem(KEY_STORAGE) !== null;
  } catch {
    return false;
  }
}

function domain(name: string, verifyingContract: `0x${string}`) {
  return { name, version: "1", chainId: CHAIN.id, verifyingContract } as const;
}

export function signRegisterEntity(entityType: number, metadataURI: string, nonce: bigint) {
  return deviceAccount().signTypedData({
    domain: domain(DOMAIN_NAMES.entity, ADDRESSES.entityRegistry),
    types: REGISTER_ENTITY_TYPES,
    primaryType: "RegisterEntity",
    message: { entityType, metadataURI, nonce },
  });
}

export function signRegisterAsset(
  assetType: string,
  capabilities: number,
  metadataURI: string,
  nonce: bigint,
) {
  return deviceAccount().signTypedData({
    domain: domain(DOMAIN_NAMES.asset, ADDRESSES.assetRegistry),
    types: REGISTER_ASSET_TYPES,
    primaryType: "RegisterAsset",
    message: { assetType, capabilities, metadataURI, nonce },
  });
}

export function signSubmitEpisode(
  assetId: bigint,
  bountyId: `0x${string}`,
  manifestHash: `0x${string}`,
  storageURI: string,
  nonce: bigint,
) {
  return deviceAccount().signTypedData({
    domain: domain(DOMAIN_NAMES.episode, ADDRESSES.episodeRegistry),
    types: SUBMIT_EPISODE_TYPES,
    primaryType: "SubmitEpisode",
    message: { assetId, bountyId, manifestHash, storageURI, nonce },
  });
}
