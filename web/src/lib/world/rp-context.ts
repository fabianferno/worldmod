import "server-only";

/**
 * The one piece every IDKit v4 request needs and no client can produce:
 * `RpContext` — a nonce and timestamp window signed by the relying party's
 * own key, proving to World App that this request really comes from a
 * registered app, not just anyone who read the app id off a webpage.
 *
 * `@worldcoin/idkit-server`'s `signRequest()` does the signing (pure JS,
 * EIP-191 over nonce + timestamps + action) — but it needs a real signing
 * key issued by the Developer Portal when an RP is registered there, which
 * this project does not have yet (see world/README.md). Without one, this
 * returns a context shaped exactly like a real one but clearly marked
 * `mock: true`, so the request-building and QR/deep-link UI can be built and
 * exercised now, and start producing real World App handoffs the moment
 * `WORLD_RP_ID` and `WORLD_RP_SIGNING_KEY` are set — no code change needed.
 */

import { randomBytes } from "node:crypto";
import { signRequest } from "@worldcoin/idkit-server";
import type { RpContext } from "@worldcoin/idkit-core";

const RP_ID = process.env.WORLD_RP_ID ?? "";
const RP_SIGNING_KEY = process.env.WORLD_RP_SIGNING_KEY ?? "";

export function rpConfigured(): boolean {
  return RP_ID.length > 0 && RP_SIGNING_KEY.length > 0;
}

export function buildRpContext(action: string): { context: RpContext; mock: boolean } {
  if (rpConfigured()) {
    const signed = signRequest({ signingKeyHex: RP_SIGNING_KEY, action });
    return {
      mock: false,
      context: {
        rp_id: RP_ID,
        nonce: signed.nonce,
        created_at: signed.createdAt,
        expires_at: signed.expiresAt,
        signature: signed.sig,
      },
    };
  }

  // No RP key configured. Shaped identically to a real context so the
  // request builder and widget never need to know which one they got — only
  // World App itself would reject an unsigned nonce, and it never sees this
  // until a real key is set.
  const now = Math.floor(Date.now() / 1000);
  return {
    mock: true,
    context: {
      rp_id: "rp_mock_no_developer_portal_app_registered",
      nonce: randomBytes(16).toString("hex"),
      created_at: now,
      expires_at: now + 300,
      signature: "0x00",
    },
  };
}
