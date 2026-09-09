"use client";

/**
 * Thin re-export.
 *
 * MiniKit itself now wraps the whole app from the root layout — every route
 * needs `useMiniKit()` to work, not just capture — so there is nothing
 * route-specific left to configure here. This file stays so call sites don't
 * need to know that the identity backend moved to `signer-context.tsx`
 * directly.
 */

import { SignerProvider } from "@/lib/chain/signer-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return <SignerProvider>{children}</SignerProvider>;
}
