import { getSelfieVerification, recordSelfieVerification } from "@/lib/world/verification-store";

const RP_ID = process.env.WORLD_RP_ID ?? "";

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return Response.json({ error: "address query param must be a 0x-prefixed EVM address." }, { status: 400 });
  }
  const verification = await getSelfieVerification(address);
  return Response.json({ verification });
}

interface ResponseItemV3 {
  identifier: string;
  nullifier: string;
}

interface IDKitResultLike {
  responses?: ResponseItemV3[];
}

interface VerifyApiResponse {
  success: boolean;
  code?: string;
  detail?: string;
}

/**
 * `POST https://developer.world.org/api/v4/verify/{rp_id}` — the actual
 * independent proof check this integration was missing when world/FEEDBACK.md
 * was first written. Not linked from either docs page the bounty task named
 * (`credentials/11`, `sandbox/testing-selfie-check`); it turned up only in
 * `sandbox/sandbox-access`'s configuration section, which just names the URL
 * with no request/response shape — the actual schema came from
 * `api-reference/developer-portal/verify.md`. The body IS the full IDKitResult
 * this route already receives from the client, unmodified: no separate
 * transform needed. No auth header — the OpenAPI spec marks it `security: []`.
 */
async function verifyWithWorld(result: IDKitResultLike): Promise<VerifyApiResponse> {
  const response = await fetch(`https://developer.world.org/api/v4/verify/${RP_ID}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result),
  });
  return (await response.json()) as VerifyApiResponse;
}

export async function POST(request: Request) {
  let body: { address?: string; result?: IDKitResultLike; mock?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body is not valid JSON." }, { status: 400 });
  }

  const address = body.address;
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return Response.json({ error: "address must be a 0x-prefixed EVM address." }, { status: 400 });
  }

  const selfie = body.result?.responses?.find((r) => r.identifier === "selfie");
  if (!selfie) {
    return Response.json(
      { error: "No 'selfie' credential response in the submitted result." },
      { status: 400 },
    );
  }

  const mock = body.mock ?? false;

  // A mock rp_context was never registered with World's servers — there is
  // nothing real for the verify API to check. Only call it for a request
  // signed with a real RP key.
  if (!mock) {
    if (!RP_ID) {
      return Response.json({ error: "WORLD_RP_ID is not configured." }, { status: 500 });
    }
    let verifyResult: VerifyApiResponse;
    try {
      verifyResult = await verifyWithWorld(body.result!);
    } catch (err) {
      return Response.json(
        { error: `Could not reach World's verify API: ${err instanceof Error ? err.message : String(err)}` },
        { status: 502 },
      );
    }
    if (!verifyResult.success) {
      return Response.json(
        { error: `World rejected this proof: ${verifyResult.detail ?? verifyResult.code ?? "unknown reason"}` },
        { status: 400 },
      );
    }
  }

  await recordSelfieVerification({
    address: address as `0x${string}`,
    verifiedAt: Math.floor(Date.now() / 1000),
    nullifier: selfie.nullifier,
    mock,
  });

  return Response.json({ ok: true });
}
