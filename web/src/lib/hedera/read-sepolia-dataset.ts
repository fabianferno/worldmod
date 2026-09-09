/**
 * Reads one Sepolia DatasetRegistry.Dataset live off the chain — the input
 * dataset-to-bond.ts maps from. No stored copy: this is what makes the
 * bridge real rather than two features that happen to agree on some numbers.
 */

import { publicClient } from "@/lib/chain/relay";
import { ADDRESSES } from "@/lib/chain/config";
import { datasetRegistryAbi } from "@/lib/chain/abi";
import type { SepoliaDataset } from "./dataset-to-bond";

export async function readSepoliaDataset(datasetId: number): Promise<SepoliaDataset> {
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

export async function sepoliaDatasetCount(): Promise<number> {
  const count = (await publicClient.readContract({
    address: ADDRESSES.datasetRegistry,
    abi: datasetRegistryAbi,
    functionName: "datasetCount",
  })) as bigint;
  return Number(count);
}
