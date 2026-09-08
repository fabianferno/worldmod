/**
 * Episode byte storage.
 *
 * Bytes land under .data/episodes/<episode_id>/ where they can be inspected,
 * played and fed to the trainer without a gateway, and every stream also gets
 * a real IPFS CID (see lib/storage/cid).
 *
 * The CID is the part that matters to §5 and §10.2. It is computed with kubo's
 * own chunking, so anyone holding the video derives the same identifier and can
 * check that the chain points at the footage they were handed. That makes the
 * address a commitment rather than a filename, which a path on one laptop could
 * never be.
 *
 * Whether those bytes are reachable by a stranger is a separate question, and
 * the code keeps it separate: an unpinned CID is a correct address that only
 * this node can currently serve. See lib/storage/pin.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { computeCid } from "@/lib/storage/cid";
import { daemonUp, pinBytes } from "@/lib/storage/pin";

/**
 * CID to file, so the gateway can serve an address without knowing which
 * episode it belongs to — which is the point of content addressing.
 */
const INDEX = join(process.cwd(), ".data", "cids.json");

async function readIndex(): Promise<Record<string, { path: string; contentType?: string }>> {
  if (!existsSync(INDEX)) return {};
  try {
    return JSON.parse(await readFile(INDEX, "utf8"));
  } catch {
    return {};
  }
}

async function appendIndex(cid: string, path: string, contentType?: string): Promise<void> {
  const index = await readIndex();
  index[cid] = { path, contentType };
  await writeFile(INDEX, JSON.stringify(index, null, 2));
}

/** The media type implied by a stored file's extension. */
function contentTypeFromPath(path: string): string | undefined {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  for (const [type, extension] of Object.entries(EXTENSIONS)) {
    if (extension === ext) return type;
  }
  return undefined;
}

/**
 * Give a file already on disk its content address.
 *
 * For episodes recorded before addressing existed. Indexes in place rather than
 * re-storing: writing the bytes again under a freshly derived name left a
 * second copy of a three megabyte video beside the first, which is how this
 * function came to exist.
 */
export async function indexExistingFile(path: string): Promise<string | null> {
  if (!existsSync(path)) return null;
  try {
    const bytes = new Uint8Array(await readFile(path));
    const cid = await computeCid(bytes);
    await appendIndex(cid, path, contentTypeFromPath(path));
    return cid;
  } catch {
    return null;
  }
}

/** Where the bytes for a content address live, if this node holds them. */
export async function resolveCid(
  cid: string,
): Promise<{ path: string; contentType?: string } | null> {
  if (!/^ba[a-z0-9]{20,}$/.test(cid)) return null;
  return (await readIndex())[cid] ?? null;
}

export interface StoredStream {
  kind: string;
  uri: string;
  bytes: number;
  /** Content address. The same bytes always produce this, on any IPFS node. */
  cid?: string;
  /**
   * Whether an IPFS node was asked to hold these bytes.
   *
   * Distinct from having a CID. An unpinned CID is a correct address that only
   * this server can resolve; a pinned one is on a node that announces it to the
   * network. Neither is a durability guarantee, and the field exists so the
   * difference is visible rather than assumed.
   */
  pinned?: boolean;
  /**
   * The container the bytes are actually in, taken from the sealed manifest.
   * An iPhone records MP4 and an Android WebM, so this cannot be assumed from
   * the stream kind — a buyer downloading an episode must be told the truth
   * about what they are receiving.
   */
  content_type?: string;
}

const ROOT = join(process.cwd(), ".data", "episodes");

/** By container, not by kind: Safari gives MP4 where Chromium gives WebM. */
const EXTENSIONS: Record<string, string> = {
  "video/webm": "webm",
  "video/mp4": "mp4",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "application/octet-stream": "bin",
};

/** Strips the `;codecs=...` parameter, leaving the container's media type. */
export function baseContentType(
  contentType: string | undefined | null,
): string {
  return (contentType ?? "").split(";")[0].trim().toLowerCase();
}

export function extensionFor(contentType: string | undefined | null): string {
  return EXTENSIONS[baseContentType(contentType)] ?? "bin";
}

/**
 * The stored path for a stream, whatever container it landed in.
 *
 * Anything reading episodes off disk must go through this rather than assuming
 * `rgb.webm` — an iPhone's episode is `rgb.mp4`, and a hardcoded extension
 * silently skips it instead of failing.
 */
export function resolveStreamPath(
  episodeDir: string,
  kind: string,
): string | null {
  const candidates = [...new Set(Object.values(EXTENSIONS))];
  for (const ext of candidates) {
    const path = join(episodeDir, `${kind}.${ext}`);
    if (existsSync(path)) return path;
  }
  return null;
}

export async function storeStream(
  episodeId: string,
  kind: string,
  bytes: Uint8Array,
  contentType?: string,
): Promise<StoredStream> {
  // Episode ids are generated by the client; never let one escape the store.
  if (!/^ep_[0-9a-f]{8,64}$/.test(episodeId)) {
    throw new Error(
      `Refusing to store under a malformed episode id: ${episodeId}`,
    );
  }
  if (!/^[a-z]{1,16}$/.test(kind)) {
    throw new Error(`Refusing to store a malformed stream kind: ${kind}`);
  }

  const dir = join(ROOT, episodeId);
  await mkdir(dir, { recursive: true });

  const name = `${kind}.${extensionFor(contentType)}`;
  await writeFile(join(dir, name), bytes);

  // Computed from the bytes that were actually stored, never from what the
  // client claimed they would be.
  let cid: string | undefined;
  let pinned = false;
  try {
    cid = await computeCid(bytes);
    await appendIndex(cid, join(dir, name), contentType);

    // Best effort, and never on the upload's critical path for correctness:
    // an episode that is addressed but unpinned is the state the system is
    // already in, and a missing daemon must not fail a capture.
    if (await daemonUp()) {
      const result = await pinBytes(bytes, name, cid);
      pinned = result.ok;
    }
  } catch {
    // A missing CID degrades addressing, not storage. The episode is on disk
    // and playable either way.
  }

  return {
    kind,
    uri: `file://${join(dir, name)}`,
    bytes: bytes.byteLength,
    cid,
    pinned,
    content_type: contentType,
  };
}

/**
 * Store an episode's aligned flow/gyro traces.
 *
 * Kept beside the streams rather than inside market.json: the store is read
 * and rewritten on every marketplace operation, and a hundred and sixty points
 * per episode would turn a small index into a large one for data only one
 * screen ever reads.
 */
export async function storeTraces(episodeId: string, traces: unknown): Promise<void> {
  if (!/^ep_[0-9a-f]{8,64}$/.test(episodeId)) {
    throw new Error(`Refusing to store under a malformed episode id: ${episodeId}`);
  }
  const dir = join(ROOT, episodeId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "traces.json"), JSON.stringify(traces));
}

export async function readTraces(episodeId: string): Promise<unknown | null> {
  if (!/^ep_[0-9a-f]{8,64}$/.test(episodeId)) return null;
  const path = join(ROOT, episodeId, "traces.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}
