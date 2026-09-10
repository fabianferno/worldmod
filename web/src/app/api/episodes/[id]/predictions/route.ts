/**
 * The live world-model prediction sequence for one episode.
 *
 * `prediction-panel.tsx` shows the model's running guess during recording,
 * then unmounts the moment the take ends — without a saved copy, that guess
 * is gone before the result screen ever renders. The client posts what it
 * captured live once recording stops (`POST`); the result screen fetches it
 * back (`GET`) to show it after the fact.
 */

import { readPredictions, storePredictions } from "@/lib/market/blobs";

interface PredictionEntry {
  t: number;
  distance: number;
  warming: boolean;
  thumbnail: string;
}

const MAX_ENTRIES = 120;

export async function GET(_request: Request, context: RouteContext<"/api/episodes/[id]/predictions">) {
  const { id } = await context.params;
  const predictions = await readPredictions(id);

  if (!predictions) {
    return Response.json({ error: "No saved predictions for that episode." }, { status: 404 });
  }
  return Response.json({ predictions });
}

export async function POST(request: Request, context: RouteContext<"/api/episodes/[id]/predictions">) {
  const { id } = await context.params;

  let body: { predictions?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  if (!Array.isArray(body.predictions)) {
    return Response.json({ error: "predictions must be an array." }, { status: 400 });
  }

  // Trusted only as far as shape — this is a live capture artifact, not
  // something acceptance or payment depends on, so a malformed entry just
  // gets dropped rather than failing the whole save.
  const clean: PredictionEntry[] = body.predictions
    .filter(
      (p): p is PredictionEntry =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as PredictionEntry).t === "number" &&
        typeof (p as PredictionEntry).distance === "number" &&
        typeof (p as PredictionEntry).warming === "boolean" &&
        typeof (p as PredictionEntry).thumbnail === "string" &&
        (p as PredictionEntry).thumbnail.startsWith("data:image/"),
    )
    .slice(0, MAX_ENTRIES);

  try {
    await storePredictions(id, clean);
  } catch {
    return Response.json({ error: "Could not save predictions." }, { status: 400 });
  }

  return Response.json({ ok: true, count: clean.length });
}
