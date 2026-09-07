import { fileStore } from "@/lib/market/store";

export async function GET(_request: Request, ctx: RouteContext<"/api/bounties/[id]">) {
  const { id } = await ctx.params;

  const bounty = await fileStore.getBounty(id);
  if (!bounty) return Response.json({ error: "No such bounty." }, { status: 404 });

  return Response.json({ bounty, episodes: await fileStore.listEpisodes(id) });
}
