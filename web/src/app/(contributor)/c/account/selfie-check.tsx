"use client";

/**
 * Selfie Check: a medium-assurance liveness/personhood signal, shown as a
 * badge next to Identity — never a gate. §12's reputation score already sets
 * the precedent (computed and displayed, nothing blocked on it); a contributor
 * who has not done a selfie check still records and still gets paid.
 *
 * What it is FOR here: abuse resistance against scripted/duplicate accounts
 * farming bounty payouts, and continuity — the same World App account
 * re-verifying on a new phone reads as the same contributor, not a fresh one.
 * See world/README.md for how that maps onto World's own qualification bar.
 *
 * Tied to whichever address `useSigner()` currently reports — the World App
 * wallet if connected, the device key otherwise — so a verification always
 * lands on the identity actually earning payouts, not a separate account.
 */

import { useCallback, useEffect, useState } from "react";
import { IDKitRequestWidget, selfieCheckLegacy } from "@worldcoin/idkit";
import type { IDKitErrorCodes, IDKitResult, RpContext } from "@worldcoin/idkit-core";
import { useSigner } from "@/lib/chain/signer-context";
import { WORLD_APP_ID } from "@/lib/chain/minikit-config";

const PLACEHOLDER_APP_ID = "app_0000000000000000000000000000000000" as const;
const ACTION = "world-mod-contributor-verification";

interface Verification {
  address: `0x${string}`;
  verifiedAt: number;
  mock: boolean;
}

export function SelfieCheck() {
  const signer = useSigner();
  const [open, setOpen] = useState(false);
  const [rpContext, setRpContext] = useState<{ context: RpContext; mock: boolean } | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const address = signer?.address ?? null;

  useEffect(() => {
    if (!address) return;
    fetch(`/api/world/verify?address=${address}`)
      .then((r) => r.json())
      .then((data: { verification: Verification | null }) => setVerification(data.verification))
      .catch(() => {});
  }, [address]);

  const start = useCallback(() => {
    setError(null);
    setLoadingContext(true);
    fetch("/api/world/rp-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: ACTION }),
    })
      .then((r) => r.json())
      .then((data: { rp_context: RpContext; mock: boolean }) => {
        setRpContext({ context: data.rp_context, mock: data.mock });
        setOpen(true);
      })
      .catch(() => setError("Could not prepare a verification request."))
      .finally(() => setLoadingContext(false));
  }, []);

  const handleVerify = useCallback(
    async (result: IDKitResult) => {
      if (!address || !rpContext) throw new Error("No address to verify against.");
      const response = await fetch("/api/world/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, result, mock: rpContext.mock }),
      });
      if (!response.ok) throw new Error("Server could not record the verification.");
    },
    [address, rpContext],
  );

  const onSuccess = useCallback(() => {
    if (!address || !rpContext) return;
    setVerification({ address, verifiedAt: Math.floor(Date.now() / 1000), mock: rpContext.mock });
  }, [address, rpContext]);

  const onError = useCallback((code: IDKitErrorCodes) => {
    setError(`Selfie Check did not complete (${code}).`);
  }, []);

  if (!address) return null;

  if (verification) {
    return (
      <div className="rounded-card bg-mint px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-mint-ink">Selfie Check verified</p>
            <p className="mt-1 text-xs text-mint-ink">
              {new Date(verification.verifiedAt * 1000).toLocaleDateString()}
              {verification.mock ? " — sandbox mock, not a real World App proof" : ""}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-card bg-paper px-4 py-3.5 shadow-lift">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Selfie Check</p>
          <p className="mt-1 text-xs leading-relaxed text-subtle">
            A liveness check via World App — a badge on your reputation, not a
            requirement to earn.
          </p>
        </div>
        <button
          onClick={start}
          disabled={loadingContext}
          className="interactive shrink-0 rounded-full bg-lilac px-4 py-2.5 text-xs font-semibold text-lilac-ink disabled:opacity-40"
        >
          {loadingContext ? "Preparing…" : "Verify"}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-negative">{error}</p> : null}
      {rpContext ? (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={(WORLD_APP_ID || PLACEHOLDER_APP_ID) as `app_${string}`}
          action={ACTION}
          rp_context={rpContext.context}
          allow_legacy_proofs
          environment="sandbox"
          preset={selfieCheckLegacy({ signal: address })}
          handleVerify={handleVerify}
          onSuccess={onSuccess}
          onError={onError}
        />
      ) : null}
    </div>
  );
}
