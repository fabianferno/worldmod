"use client";

/**
 * Wraps the whole app in MiniKit, not just the contributor route.
 *
 * `useMiniKit()` — which `SignerProvider` needs to decide World App vs.
 * device-key identity — throws outside a `MiniKitProvider`. This has to sit
 * above every route that might mount a signer, so it lives in the root
 * layout rather than a single route group the way Privy's wrapper did.
 *
 * An absent app id is not a failure: `MiniKit.install()` still runs, reports
 * `isInstalled: false` outside World App, and every consumer already treats
 * that as "use the device key" rather than an error state.
 */

import { MiniKitProvider } from "@worldcoin/minikit-js/minikit-provider";
import { WORLD_APP_ID } from "@/lib/chain/minikit-config";

export function MiniKitClientProvider({ children }: { children: React.ReactNode }) {
  return <MiniKitProvider props={{ appId: WORLD_APP_ID }}>{children}</MiniKitProvider>;
}
