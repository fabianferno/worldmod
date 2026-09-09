/**
 * A minimal replacement for the unused Graph Protocol subgraph
 * (`subgraph/`), scoped to what product-spec §6.1 actually asks for: "lineage
 * — episode → dataset → training run → model, as a queryable graph." The
 * subgraph never got wired into `web/` even when it indexed Sepolia, so this
 * is new work either way, not a port — and it has to be new work, since
 * Hedera's mirror node has no subgraph-equivalent: no custom mapping
 * handlers, no derived-entity schema, no joins. What it has is
 * `GET /contracts/{id}/results/logs` — raw, paginated EVM event logs,
 * confirmed live and real by fetching this project's own first Hedera
 * registration event through it (not a synthetic test).
 *
 * The join happens here, in memory, client-side of the mirror node: fetch
 * each contract's relevant logs, decode them against the same ABIs
 * `lib/chain/abi.ts` already defines for reading state, and match episode
 * ids across `EpisodeSubmitted`/`ValidationRecorded`/`DatasetMinted` the way
 * `subgraph/src/*.ts`'s AssemblyScript mappings do on-chain-indexer side —
 * that file is the reference for which events matter and how they relate,
 * even though the mechanism here is fundamentally different (a live fetch
 * per call, not a persistent index).
 *
 * Scoped deliberately narrow: episode → validation → dataset membership,
 * the core of §6.1's chain. Bounty payout and federated-round lineage are
 * the same pattern, not built here — this proves the approach works against
 * real Hedera log data, not a complete parity port of six subgraph entities.
 */

import { decodeEventLog, type Log } from "viem";
import { ACTIVE_CHAIN, ADDRESSES } from "@/lib/chain/config";

const MIRROR_NODE =
  ACTIVE_CHAIN === "hedera" ? "https://testnet.mirrornode.hedera.com/api/v1" : null;

const episodeSubmittedEvent = {
  type: "event",
  name: "EpisodeSubmitted",
  inputs: [
    { name: "episodeId", type: "uint256", indexed: true },
    { name: "assetId", type: "uint256", indexed: true },
    { name: "contributor", type: "address", indexed: true },
    { name: "manifestHash", type: "bytes32", indexed: false },
  ],
} as const;

const validationRecordedEvent = {
  type: "event",
  name: "ValidationRecorded",
  inputs: [
    { name: "episodeId", type: "uint256", indexed: true },
    { name: "scoreBps", type: "uint16", indexed: false },
    { name: "trustLevel", type: "uint8", indexed: false },
    { name: "validator", type: "address", indexed: false },
  ],
} as const;

const datasetMintedEvent = {
  type: "event",
  name: "DatasetMinted",
  inputs: [
    { name: "datasetId", type: "uint256", indexed: true },
    { name: "creator", type: "address", indexed: true },
    { name: "episodeCount", type: "uint32", indexed: false },
    { name: "episodesRoot", type: "bytes32", indexed: false },
  ],
} as const;

interface MirrorLog {
  data: `0x${string}`;
  topics: `0x${string}`[];
  transaction_hash: `0x${string}`;
  timestamp: string;
}

async function fetchLogs(contractAddress: string): Promise<MirrorLog[]> {
  if (!MIRROR_NODE) return []; // Sepolia has no mirror node — this module is Hedera-only.
  const logs: MirrorLog[] = [];
  let url: string | null = `${MIRROR_NODE}/contracts/${contractAddress}/results/logs?order=asc&limit=100`;
  while (url) {
    const res: Response = await fetch(url);
    if (!res.ok) break;
    const data: { logs: MirrorLog[]; links?: { next?: string | null } } = await res.json();
    logs.push(...data.logs);
    url = data.links?.next ? `https://testnet.mirrornode.hedera.com${data.links.next}` : null;
  }
  return logs;
}

function decode<T>(abiEvent: object, log: MirrorLog): T | null {
  try {
    const decoded = decodeEventLog({
      abi: [abiEvent],
      data: log.data,
      topics: log.topics as Log["topics"],
    });
    return decoded.args as T;
  } catch {
    return null; // A log this ABI doesn't match — expected, other events share the contract.
  }
}

export interface EpisodeLineage {
  episodeId: string;
  assetId: string;
  contributor: string;
  manifestHash: string;
  submittedTx: string;
  validation: { scoreBps: number; trustLevel: number; validator: string; validatedTx: string } | null;
}

/**
 * §6.1's "episode → dataset" edge, read live from EpisodeRegistry's own
 * event log — no stored copy, same principle `read-dataset-registry.ts`
 * already follows for state reads.
 */
export async function episodeLineage(): Promise<EpisodeLineage[]> {
  const logs = await fetchLogs(ADDRESSES.episodeRegistry);

  const submissions = new Map<string, EpisodeLineage>();
  for (const log of logs) {
    const submitted = decode<{ episodeId: bigint; assetId: bigint; contributor: string; manifestHash: string }>(
      episodeSubmittedEvent,
      log,
    );
    if (submitted) {
      submissions.set(submitted.episodeId.toString(), {
        episodeId: submitted.episodeId.toString(),
        assetId: submitted.assetId.toString(),
        contributor: submitted.contributor,
        manifestHash: submitted.manifestHash,
        submittedTx: log.transaction_hash,
        validation: null,
      });
      continue;
    }
    const validated = decode<{ episodeId: bigint; scoreBps: number; trustLevel: number; validator: string }>(
      validationRecordedEvent,
      log,
    );
    if (validated) {
      const entry = submissions.get(validated.episodeId.toString());
      if (entry) {
        entry.validation = {
          scoreBps: validated.scoreBps,
          trustLevel: validated.trustLevel,
          validator: validated.validator,
          validatedTx: log.transaction_hash,
        };
      }
    }
  }
  return [...submissions.values()];
}

export interface DatasetMintedEvent {
  datasetId: string;
  creator: string;
  episodeCount: number;
  episodesRoot: string;
  mintedTx: string;
}

/** §6.1's "dataset" node — which episodes bundle roots have actually been minted. */
export async function datasetMints(): Promise<DatasetMintedEvent[]> {
  const logs = await fetchLogs(ADDRESSES.datasetRegistry);
  const minted: DatasetMintedEvent[] = [];
  for (const log of logs) {
    const decoded = decode<{ datasetId: bigint; creator: string; episodeCount: number; episodesRoot: string }>(
      datasetMintedEvent,
      log,
    );
    if (decoded) {
      minted.push({
        datasetId: decoded.datasetId.toString(),
        creator: decoded.creator,
        episodeCount: decoded.episodeCount,
        episodesRoot: decoded.episodesRoot,
        mintedTx: log.transaction_hash,
      });
    }
  }
  return minted;
}
