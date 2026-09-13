/**
 * Records a Creditcoin ASC proof against the episode it settles.
 *
 * Called by the Attestcoin readability worker (github.com/Ashar20/attestcoin)
 * after it has proved this episode's `EpisodeAcceptedForAttestation` Sepolia
 * event via the Attestcoin Protocol and had `AttestcoinSettlement.execute()`
 * verify it on Creditcoin — this route only records that outcome, it does not
 * verify anything itself. The trust boundary is the ASC's own on-chain
 * verification, not this endpoint.
 *
 * Optional bearer auth: set `ATTESTATION_WEBHOOK_SECRET` to require it. Absent
 * means open, same tradeoff `chainEnabled()` makes elsewhere in this demo.
 */

import { fileStore } from "@/lib/market/store";
import { CREDITCOIN_CHAIN_ID } from "@/lib/chain/config";

export async function POST(request: Request) {
  const secret = process.env.ATTESTATION_WEBHOOK_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  let body: { onchainEpisodeId?: string; tx?: string; queryId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body is not valid JSON." }, { status: 400 });
  }

  const { onchainEpisodeId, tx, queryId } = body;
  if (!onchainEpisodeId || !tx || !queryId) {
    return Response.json({ error: "onchainEpisodeId, tx and queryId are required." }, { status: 400 });
  }

  const attestation = {
    chain_id: CREDITCOIN_CHAIN_ID,
    tx,
    query_id: queryId,
    attested_at: Math.floor(Date.now() / 1000),
  };

  const updated = await fileStore.recordAttestationForOnchainEpisode(onchainEpisodeId, attestation);
  if (!updated) {
    return Response.json(
      { error: `No anchored episode found with on-chain episode id ${onchainEpisodeId}.` },
      { status: 404 },
    );
  }

  return Response.json({ episode: updated });
}
