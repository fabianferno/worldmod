/**
 * Reads one DatasetRegistry.Dataset live off-chain. No stored copy — this is
 * the registry's own current answer, not a cache that can drift from it.
 */

import { publicClient } from "@/lib/chain/relay";
import { ADDRESSES } from "@/lib/chain/config";
import { datasetRegistryAbi } from "@/lib/chain/abi";

export interface RegistryDataset {
  datasetId: number;
  creator: string;
  priceUsdc: bigint;
  episodesRoot: string;
  episodeCount: number;
  mintedAt: number;
  license: string;
  metadataURI: string;
}

export async function readDatasetRegistry(datasetId: number): Promise<RegistryDataset> {
  const d = (await publicClient.readContract({
    address: ADDRESSES.datasetRegistry,
    abi: datasetRegistryAbi,
    functionName: "getDataset",
    args: [BigInt(datasetId)],
  })) as {
    creator: string;
    priceUsdc: bigint;
    episodesRoot: string;
    episodeCount: number;
    mintedAt: bigint;
    license: string;
    metadataURI: string;
  };

  return {
    datasetId,
    creator: d.creator,
    priceUsdc: d.priceUsdc,
    episodesRoot: d.episodesRoot,
    episodeCount: Number(d.episodeCount),
    mintedAt: Number(d.mintedAt),
    license: d.license,
    metadataURI: d.metadataURI,
  };
}

export async function datasetRegistryCount(): Promise<number> {
  const count = (await publicClient.readContract({
    address: ADDRESSES.datasetRegistry,
    abi: datasetRegistryAbi,
    functionName: "datasetCount",
  })) as bigint;
  return Number(count);
}
