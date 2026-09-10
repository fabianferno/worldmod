"use client";

/**
 * Thin re-export so call sites don't need to know the identity backend lives
 * in signer-context.tsx directly.
 */

import { SignerProvider } from "@/lib/chain/signer-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return <SignerProvider>{children}</SignerProvider>;
}
