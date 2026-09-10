"use client";

/**
 * Which identity the capture flow signs with: the device key, always.
 *
 * Nothing here touches localStorage until the client has mounted. The device
 * key lives there, which does not exist on the server — reading it while
 * rendering crashed the whole capture route with a 500 before the viewfinder
 * ever appeared. `mounted` comes from useSyncExternalStore rather than an
 * effect so the server and the first client render agree, and no state is set
 * during render. Consumers get null until then.
 */

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { deviceSigner, type Signer } from "./signer";

const SignerContext = createContext<Signer | null>(null);

/** Null until the client has mounted and an identity exists. */
export function useSigner(): Signer | null {
  return useContext(SignerContext);
}

const noSubscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

/** True only once the browser has taken over rendering. */
function useMounted(): boolean {
  return useSyncExternalStore(noSubscribe, onClient, onServer);
}

export function SignerProvider({ children }: { children: React.ReactNode }) {
  const mounted = useMounted();
  const signer = useMemo(() => (mounted ? deviceSigner() : null), [mounted]);
  return <SignerContext.Provider value={signer}>{children}</SignerContext.Provider>;
}
