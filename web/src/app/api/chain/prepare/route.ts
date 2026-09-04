/**
 * What the device needs before it can sign.
 *
 * Nonces are read from the chain rather than tracked locally: a signature made
 * against a stale nonce reverts as InvalidSignature, and the phone has no way
 * to know another submission landed in between.
 */

import { ADDRESSES, CHAIN, chainEnabled } from "@/lib/chain/config";
import { noncesFor } from "@/lib/chain/relay";

export async function GET(request: Request) {
  if (!chainEnabled()) {
    return Response.json({ enabled: false });
  }

  const address = new URL(request.url).searchParams.get("address");
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return Response.json({ error: "A contributor address is required." }, { status: 400 });
  }

  try {
    const state = await noncesFor(address as `0x${string}`);
    return Response.json({
      enabled: true,
      chainId: CHAIN.id,
      addresses: ADDRESSES,
      registered: state.registered,
      assetIds: state.assetIds,
      nonces: {
        entity: state.entity.toString(),
        asset: state.asset.toString(),
        episode: state.episode.toString(),
      },
    });
  } catch (err) {
    // An unreachable RPC disables anchoring for this episode; it does not fail
    // the capture, which has already been recorded and scored.
    return Response.json(
      { enabled: false, error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
