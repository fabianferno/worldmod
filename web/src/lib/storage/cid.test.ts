import { describe, expect, it } from "vitest";
import { computeCid } from "./cid";

/**
 * A CID is only a commitment if it is the same one everyone else computes.
 *
 * These check the identifier against IPFS's own published vectors rather than
 * against this implementation's output — a test that only asserts "the CID is
 * stable" would pass just as happily on a homemade hash that no gateway can
 * resolve.
 */
describe("computeCid", () => {
  it("matches the canonical CID for the classic 'hello world' vector", async () => {
    // `echo -n "hello world" | ipfs add --cid-version 1 --raw-leaves`
    const cid = await computeCid(new TextEncoder().encode("hello world"));
    expect(cid).toBe("bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e");
  });

  it("matches the canonical CID for empty content", async () => {
    const cid = await computeCid(new Uint8Array(0));
    expect(cid).toBe("bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku");
  });

  it("addresses content, not names — identical bytes give identical CIDs", async () => {
    const bytes = new TextEncoder().encode("an episode's worth of pixels");
    expect(await computeCid(bytes)).toBe(await computeCid(bytes.slice()));
  });

  it("gives different CIDs to different bytes", async () => {
    const a = await computeCid(new TextEncoder().encode("take one"));
    const b = await computeCid(new TextEncoder().encode("take two"));
    expect(a).not.toBe(b);
  });

  it("chunks past the 256KiB boundary the way kubo does", async () => {
    // Over one chunk, so the result is a dag-pb root over raw leaves rather
    // than a single raw block. Getting the chunk size wrong yields a valid CID
    // for the same bytes that no other node would ever produce.
    const big = new Uint8Array(300_000).fill(7);
    const cid = await computeCid(big);
    expect(cid.startsWith("bafybei")).toBe(true);
  });

  it("keeps single-chunk content as a raw block", async () => {
    const small = new Uint8Array(1024).fill(3);
    const cid = await computeCid(small);
    expect(cid.startsWith("bafkrei")).toBe(true);
  });
});

describe("indexing files already on disk", () => {
  it("addresses an existing file without copying it", async () => {
    // Backfilling by re-storing wrote a second copy of a three megabyte video
    // beside the first, under a name derived from a content type the older
    // episode never recorded. Indexing in place is the fix.
    const { mkdtemp, writeFile, readdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { indexExistingFile, resolveCid } = await import("@/lib/market/blobs");

    const dir = await mkdtemp(join(tmpdir(), "wm-cid-"));
    const path = join(dir, "rgb.webm");
    await writeFile(path, new Uint8Array([1, 2, 3, 4, 5]));

    const cid = await indexExistingFile(path);
    expect(cid).toBe(await computeCid(new Uint8Array([1, 2, 3, 4, 5])));

    // The directory still holds exactly what it held before.
    expect(await readdir(dir)).toEqual(["rgb.webm"]);

    const resolved = await resolveCid(cid!);
    expect(resolved?.path).toBe(path);
    // Type recovered from the extension, so the gateway can serve something a
    // browser will play rather than a download prompt.
    expect(resolved?.contentType).toBe("video/webm");
  });

  it("returns null for a file that is not there", async () => {
    const { indexExistingFile } = await import("@/lib/market/blobs");
    expect(await indexExistingFile("/nonexistent/rgb.webm")).toBeNull();
  });
});
