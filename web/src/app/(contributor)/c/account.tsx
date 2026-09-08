"use client";

/**
 * Sign-in, and what it changes.
 *
 * §10.3 wants an embedded wallet with social login because "onboarding friction
 * is the whole game" — but the friction it removes is not signing. A device key
 * already signs. What logging in adds is *recovery*: the same address on
 * another phone, so a balance survives a lost device.
 *
 * The copy says exactly that rather than "connect your wallet", which would
 * describe a step this flow does not have.
 */

import { useCallback } from "react";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import { privyConfigured } from "@/lib/chain/privy-config";
import { useSigner } from "@/lib/chain/signer-context";

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function SignedIn() {
  const { logout, user } = usePrivy();
  const signer = useSigner();

  const label = user?.email?.address ?? user?.google?.email ?? (signer ? short(signer.address) : "");

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="tabular font-mono text-xs text-subtle">
          {signer ? short(signer.address) : "…"}
        </p>
      </div>
      <button onClick={() => void logout()} className="interactive shrink-0 text-xs text-muted">
        Sign out
      </button>
    </div>
  );
}

function SignedOut() {
  const { login } = useLogin();
  const signer = useSigner();

  const start = useCallback(() => login(), [login]);

  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">This phone only</p>
          <p className="tabular font-mono text-xs text-subtle">
            {signer ? short(signer.address) : "…"}
          </p>
        </div>
        <button
          onClick={start}
          className="interactive shrink-0 rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-background"
        >
          Sign in
        </button>
      </div>
      {/* The honest reason to bother, rather than a generic prompt. */}
      <p className="mt-2 text-xs leading-relaxed text-subtle">
        You can record and get paid without this. Signing in means your earnings
        are reachable from another phone — right now, clearing this browser loses
        the key.
      </p>
    </div>
  );
}

export function Account() {
  const { ready, authenticated } = usePrivy();
  if (!ready) return null;
  return authenticated ? <SignedIn /> : <SignedOut />;
}

/** Renders nothing where social login is not configured. */
export function AccountBar() {
  if (!privyConfigured()) return null;
  return <Account />;
}
