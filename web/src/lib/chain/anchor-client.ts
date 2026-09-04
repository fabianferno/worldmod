"use client";

/**
 * Put a scored episode on-chain, from the device that recorded it.
 *
 * The sequence is: ask the server what the chain currently knows about this
 * address, sign only the steps that are actually missing, and hand the
 * signatures to the relayer. A returning contributor signs one message; a new
 * one signs three.
 *
 * Every failure here is silent by design. The episode is already recorded,
 * scored and payable in the marketplace before any of this runs — anchoring
 * adds product-spec §6.1's on-chain commitment on top, and a contributor whose
 * capture was refused because an RPC was unreachable would be the worst
 * possible trade.
 */

import type { EpisodeAnchor } from "@/lib/market/types";
import {
  deviceAddress,
  signRegisterAsset,
  signRegisterEntity,
  signSubmitEpisode,
} from "./identity";

/** AssetRegistry's capability bits. A phone declares what it can actually emit. */
export const MODALITY_RGB = 1 << 0;
export const MODALITY_IMU = 1 << 1;
export const MODALITY_ORIENTATION = 1 << 4;

/** EntityRegistry.EntityType.Individual */
const INDIVIDUAL = 0;

const PHONE_CAPABILITIES = MODALITY_RGB | MODALITY_IMU | MODALITY_ORIENTATION;

interface Prepared {
  enabled: boolean;
  registered?: boolean;
  assetIds?: string[];
  nonces?: { entity: string; asset: string; episode: string };
}

/**
 * @param bountyId the marketplace's string id, hashed to bytes32 for the chain.
 */
export async function anchorEpisode(
  episodeId: string,
  manifestHash: string,
  bountyId: string,
  storageURI: string,
): Promise<EpisodeAnchor | null> {
  const contributor = deviceAddress();

  const prepared = (await (
    await fetch(`/api/chain/prepare?address=${contributor}`)
  ).json()) as Prepared;

  if (!prepared.enabled || !prepared.nonces) return null;

  const { keccak256, toHex } = await import("viem");
  const bountyIdBytes = keccak256(toHex(bountyId));

  // Registration first, and only what is missing. Its transactions must land
  // before the episode can be signed: SubmitEpisode commits to an asset id,
  // and an unregistered phone has none to commit to.
  let assetId = prepared.assetIds?.[0];
  const setupTxs: Array<{ step: string; hash: string }> = [];

  if (!prepared.registered || !assetId) {
    const registration: Record<string, unknown> = { contributor };

    if (!prepared.registered) {
      registration.entity = {
        entityType: INDIVIDUAL,
        metadataURI: "",
        signature: await signRegisterEntity(INDIVIDUAL, "", BigInt(prepared.nonces.entity)),
      };
    }
    if (!assetId) {
      registration.asset = {
        assetType: "phone",
        capabilities: PHONE_CAPABILITIES,
        metadataURI: "",
        signature: await signRegisterAsset(
          "phone",
          PHONE_CAPABILITIES,
          "",
          BigInt(prepared.nonces.asset),
        ),
      };
    }

    const registered = (await (
      await fetch("/api/chain/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(registration),
      })
    ).json()) as { assetIds?: string[]; txs?: Array<{ step: string; hash: string }> };

    setupTxs.push(...(registered.txs ?? []));
    assetId = registered.assetIds?.[0];
    if (!assetId) return null;
  }

  const signed = {
    contributor,
    episode: {
      assetId,
      bountyId: bountyIdBytes,
      manifestHash,
      storageURI,
      signature: await signSubmitEpisode(
        BigInt(assetId),
        bountyIdBytes,
        manifestHash as `0x${string}`,
        storageURI,
        BigInt(prepared.nonces.episode),
      ),
    },
  };

  const response = await fetch("/api/chain/anchor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ episodeId, signed }),
  });

  const data = (await response.json()) as { anchor?: EpisodeAnchor };
  if (!data.anchor) return null;

  // Registration and submission are one act from the contributor's side, so
  // the receipt shows every transaction their signature caused.
  return { ...data.anchor, txs: [...setupTxs, ...data.anchor.txs] };
}
