/**
 * Relay a contributor's signed episode onto the chain.
 *
 * The phone signs; this pays. Nothing here can change what was signed — the
 * contracts recover the signer from the signature and attribute the episode to
 * them, so a dishonest relayer can withhold a submission but cannot steal or
 * alter one.
 *
 * Called after an episode has been scored, and the score it records on-chain is
 * read from storage rather than taken from the request: a client that could
 * post its own validation score would make the validator ornamental.
 */

import { fileStore } from "@/lib/market/store";
import { CHAIN, chainEnabled } from "@/lib/chain/config";
import { anchorEpisode, type RelayedSignatures } from "@/lib/chain/relay";

/** Trust levels as EpisodeRegistry's enum orders them. */
const TRUST_LEVELS = ["self_reported", "heuristic", "attested", "hardware"];

export async function POST(request: Request) {
  if (!chainEnabled()) {
    return Response.json({ error: "Anchoring is not configured." }, { status: 501 });
  }

  let body: { episodeId?: string; signed?: RelayedSignatures };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body is not valid JSON." }, { status: 400 });
  }

  const { episodeId, signed } = body;
  if (!episodeId || !signed?.contributor || !signed.episode) {
    return Response.json({ error: "episodeId and signed episode are required." }, { status: 400 });
  }

  const episodes = await fileStore.listEpisodes();
  const episode = episodes.find((e) => e.episode_id === episodeId);
  if (!episode) return Response.json({ error: "No such episode." }, { status: 404 });
  if (episode.status !== "scored") {
    return Response.json({ error: "Only a scored episode can be anchored." }, { status: 409 });
  }
  if (episode.anchor?.onchain_episode_id) {
    return Response.json({ anchor: episode.anchor, alreadyAnchored: true });
  }

  // The manifest hash the chain commits to is the one the server verified from
  // the uploaded bytes, never one supplied alongside the signature.
  if (signed.episode.manifestHash.toLowerCase() !== episode.manifest_hash.toLowerCase()) {
    return Response.json(
      { error: "Signed manifest hash does not match the stored episode." },
      { status: 422 },
    );
  }

  const scoreBps = Math.round((episode.validation?.plausibility_score ?? 0) * 10_000);
  const trustLevel = Math.max(0, TRUST_LEVELS.indexOf(episode.trust_level));

  const result = await anchorEpisode(signed, { scoreBps, trustLevel });

  const anchor = {
    chain_id: CHAIN.id,
    onchain_episode_id: result.episodeId,
    contributor: signed.contributor,
    txs: result.txs.map((t) => ({ step: t.step, hash: t.hash })),
    anchored_at: Math.floor(Date.now() / 1000),
    error: result.ok ? undefined : result.error,
  };

  await fileStore.recordAnchor(episodeId, anchor);

  return Response.json({ anchor }, { status: result.ok ? 200 : 502 });
}
