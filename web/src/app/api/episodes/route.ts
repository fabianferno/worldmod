import { fileStore } from "@/lib/market/store";
import type { EpisodeSubmission } from "@/lib/market/types";

export async function GET(request: Request) {
  const bountyId = new URL(request.url).searchParams.get("bounty") ?? undefined;
  return Response.json({ episodes: await fileStore.listEpisodes(bountyId) });
}

export async function POST(request: Request) {
  let body: EpisodeSubmission;
  try {
    body = (await request.json()) as EpisodeSubmission;
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  if (!body.episode_id || !body.bounty_id || !body.manifest_hash) {
    return Response.json(
      { error: "episode_id, bounty_id and manifest_hash are required." },
      { status: 400 },
    );
  }

  // The commitment is a SHA-256 hex digest; anything else did not come from
  // the capture client's sealing path.
  if (!/^0x[0-9a-f]{64}$/.test(body.manifest_hash)) {
    return Response.json({ error: "manifest_hash is not a SHA-256 digest." }, { status: 400 });
  }

  try {
    const episode = await fileStore.submitEpisode(body);
    return Response.json({ episode }, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
