"use client";

/**
 * Who this account is, and whether it can be recovered.
 *
 * The distinction is the whole reason §10.3 asks for social login. Both
 * identities sign episodes and both get paid; only one survives a lost phone.
 * Saying "wallet connected" for either would hide the difference that matters.
 */

import { usePrivy } from "@privy-io/react-auth";
import { privyConfigured } from "@/lib/chain/privy-config";
import { useSigner } from "@/lib/chain/signer-context";

function Inner() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const signer = useSigner();

  if (!ready) return null;

  if (authenticated) {
    const label = user?.email?.address ?? user?.google?.email ?? "Signed in";
    return (
      <div className="rounded-2xl border border-positive/25 bg-positive/5 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{label}</p>
            <p className="mt-0.5 text-xs text-positive/80">
              Recoverable — sign in on another phone and this account comes back.
            </p>
          </div>
          <button onClick={() => void logout()} className="interactive shrink-0 text-xs text-muted">
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-caution/30 bg-caution/5 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">This phone only</p>
          <p className="mt-0.5 text-xs leading-relaxed text-caution/90">
            Your key lives in this browser. Clearing its data loses it, and anything
            owed to it goes with it.
          </p>
        </div>
        <button
          onClick={() => login()}
          className="interactive shrink-0 rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-background"
        >
          Sign in
        </button>
      </div>
      {signer ? null : <p className="mt-2 text-xs text-subtle">Loading your key…</p>}
    </div>
  );
}

export function Identity() {
  // Without an app id there is no provider and no choice to present — the
  // device key is the only identity, and the capture screen already says so.
  if (!privyConfigured()) return null;
  return <Inner />;
}
