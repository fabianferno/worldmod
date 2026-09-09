"use client";

/**
 * Which identity the capture flow signs with.
 *
 * Split into two providers because hooks cannot be called conditionally, and
 * `useMiniKit` only reports a real `isInstalled` value inside a
 * `MiniKitProvider` — present unconditionally now that the whole app is a
 * World mini app, but `isInstalled` is still `false` (not an error) whenever
 * this loads outside World App, e.g. plain mobile-web Safari/Chrome.
 *
 * The device key is the default rather than an error state. Someone who has
 * not connected World App, or cannot, still records and still gets paid; what
 * they do not get is an address they can reach from another phone.
 *
 * Unlike Privy's silent embedded wallet, `MiniKit.walletAuth` always shows
 * World App's own confirmation prompt — there is no custodial wallet to
 * create quietly. Capture must never surprise a head-mounted contributor with
 * a prompt they cannot see, so connecting is never automatic here: it only
 * happens when something the contributor tapped calls `connect()` from
 * `useWorldAppAuth()`, same as Privy's login button did.
 *
 * Nothing here touches localStorage until the client has mounted. The device
 * key lives there, which does not exist on the server — reading it while
 * rendering crashed the whole capture route with a 500 before the viewfinder
 * ever appeared. `mounted` comes from useSyncExternalStore rather than an
 * effect so the server and the first client render agree, and no state is set
 * during render. Consumers get null until then.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { MiniKit } from "@worldcoin/minikit-js";
import { useMiniKit } from "@worldcoin/minikit-js/minikit-provider";
import { deviceSigner, worldAppSigner, type Signer } from "./signer";

const SignerContext = createContext<Signer | null>(null);

/** Null until the client has mounted and an identity exists. */
export function useSigner(): Signer | null {
  return useContext(SignerContext);
}

interface WorldAppAuthState {
  address: `0x${string}` | null;
  connecting: boolean;
  /** No-op wherever World App isn't installed — check `useMiniKit().isInstalled` first. */
  connect: () => void;
}

const WorldAppAuthContext = createContext<WorldAppAuthState>({
  address: null,
  connecting: false,
  connect: () => {},
});

/** Drives the "sign in with World App" button — see the file header. */
export function useWorldAppAuth(): WorldAppAuthState {
  return useContext(WorldAppAuthContext);
}

const noSubscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

/** True only once the browser has taken over rendering. */
function useMounted(): boolean {
  return useSyncExternalStore(noSubscribe, onClient, onServer);
}

function WorldAppBacked({ children }: { children: React.ReactNode }) {
  const mounted = useMounted();
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [connecting, setConnecting] = useState(false);

  // `walletAuth` needs a fresh, single-use nonce. No server session sits
  // behind it here — the trust boundary is the EIP-712 signature each
  // registry contract itself checks, same as it was with Privy — so a
  // client-generated one is enough to satisfy the command's own replay
  // protection rather than to anchor a login session.
  const connect = useCallback(() => {
    if (connecting || address) return;
    setConnecting(true);
    MiniKit.walletAuth({ nonce: crypto.randomUUID().replace(/-/g, "") })
      .then((result) => {
        if ("address" in result.data) setAddress(result.data.address as `0x${string}`);
      })
      .catch(() => {
        // Declined or failed — stays on the device key below.
      })
      .finally(() => setConnecting(false));
  }, [connecting, address]);

  const signer = useMemo(() => {
    if (!mounted) return null;
    return address ? worldAppSigner(address) : deviceSigner();
  }, [mounted, address]);

  const authState = useMemo(() => ({ address, connecting, connect }), [address, connecting, connect]);

  return (
    <WorldAppAuthContext.Provider value={authState}>
      <SignerContext.Provider value={signer}>{children}</SignerContext.Provider>
    </WorldAppAuthContext.Provider>
  );
}

function DeviceBacked({ children }: { children: React.ReactNode }) {
  const mounted = useMounted();
  const signer = useMemo(() => (mounted ? deviceSigner() : null), [mounted]);
  return <SignerContext.Provider value={signer}>{children}</SignerContext.Provider>;
}

export function SignerProvider({ children }: { children: React.ReactNode }) {
  const { isInstalled } = useMiniKit();
  return isInstalled ? (
    <WorldAppBacked>{children}</WorldAppBacked>
  ) : (
    <DeviceBacked>{children}</DeviceBacked>
  );
}
