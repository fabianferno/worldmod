/**
 * Serves the bytes of an episode a buyer has paid for.
 *
 * Without this the marketplace does not function as one: a buyer could escrow
 * funds, accept an episode, pay for it, and still have no way to obtain the
 * video. Scores and a manifest hash are not the product.
 *
 * Access is gated on acceptance. product-spec §7 ships a single licence in the
 * MVP — commercial training, one-time — and acceptance is what grants it. An
 * episode that was rejected was never paid for and is not licensed.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { fileStore } from "@/lib/market/store";

const CONTENT_TYPES: Record<string, string> = {
  rgb: "video/webm",
  imu: "application/octet-stream",
  audio: "audio/webm",
};

export async function GET(request: Request, ctx: RouteContext<"/api/episodes/[id]/stream">) {
  const { id } = await ctx.params;
  const kind = new URL(request.url).searchParams.get("kind") ?? "rgb";

  const episode = (await fileStore.listEpisodes()).find((e) => e.episode_id === id);
  if (!episode) return Response.json({ error: "No such episode." }, { status: 404 });

  if (!episode.accepted) {
    return Response.json(
      { error: "This episode was not accepted, so it carries no licence." },
      { status: 403 },
    );
  }

  const stream = episode.streams?.find((s) => s.kind === kind);
  if (!stream) {
    return Response.json({ error: `Episode has no ${kind} stream.` }, { status: 404 });
  }

  // The store records a file:// URI; resolve it rather than concatenating
  // paths, so a crafted kind or id cannot walk out of the episode directory.
  let path: string;
  try {
    path = fileURLToPath(stream.uri);
  } catch {
    return Response.json({ error: "Stream is not locally readable." }, { status: 404 });
  }

  try {
    const info = await stat(path);
    const body = Readable.toWeb(createReadStream(path)) as ReadableStream;

    return new Response(body, {
      headers: {
        "content-type": CONTENT_TYPES[kind] ?? "application/octet-stream",
        "content-length": String(info.size),
        "content-disposition": `attachment; filename="${id}-${kind}"`,
        // Licensed data must never be cached by a shared proxy.
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return Response.json({ error: "Stream bytes are missing on disk." }, { status: 410 });
  }
}
