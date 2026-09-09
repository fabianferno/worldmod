"use client";

/**
 * Sign-in, and what it changes.
 *
 * §10.3 wants a recoverable identity because "onboarding friction is the
 * whole game" — but the friction it removes is not signing. A device key
 * already signs. What connecting World App adds is *recovery*: the same
 * address on another phone, so a balance survives a lost device.
 *
 * The copy says exactly that rather than "connect your wallet", which would
 * describe a step this flow does not have.
 */

import { useMiniKit } from "@worldcoin/minikit-js/minikit-provider";
import { useSigner, useWorldAppAuth } from "@/lib/chain/signer-context";

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function SignedIn({ address }: { address: string }) {
  const signer = useSigner();

  return (
    <div className="flex items-center justify-between gap-3 rounded-card bg-mint px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-mint-ink">World App</p>
        <p className="tabular mt-0.5 font-mono text-xs text-mint-ink/70">
          {signer ? short(signer.address) : short(address)}
        </p>
      </div>
    </div>
  );
}

function SignedOut() {
  const signer = useSigner();
  const { connecting, connect } = useWorldAppAuth();

  return (
    <div className="rounded-card bg-butter px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-butter-ink">This phone only</p>
          <p className="tabular mt-0.5 font-mono text-xs text-butter-ink/70">
            {signer ? short(signer.address) : "…"}
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
      {/* The honest reason to bother, rather than a generic prompt. */}
      <p className="mt-2 text-xs leading-relaxed text-butter-ink">
        You can record and get paid without this. Signing in means your earnings
        are reachable from another phone — right now, clearing this browser loses
        the key.
      </p>
    </div>
  );
}

export function Account() {
  const { address } = useWorldAppAuth();
  return address ? <SignedIn address={address} /> : <SignedOut />;
}

/** Renders nothing outside World App — there is nothing to sign in to. */
export function AccountBar() {
  const { isInstalled } = useMiniKit();
  if (!isInstalled) return null;
  return <Account />;
}
