import "server-only";

/**
 * Selfie Check verification records — a badge, not a gate.
 *
 * Mirrors lib/market/store.ts's shape (file-backed JSON, serialized writes):
 * inspectable when something looks wrong on stage, not a database this demo
 * doesn't need. Keyed by the contributor's signing address, same identity
 * reputation.ts already keys off, so a verification shows up next to the
 * same address a payout goes to.
 *
 * What this records is that World App returned a completed Selfie Check
 * response for this address — not an independently checked zk-proof. The
 * response's `proof` field is "compatible with WorldIDVerifier.sol" per the
 * SDK's own type comments, but neither a deployed verifier address nor a JS
 * helper to call it is documented anywhere this project found; see
 * world/FEEDBACK.md. Recording without that check is the honest scope of
 * what a Beta-access-gated integration can do right now — flagged, not
 * hidden.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface SelfieVerification {
  address: `0x${string}`;
  verifiedAt: number;
  nullifier: string;
  /** True when World's sandbox/mock RP context was used — see rp-context.ts. */
  mock: boolean;
}

const DATA_PATH = join(process.cwd(), ".data", "world-verifications.json");

let writeQueue: Promise<unknown> = Promise.resolve();

async function read(): Promise<Record<string, SelfieVerification>> {
  try {
    const raw = await readFile(DATA_PATH, "utf8");
    return JSON.parse(raw) as Record<string, SelfieVerification>;
  } catch {
    return {};
  }
}

async function write(records: Record<string, SelfieVerification>): Promise<void> {
  await mkdir(dirname(DATA_PATH), { recursive: true });
  await writeFile(DATA_PATH, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(task, task);
  writeQueue = next.catch(() => {});
  return next;
}

export async function recordSelfieVerification(v: SelfieVerification): Promise<void> {
  await enqueue(async () => {
    const records = await read();
    records[v.address.toLowerCase()] = v;
    await write(records);
  });
}

export async function getSelfieVerification(
  address: string,
): Promise<SelfieVerification | null> {
  const records = await read();
  return records[address.toLowerCase()] ?? null;
}
