import { buildRpContext } from "@/lib/world/rp-context";

export async function POST(request: Request) {
  let body: { action?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body is not valid JSON." }, { status: 400 });
  }
  if (typeof body.action !== "string" || body.action.length === 0) {
    return Response.json({ error: "action is required." }, { status: 400 });
  }

  const { context, mock } = buildRpContext(body.action);
  return Response.json({ rp_context: context, mock });
}
