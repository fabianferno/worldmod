/**
 * A buyer-side action, not a script run by hand: read a real Sepolia
 * dataset, issue it as a compliant ATS Bond on Hedera testnet.
 *
 * Additive on top of a marketplace that works without it, the same as
 * anchoring and pinning — Hedera issuance is a further step available on an
 * already-real dataset, not something the dataset's existence depends on.
 */

import { ADDRESSES } from "@/lib/chain/config";
import { hederaConfigured, issueDatasetBond } from "@/lib/hedera/issue";
import { readSepoliaDataset } from "@/lib/hedera/read-sepolia-dataset";

export async function POST(request: Request) {
  if (!hederaConfigured()) {
    return Response.json({ error: "Hedera issuance is not configured." }, { status: 501 });
  }

  let body: { datasetId?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body is not valid JSON." }, { status: 400 });
  }

  if (typeof body.datasetId !== "number") {
    return Response.json({ error: "datasetId is required." }, { status: 400 });
  }

  try {
    const dataset = await readSepoliaDataset(body.datasetId);
    if (dataset.episodeCount === 0) {
      return Response.json({ error: `No dataset #${body.datasetId} on Sepolia.` }, { status: 404 });
    }

    const result = await issueDatasetBond(dataset, ADDRESSES.datasetRegistry);
    return Response.json({
      dataset: { ...dataset, priceUsdc: dataset.priceUsdc.toString() },
      bond: result,
    });
  } catch (err) {
    console.error("[hedera/issue-bond] failed:", err);
    return Response.json(
      {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      { status: 500 },
    );
  }
}
