/**
 * The flow and gyro traces for one episode.
 *
 * product-spec §6.3 asks for them overlaid, and demo scene 3 turns on the two
 * lines visibly diverging when footage and motion do not belong together. The
 * correlation percentage is the claim; this is what lets someone check it.
 */

import { readTraces } from "@/lib/market/blobs";

export async function GET(_request: Request, context: RouteContext<"/api/episodes/[id]/traces">) {
  const { id } = await context.params;
  const traces = await readTraces(id);

  if (!traces) {
    return Response.json({ error: "No traces for that episode." }, { status: 404 });
  }
  return Response.json({ traces });
}
