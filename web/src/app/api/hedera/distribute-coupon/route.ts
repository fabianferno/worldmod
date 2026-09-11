/**
 * Buyer-side action: distribute a Bond's coupon to its holders in real testnet
 * USDC. Holders are passed explicitly (the SDK cannot enumerate holders that
 * are external EOAs without a Hedera account). See issue-bond/route.ts.
 */

import { hederaConfigured } from "@/lib/hedera/issue";
import { distributeCoupon } from "@/lib/hedera/distribute-coupon";

export async function POST(request: Request) {
  if (!hederaConfigured()) {
    return Response.json({ error: "Hedera issuance is not configured." }, { status: 501 });
  }

  let body: { securityId?: string; couponId?: string; holders?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body is not valid JSON." }, { status: 400 });
  }

  if (typeof body.securityId !== "string") {
    return Response.json({ error: "securityId (Bond EVM address) is required." }, { status: 400 });
  }
  if (typeof body.couponId !== "string") {
    return Response.json({ error: "couponId is required (as a string)." }, { status: 400 });
  }
  if (body.holders !== undefined && !Array.isArray(body.holders)) {
    return Response.json({ error: "holders, if provided, must be an array of addresses." }, { status: 400 });
  }

  try {
    const distribution = await distributeCoupon(body.securityId, body.couponId, body.holders ?? []);
    return Response.json({ distribution });
  } catch (err) {
    console.error("[hedera/distribute-coupon] failed:", err);
    return Response.json(
      {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      { status: 500 },
    );
  }
}
