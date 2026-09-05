/**
 * A gateway for the content addresses this node holds.
 *
 * An episode's CID is a real IPFS identifier whether or not anything has
 * pinned it (see lib/storage/cid), but an identifier nobody can resolve does
 * not let a buyer — or a judge — follow the chain to the footage. This serves
 * the bytes by address, so a CID recorded on-chain leads somewhere.
 *
 * Addressed by content and not by episode on purpose: the whole property of a
 * CID is that it is checkable without trusting where it came from. Anyone can
 * fetch this and recompute the hash.
 */

import { readFile } from "node:fs/promises";
import { resolveCid } from "@/lib/market/blobs";

export async function GET(_request: Request, context: RouteContext<"/ipfs/[cid]">) {
  const { cid } = await context.params;

  const entry = await resolveCid(cid);
  if (!entry) {
    return Response.json(
      { error: "This node does not hold that content address." },
      { status: 404 },
    );
  }

  try {
    const bytes = await readFile(entry.path);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": entry.contentType ?? "application/octet-stream",
        // Content addressing means the bytes can never change under an address,
        // so this is one of the rare cases where forever is the honest answer.
        "cache-control": "public, max-age=31536000, immutable",
        "x-ipfs-cid": cid,
      },
    });
  } catch {
    return Response.json({ error: "The bytes for that address are missing." }, { status: 410 });
  }
}
