/**
 * Register a contributor and their phone, gas paid by the relayer.
 *
 * Runs before an episode can be anchored, and returns the asset id the device
 * must then sign against. Separate from anchoring because SubmitEpisode's
 * signature commits to an asset id that does not exist until this has landed.
 */

import { chainEnabled } from "@/lib/chain/config";
import { registerContributor, type RegisterSignatures } from "@/lib/chain/relay";

export async function POST(request: Request) {
  if (!chainEnabled()) {
    return Response.json({ error: "Anchoring is not configured." }, { status: 501 });
  }

  let signed: RegisterSignatures;
  try {
    signed = (await request.json()) as RegisterSignatures;
  } catch {
    return Response.json({ error: "Body is not valid JSON." }, { status: 400 });
  }

  if (!signed?.contributor || !/^0x[0-9a-fA-F]{40}$/.test(signed.contributor)) {
    return Response.json({ error: "A contributor address is required." }, { status: 400 });
  }

  const result = await registerContributor(signed);
  return Response.json(
    { assetIds: result.assetIds, txs: result.txs, error: result.error },
    { status: result.ok ? 200 : 502 },
  );
}
