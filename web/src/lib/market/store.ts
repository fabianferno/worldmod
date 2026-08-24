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
  submitEpisode(submission: EpisodeSubmission): Promise<StoredEpisode>;
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

  async submitEpisode(submission) {
    return enqueue(async () => {
      const snapshot = await read();
      const bounty = snapshot.bounties.find((b) => b.bounty_id === submission.bounty_id);
      if (!bounty) throw new Error(`Unknown bounty ${submission.bounty_id}.`);

      // Idempotent on episode_id: a retried upload must not pay twice.
      const existing = snapshot.episodes.find((e) => e.episode_id === submission.episode_id);
      if (existing) return existing;

      const decision = evaluateEpisode(bounty, submission);
      const stored: StoredEpisode = {
        ...submission,
        accepted: decision.accepted,
        reasons: decision.reasons,
        paid_usdc: decision.paid_usdc,
        received_at: Math.floor(Date.now() / 1000),
      };

      snapshot.episodes = [stored, ...snapshot.episodes];
      await write(snapshot);
      return stored;
    });
  },
};
