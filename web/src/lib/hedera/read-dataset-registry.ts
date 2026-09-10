/**
 * Reads one DatasetRegistry.Dataset live off whichever chain `config.ts` is
 * currently pointed at — the input dataset-to-bond.ts maps from. No stored
 * copy: this is what makes the bridge real rather than two features that
 * happen to agree on some numbers.
 *
 * Was `read-sepolia-dataset.ts` before the Sepolia-to-Hedera migration.
 * Renamed rather than left claiming a chain it no longer reads — this
 * module has no chain config of its own (it imports `publicClient`/
 * `ADDRESSES` from `lib/chain/relay.ts`/`config.ts`), so it silently
 * started reading Hedera's DatasetRegistry the moment `config.ts` did,
 * without a single line here changing. See hedera/README.md's rewritten
 * "one registry, two token layers" section for what that means for the ATS
 * Bond feature this module feeds.
 */

import { publicClient } from "@/lib/chain/relay";
import { ADDRESSES } from "@/lib/chain/config";
import { datasetRegistryAbi } from "@/lib/chain/abi";
import type { RegistryDataset } from "./dataset-to-bond";

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
