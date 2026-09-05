/**
 * Content addressing for episode streams.
 *
 * product-spec §5's schema gives every stream a `cid` and §10.2 puts the bytes
 * in content-addressed storage. Until now an episode's on-chain storageURI was
 * a path on one laptop — truthful, and worthless to anyone else, which makes
 * the provenance graph unfollowable by exactly the people it exists to
 * convince.
 *
 * The CID computed here is a real one. It uses the UnixFS importer with kubo's
 * default chunking, so the identifier for a given file is the same one any IPFS
 * node would derive from the same bytes: anyone holding the video can recompute
 * it and check that the chain points at the footage they were given. That
 * property is what makes the address a commitment rather than a filename, and
 * it holds whether or not the bytes are pinned anywhere.
 *
 * Pinning is separate and optional — see pin.ts. A CID that nothing has pinned
 * is still a correct address; it is simply not yet resolvable by a stranger,
 * and the code says which of the two situations it is in rather than emitting
 * an ipfs:// URI it cannot back.
 */

import { MemoryBlockstore } from "blockstore-core/memory";
import { importer } from "ipfs-unixfs-importer";

/**
 * kubo's defaults, matched deliberately.
 *
 * A CID depends on chunk size, layout and codec as much as on the bytes, so a
 * different chunker produces a different — equally valid, and useless —
 * identifier for identical content. 262144 is the default chunk, balanced
 * dag-pb the default layout.
 */
const CHUNK_SIZE = 262_144;

export async function computeCid(bytes: Uint8Array): Promise<string> {
  const blockstore = new MemoryBlockstore();

  let cid = "";
  for await (const entry of importer(
    [{ content: bytes }],
    blockstore,
    { cidVersion: 1, rawLeaves: true, chunker: fixedSize(CHUNK_SIZE) },
  )) {
    cid = entry.cid.toString();
  }

  if (!cid) throw new Error("The importer produced no CID.");
  return cid;
}

/** The importer takes a chunker as an async generator over the byte stream. */
function fixedSize(size: number) {
  return async function* chunker(source: AsyncIterable<Uint8Array>) {
    let buffer = new Uint8Array(0);
    let emitted = false;

    for await (const chunk of source) {
      const merged = new Uint8Array(buffer.length + chunk.length);
      merged.set(buffer);
      merged.set(chunk, buffer.length);
      buffer = merged;

      while (buffer.length >= size) {
        yield buffer.subarray(0, size);
        buffer = buffer.subarray(size);
        emitted = true;
      }
    }

    // Empty content is a single empty block, not the absence of one — kubo
    // gives the empty file a CID, and yielding nothing here produced none.
    if (buffer.length > 0 || !emitted) yield buffer;
  };
}
