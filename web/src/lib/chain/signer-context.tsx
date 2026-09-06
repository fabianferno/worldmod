"use client";

/**
 * Which identity the capture flow signs with.
 *
 * Split into two providers because hooks cannot be called conditionally, and
 * Privy's hooks throw outside a PrivyProvider — which is absent whenever no app
 * id is configured. One component calls them, the other never does, and the
 * page picks between the two at the top of the tree.
 *
 * The device key is the default rather than an error state. Someone who has not
 * logged in yet, or cannot, still records and still gets paid; what they do not
 * get is an address they can reach from another phone.
 *
 * Nothing here touches localStorage until the client has mounted. The device
 * key lives there, which does not exist on the server — reading it while
 * rendering crashed the whole capture route with a 500 before the viewfinder
 * ever appeared. `mounted` comes from useSyncExternalStore rather than an
 * effect so the server and the first client render agree, and no state is set
 * during render. Consumers get null until then.
 */

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { useWallets } from "@privy-io/react-auth";
import { privyConfigured } from "./privy-config";
import { deviceSigner, privySigner, type Signer } from "./signer";

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

function PrivyBacked({ children }: { children: React.ReactNode }) {
  const { wallets } = useWallets();
  const mounted = useMounted();

  const signer = useMemo(() => {
    if (!mounted) return null;
    // Privy's own embedded wallet, not an injected one a contributor happened
    // to have — §3's flow assumes no existing wallet.
    const embedded = wallets.find((w) => w.walletClientType === "privy");
    return embedded ? privySigner(embedded) : deviceSigner();
  }, [mounted, wallets]);

  return <SignerContext.Provider value={signer}>{children}</SignerContext.Provider>;
}

function DeviceBacked({ children }: { children: React.ReactNode }) {
  const mounted = useMounted();
  const signer = useMemo(() => (mounted ? deviceSigner() : null), [mounted]);
  return <SignerContext.Provider value={signer}>{children}</SignerContext.Provider>;
}

export function SignerProvider({ children }: { children: React.ReactNode }) {
  return privyConfigured() ? (
    <PrivyBacked>{children}</PrivyBacked>
  ) : (
    <DeviceBacked>{children}</DeviceBacked>
  );
}
