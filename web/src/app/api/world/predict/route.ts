/**
 * Live prediction, one frame at a time.
 *
 * Binary in, binary out — the same shape as the IPFS gateway (see
 * app/ipfs/[cid]/route.ts) rather than JSON+base64, because this runs every
 * few hundred milliseconds for the length of a take and base64 would inflate
 * both directions by a third for no benefit.
 *
 * Every failure here degrades to "no overlay" rather than interrupting
 * capture: this endpoint is additive on top of a recording flow that already
 * works without it, the same way anchoring and pinning are additive on top of
 * an episode that is already scored and payable without them.
 */

import { predictNext, THUMBNAIL_SIZE } from "@/lib/worldmodel/predict";
import { liveMeta, liveModelAvailable } from "@/lib/worldmodel/live-model";

/**
 * What the client needs before it can stream anything: whether a model is
 * even exported, and the two dimensions it has to match — the square crop
 * size a frame must be sent at, and the thumbnail size it will get back.
 * Reading these here rather than hardcoding them client-side means a
 * retrained model with a different `size` just works on the next capture.
 */
export async function GET() {
  if (!liveModelAvailable()) {
    return Response.json({ available: false });
  }
  const meta = await liveMeta();
  return Response.json({
    available: true,
    size: meta.size,
    thumbnailSize: THUMBNAIL_SIZE,
    heldoutError: meta.heldoutError,
    baselineError: meta.baselineError,
  });
}

export async function POST(request: Request) {
  if (!liveModelAvailable()) {
    return Response.json({ error: "No live model has been exported yet." }, { status: 501 });
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session");
  if (!sessionId) {
    return Response.json({ error: "A session id is required." }, { status: 400 });
  }

  const motion = ["ax", "ay", "az", "rx", "ry", "rz"].map((key) => {
    const value = Number(url.searchParams.get(key));
    return Number.isFinite(value) ? value : 0;
  });

  const meta = await liveMeta();
  const rgb = new Uint8Array(await request.arrayBuffer());
  const expected = meta.size * meta.size * 3;
  if (rgb.length !== expected) {
    return Response.json(
      { error: `Expected ${expected} bytes of ${meta.size}x${meta.size} RGB, got ${rgb.length}.` },
      { status: 400 },
    );
  }

  try {
    const result = await predictNext({ sessionId, rgb, motion });
    if (!result) {
      return Response.json({ error: "No live model has been exported yet." }, { status: 501 });
    }

    return new Response(new Uint8Array(result.thumbnail), {
      headers: {
        "content-type": "application/octet-stream",
        "x-thumbnail-size": String(result.thumbnailSize),
        "x-distance": String(result.distance),
        "x-bank-size": String(result.bankSize),
        "x-warming": String(result.warming),
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
