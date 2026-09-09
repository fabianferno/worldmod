"use client";

/**
 * Who this account is, and whether it can be recovered.
 *
 * The distinction is the whole reason §10.3 asks for a recoverable identity.
 * Both identities sign episodes and both get paid; only one survives a lost
 * phone. Saying "wallet connected" for either would hide the difference that
 * matters.
 */

import { useMiniKit } from "@worldcoin/minikit-js/minikit-provider";
import { useSigner, useWorldAppAuth } from "@/lib/chain/signer-context";

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function Inner() {
  const { address, connecting, connect } = useWorldAppAuth();
  const signer = useSigner();

  if (address) {
    return (
      <div className="rounded-card bg-mint px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-mint-ink">World App — {short(address)}</p>
            <p className="mt-1 text-xs leading-relaxed text-mint-ink">
              Recoverable — connect World App on another phone and this account
              comes back.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-card bg-butter px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-butter-ink">This phone only</p>
          <p className="mt-1 text-xs leading-relaxed text-butter-ink">
            Your key lives in this browser. Clearing its data loses it, and anything
            owed to it goes with it.
          </p>
        </div>
        <button
          onClick={connect}
          disabled={connecting}
          className="interactive shrink-0 rounded-full bg-ink px-4 py-2.5 text-xs font-semibold text-on-ink disabled:opacity-40"
        >
          {connecting ? "Connecting…" : "Sign in"}
        </button>
      </div>
      {signer ? null : <p className="mt-2 text-xs text-butter-ink">Loading your key…</p>}
    </div>
  );
}

export function Identity() {
  // Outside World App there is no wallet to connect to — the device key is
  // the only identity, and the capture screen already says so.
  const { isInstalled } = useMiniKit();
  if (!isInstalled) return null;
  return <Inner />;
}
