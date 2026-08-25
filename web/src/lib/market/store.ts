/**
 * Marketplace persistence.
 *
 * A file-backed store behind an interface. The contracts in product-spec §11
 * are the eventual source of truth for bounties, escrow and episode records;
 * nothing in the UI or the API routes should know the difference when they
 * arrive, so everything goes through `MarketStore`.
 *
 * Deliberately not a database: this holds a demo's worth of bounties and
 * episodes, and a JSON file is inspectable when something looks wrong on
 * stage.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { evaluateEpisode } from "./acceptance";
import { KEYBOARD_BOUNTY } from "./seed";
import type { Bounty, EpisodeSubmission, StoredEpisode } from "./types";

export interface MarketStore {
  listBounties(): Promise<Bounty[]>;
  getBounty(id: string): Promise<Bounty | null>;
  createBounty(bounty: Bounty): Promise<Bounty>;
  listEpisodes(bountyId?: string): Promise<StoredEpisode[]>;
  /** Record an upload that has not been scored yet. */
  acceptUpload(
    submission: EpisodeSubmission,
    streams?: StoredEpisode["streams"],
  ): Promise<StoredEpisode>;
  /** Apply the validator's findings and make the acceptance decision. */
  completeScoring(
    episodeId: string,
    submission: Partial<EpisodeSubmission>,
    validation: StoredEpisode["validation"],
  ): Promise<StoredEpisode | null>;
  failScoring(episodeId: string, reason: string): Promise<void>;
}

interface Snapshot {
  bounties: Bounty[];
  episodes: StoredEpisode[];
}

const DATA_PATH = join(process.cwd(), ".data", "market.json");

/** Serialises writes; concurrent submissions would otherwise clobber the file. */
let writeQueue: Promise<unknown> = Promise.resolve();

async function read(): Promise<Snapshot> {
  try {
    const raw = await readFile(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw) as Snapshot;
    return { bounties: parsed.bounties ?? [], episodes: parsed.episodes ?? [] };
  } catch {
    // First run: seed with the bounty the demo is built around.
    return { bounties: [KEYBOARD_BOUNTY], episodes: [] };
  }
}

async function write(snapshot: Snapshot): Promise<void> {
  await mkdir(dirname(DATA_PATH), { recursive: true });
  await writeFile(DATA_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(task, task);
  writeQueue = next.catch(() => {});
  return next;
}

export const fileStore: MarketStore = {
  async listBounties() {
    return (await read()).bounties;
  },

  async getBounty(id) {
    return (await read()).bounties.find((b) => b.bounty_id === id) ?? null;
  },

  async createBounty(bounty) {
    return enqueue(async () => {
      const snapshot = await read();
      snapshot.bounties = [bounty, ...snapshot.bounties.filter((b) => b.bounty_id !== bounty.bounty_id)];
      await write(snapshot);
      return bounty;
    });
  },

  async listEpisodes(bountyId) {
    const { episodes } = await read();
    return bountyId ? episodes.filter((e) => e.bounty_id === bountyId) : episodes;
  },

  async acceptUpload(submission, streams) {
    return enqueue(async () => {
      const snapshot = await read();
      const bounty = snapshot.bounties.find((b) => b.bounty_id === submission.bounty_id);
      if (!bounty) throw new Error(`Unknown bounty ${submission.bounty_id}.`);

      // Idempotent on episode_id: a retried upload must not be scored, or
      // paid, twice.
      const existing = snapshot.episodes.find((e) => e.episode_id === submission.episode_id);
      if (existing) return existing;

      const stored: StoredEpisode = {
        ...submission,
        status: "scoring",
        accepted: false,
        reasons: [],
        paid_usdc: 0,
        received_at: Math.floor(Date.now() / 1000),
        streams,
      };

      snapshot.episodes = [stored, ...snapshot.episodes];
      await write(snapshot);
      return stored;
    });
  },

  async completeScoring(episodeId, submission, validation) {
    return enqueue(async () => {
      const snapshot = await read();
      const index = snapshot.episodes.findIndex((e) => e.episode_id === episodeId);
      if (index < 0) return null;

      const episode = { ...snapshot.episodes[index], ...submission };
      const bounty = snapshot.bounties.find((b) => b.bounty_id === episode.bounty_id);
      if (!bounty) return null;

      const decision = evaluateEpisode(bounty, episode);

      // The validator's findings are gates in their own right: an episode that
      // fails integrity or duplicates prior work is not payable however well it
      // scored against the bounty's thresholds.
      const failures = validation?.failures ?? [];
      const reasons = [...decision.reasons, ...failures];
      const accepted = decision.accepted && failures.length === 0;

      const scored: StoredEpisode = {
        ...episode,
        status: "scored",
        accepted,
        reasons,
        paid_usdc: accepted ? decision.paid_usdc : 0,
        validation,
      };

      snapshot.episodes[index] = scored;
      await write(snapshot);
      return scored;
    });
  },

  async failScoring(episodeId, reason) {
    await enqueue(async () => {
      const snapshot = await read();
      const index = snapshot.episodes.findIndex((e) => e.episode_id === episodeId);
      if (index < 0) return;

      snapshot.episodes[index] = {
        ...snapshot.episodes[index],
        status: "failed",
        scoring_error: reason,
        reasons: ["Scoring failed on the server; this episode was not judged."],
      };
      await write(snapshot);
    });
  },
};
