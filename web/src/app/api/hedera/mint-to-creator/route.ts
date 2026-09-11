/**
 * Buyer-side action: mint a Bond's licence seats to the dataset's creator
 * (the identity bridge). Additive on top of issuance — see issue-bond/route.ts.
 */

import { hederaConfigured } from "@/lib/hedera/issue";
import { mintToCreator } from "@/lib/hedera/mint-to-creator";

export async function POST(request: Request) {
  if (!hederaConfigured()) {
    return Response.json({ error: "Hedera issuance is not configured." }, { status: 501 });
  }

  let body: { datasetId?: number; securityId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body is not valid JSON." }, { status: 400 });
  }

  if (typeof body.datasetId !== "number") {
    return Response.json({ error: "datasetId is required." }, { status: 400 });
  }
  if (typeof body.securityId !== "string") {
    return Response.json({ error: "securityId (Bond EVM address) is required." }, { status: 400 });
  }

  try {
    const mint = await mintToCreator(body.datasetId, body.securityId);
    return Response.json({ mint });
  } catch (err) {
    console.error("[hedera/mint-to-creator] failed:", err);
    return Response.json(
      {
        error: err instanceof Error ? err.message : String(err),
        stack: process.env.NODE_ENV !== "production" && err instanceof Error ? err.stack : undefined,
      },
      { status: 500 },
    );
  }
}
