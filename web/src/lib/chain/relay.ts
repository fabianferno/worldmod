import "server-only";

/**
 * The relayer: pays gas so a contributor never has to.
 *
 * product-spec §3 puts "no install, no gas prompt" at the centre of the supply
 * story, and Relayable is what delivers it — the phone signs, this pays, and
 * the contracts attribute the result to the recovered signer. The relayer is
 * untrusted by construction: it can refuse to submit, but it cannot alter what
 * was signed or take credit for it.
 *
 * Every function here is best-effort. Anchoring runs after an episode has
 * already been scored and recorded locally, so a failed transaction costs a
 * missing tx hash, never a lost episode.
 */

import { createPublicClient, createWalletClient, http, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { assetRegistryAbi, entityRegistryAbi, episodeRegistryAbi } from "./abi";
import { ADDRESSES, CHAIN, RPC_URL, relayerKey } from "./config";
import { waitForSuccess } from "./wait-for-success";

export const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });

function wallet() {
  const key = relayerKey();
  if (!key) return null;
  return createWalletClient({
    account: privateKeyToAccount(key),
    chain: CHAIN,
    transport: http(RPC_URL),
  });
}

export interface RegisterSignatures {
  contributor: `0x${string}`;
  entity?: { entityType: number; metadataURI: string; signature: `0x${string}` };
  asset?: { assetType: string; capabilities: number; metadataURI: string; signature: `0x${string}` };
}

export interface RelayedSignatures {
  contributor: `0x${string}`;
  episode: {
    assetId: string;
    bountyId: `0x${string}`;
    manifestHash: `0x${string}`;
    storageURI: string;
    signature: `0x${string}`;
  };
}

export interface AnchorResult {
  ok: boolean;
  episodeId?: string;
  txs: { step: string; hash: Hash }[];
  error?: string;
}

/** Nonces are per-signer and shared across all three contracts' own counters. */
export async function noncesFor(contributor: `0x${string}`) {
  const [entity, asset, episode, registered, assets] = await Promise.all([
    publicClient.readContract({
      address: ADDRESSES.entityRegistry, abi: entityRegistryAbi, functionName: "nonces", args: [contributor],
    }),
    publicClient.readContract({
      address: ADDRESSES.assetRegistry, abi: assetRegistryAbi, functionName: "nonces", args: [contributor],
    }),
    publicClient.readContract({
      address: ADDRESSES.episodeRegistry, abi: episodeRegistryAbi, functionName: "nonces", args: [contributor],
    }),
    publicClient.readContract({
      address: ADDRESSES.entityRegistry, abi: entityRegistryAbi, functionName: "isRegistered", args: [contributor],
    }),
    publicClient.readContract({
      address: ADDRESSES.assetRegistry, abi: assetRegistryAbi, functionName: "assetsOf", args: [contributor],
    }),
  ]);

  return {
    entity: entity as bigint,
    asset: asset as bigint,
    episode: episode as bigint,
    registered: registered as boolean,
    assetIds: (assets as readonly bigint[]).map(String),
  };
}

/**
 * Register a contributor and their phone, from their signatures.
 *
 * Separate from anchoring, and necessarily so: SubmitEpisode's signature
 * commits to an asset id, and an asset that does not exist yet has no id to
 * commit to. Registration lands first and returns the id, which the device
 * then signs against. Doing both in one call would mean signing a guessed id
 * and reverting whenever the guess was wrong.
 */
export async function registerContributor(
  signed: RegisterSignatures,
): Promise<{ ok: boolean; assetIds: string[]; txs: { step: string; hash: Hash }[]; error?: string }> {
  const client = wallet();
  if (!client) return { ok: false, assetIds: [], txs: [], error: "No relayer key configured." };

  const txs: { step: string; hash: Hash }[] = [];

  try {
    if (signed.entity) {
      const hash = await client.writeContract({
        address: ADDRESSES.entityRegistry,
        abi: entityRegistryAbi,
        functionName: "registerEntityFor",
        args: [
          signed.contributor,
          signed.entity.entityType,
          signed.entity.metadataURI,
          signed.entity.signature,
        ],
      });
      txs.push({ step: "registerEntity", hash });
      await waitForSuccess(publicClient, hash, "registerEntity");
    }

    if (signed.asset) {
      const hash = await client.writeContract({
        address: ADDRESSES.assetRegistry,
        abi: assetRegistryAbi,
        functionName: "registerAssetFor",
        args: [
          signed.contributor,
          signed.asset.assetType,
          signed.asset.capabilities,
          signed.asset.metadataURI,
          signed.asset.signature,
        ],
      });
      txs.push({ step: "registerAsset", hash });
      await waitForSuccess(publicClient, hash, "registerAsset");
    }

    // Read back rather than decode logs: the registry's own list is the answer
    // to "which assets does this address own", and the device signs against it.
    const assetIds = (await publicClient.readContract({
      address: ADDRESSES.assetRegistry,
      abi: assetRegistryAbi,
      functionName: "assetsOf",
      args: [signed.contributor],
    })) as readonly bigint[];

    return { ok: true, assetIds: assetIds.map(String), txs };
  } catch (err) {
    return { ok: false, assetIds: [], txs, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Commit a scored episode's manifest hash, then record what the validator found.
 *
 * Two transactions, sequential because the second needs the episode id the
 * first creates.
 */
export async function anchorEpisode(
  signed: RelayedSignatures,
  validation: { scoreBps: number; trustLevel: number },
): Promise<AnchorResult> {
  const client = wallet();
  if (!client) return { ok: false, txs: [], error: "No relayer key configured." };

  const txs: { step: string; hash: Hash }[] = [];

  try {
    const submitHash = await client.writeContract({
      address: ADDRESSES.episodeRegistry,
      abi: episodeRegistryAbi,
      functionName: "submitEpisodeFor",
      args: [
        signed.contributor,
        BigInt(signed.episode.assetId),
        signed.episode.bountyId,
        signed.episode.manifestHash,
        signed.episode.storageURI,
        signed.episode.signature,
      ],
    });
    txs.push({ step: "submitEpisode", hash: submitHash });
    await waitForSuccess(publicClient, submitHash, "submitEpisode");

    // Read the id back from the registry rather than parsing logs: the mapping
    // is the contract's own answer to "which episode is this manifest".
    const episodeId = (await publicClient.readContract({
      address: ADDRESSES.episodeRegistry,
      abi: episodeRegistryAbi,
      functionName: "episodeByManifest",
      args: [signed.episode.manifestHash],
    })) as bigint;

    // The relayer is also the registry's validator, which §8.3 says plainly is
    // centralized in the MVP.
    const validationHash = await client.writeContract({
      address: ADDRESSES.episodeRegistry,
      abi: episodeRegistryAbi,
      functionName: "recordValidation",
      args: [episodeId, validation.scoreBps, validation.trustLevel],
    });
    txs.push({ step: "recordValidation", hash: validationHash });
    await waitForSuccess(publicClient, validationHash, "recordValidation");

    return { ok: true, episodeId: episodeId.toString(), txs };
  } catch (err) {
    // Partial progress is kept: the transactions that landed are real, and
    // reporting them is more useful than pretending nothing happened.
    return { ok: false, txs, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The address that records validations, when one is configured.
 *
 * Derived from the relayer key rather than stored separately: the relayer is
 * the registry's validator in the MVP, and a second copy of the same fact is a
 * second thing to get out of step. Lives here rather than in config because
 * config is imported by client components, and viem/accounts has no business
 * in a phone's bundle.
 */
export function validatorAddress(): string | null {
  const key = relayerKey();
  return key ? privateKeyToAccount(key).address : null;
}
