/**
 * Pending-upload queue.
 *
 * Blobs land here the moment a recording stops, before any network call. A
 * dropped upload on bad wifi then costs a retry rather than a re-recording,
 * which matters because the wearer cannot re-run a take they have already
 * performed — the moment is gone.
 *
 * IndexedDB rather than memory: the queue has to survive a reload, a
 * backgrounded tab, and the browser reclaiming the page.
 */

import type { SealedEpisodeManifest } from "@/lib/manifest";
import type { EpisodeSubmission } from "@/lib/market/types";

const DB_NAME = "worldmod";
const DB_VERSION = 1;
const STORE = "pending_episodes";

export interface PendingEpisode {
  episode_id: string;
  manifest: SealedEpisodeManifest;
  submission: EpisodeSubmission;
  streams: Record<string, Blob>;
  queued_at: number;
  attempts: number;
  last_error: string | null;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "episode_id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable."));
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
        tx.oncomplete = () => db.close();
      }),
  );
}

export async function enqueueEpisode(
  entry: Omit<PendingEpisode, "queued_at" | "attempts" | "last_error">,
): Promise<void> {
  await run("readwrite", (store) =>
    store.put({ ...entry, queued_at: Date.now(), attempts: 0, last_error: null }),
  );
}

export async function listPending(): Promise<PendingEpisode[]> {
  const all = await run<PendingEpisode[]>("readonly", (store) => store.getAll());
  return all.sort((a, b) => a.queued_at - b.queued_at);
}

export async function removePending(episodeId: string): Promise<void> {
  await run("readwrite", (store) => store.delete(episodeId));
}

export async function recordAttempt(episodeId: string, error: string | null): Promise<void> {
  const existing = await run<PendingEpisode | undefined>("readonly", (store) =>
    store.get(episodeId),
  );
  if (!existing) return;

  await run("readwrite", (store) =>
    store.put({ ...existing, attempts: existing.attempts + 1, last_error: error }),
  );
}

export interface UploadResult {
  ok: boolean;
  episode?: unknown;
  error?: string;
}

/**
 * Send one queued episode, with its bytes.
 *
 * Multipart rather than JSON: the streams are megabytes of binary, and
 * base64-encoding them into JSON would inflate them by a third and force the
 * whole payload through a string.
 */
export async function uploadEpisode(entry: PendingEpisode): Promise<UploadResult> {
  const form = new FormData();
  form.set("manifest", JSON.stringify(entry.manifest));
  form.set("submission", JSON.stringify(entry.submission));
  for (const [kind, blob] of Object.entries(entry.streams)) form.set(kind, blob);

  try {
    const response = await fetch("/api/episodes", { method: "POST", body: form });
    const data = (await response.json()) as { episode?: unknown; error?: string };

    if (!response.ok) {
      await recordAttempt(entry.episode_id, data.error ?? `HTTP ${response.status}`);
      return { ok: false, error: data.error ?? `HTTP ${response.status}` };
    }

    // Only drop it from the queue once the server has it.
    await removePending(entry.episode_id);
    return { ok: true, episode: data.episode };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordAttempt(entry.episode_id, message);
    return { ok: false, error: message };
  }
}

/** Attempt every queued episode, oldest first. */
export async function flushQueue(): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  for (const entry of await listPending()) {
    const result = await uploadEpisode(entry);
    if (result.ok) sent++;
    else failed++;
  }

  return { sent, failed };
}
