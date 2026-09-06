"use client";

/**
 * Privy, wrapped so its absence is not a failure.
 *
 * Capture must work whether or not social login is configured — a missing app
 * id means a contributor signs with the device key, which is what happened
 * before Privy existed and still works. Rendering the provider unconditionally
 * would make an unconfigured deployment show an error where a viewfinder
 * belongs.
 */

import { PrivyProvider } from "@privy-io/react-auth";
import { PRIVY_APP_ID, privyConfig, privyConfigured } from "@/lib/chain/privy-config";
import { SignerProvider } from "@/lib/chain/signer-context";

export function Providers({ children }: { children: React.ReactNode }) {
  if (!privyConfigured()) {
    return <SignerProvider>{children}</SignerProvider>;
  }

  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
      <SignerProvider>{children}</SignerProvider>
    </PrivyProvider>
  );
}
