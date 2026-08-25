import { fileStore } from "@/lib/market/store";

/** One episode, so a client can watch for its score to land. */
export async function GET(_request: Request, ctx: RouteContext<"/api/episodes/[id]">) {
  const { id } = await ctx.params;

  const episode = (await fileStore.listEpisodes()).find((e) => e.episode_id === id);
  if (!episode) return Response.json({ error: "No such episode." }, { status: 404 });

  return Response.json({ episode });
}
