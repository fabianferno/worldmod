/**
 * Reads one Sepolia DatasetRegistry.Dataset live from the chain — the input
 * datasetToBondRequest() maps from. No hardcoded values: this is what makes
 * issue-dataset-bond.mjs a real bridge between the two chains rather than a
 * script that happens to reproduce numbers copied in by hand once.
 */

import { ethers } from "ethers";

const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const DATASET_REGISTRY = "0x1df8feDf50394A9e0f78cb0EF8F187D587812cbB";

const ABI = [
  "function getDataset(uint256) view returns (tuple(address creator, uint96 priceUsdc, bytes32 episodesRoot, uint32 episodeCount, uint64 mintedAt, string license, string metadataURI))",
];

export async function readSepoliaDataset(datasetId) {
  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const registry = new ethers.Contract(DATASET_REGISTRY, ABI, provider);
  const d = await registry.getDataset(datasetId);

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

export { DATASET_REGISTRY };
