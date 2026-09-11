/**
 * Buyer-side action: fix a licence-fee coupon on an issued Bond.
 * See issue-bond/route.ts for the shape.
 */

import { hederaConfigured } from "@/lib/hedera/issue";
import { setDatasetCoupon } from "@/lib/hedera/set-coupon";

export async function POST(request: Request) {
  if (!hederaConfigured()) {
    return Response.json({ error: "Hedera issuance is not configured." }, { status: 501 });
  }

  let body: { securityId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body is not valid JSON." }, { status: 400 });
  }

  if (typeof body.securityId !== "string") {
    return Response.json({ error: "securityId (Bond EVM address) is required." }, { status: 400 });
  }

  try {
    const coupon = await setDatasetCoupon(body.securityId);
    return Response.json({ coupon });
  } catch (err) {
    console.error("[hedera/set-coupon] failed:", err);
    return Response.json(
      {
        error: err instanceof Error ? err.message : String(err),
        stack: process.env.NODE_ENV !== "production" && err instanceof Error ? err.stack : undefined,
      },
      { status: 500 },
    );
  }
}
