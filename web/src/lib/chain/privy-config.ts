"use client";

/**
 * Privy configuration — embedded wallets with social login.
 *
 * product-spec §10.3 puts this at the centre of the supply story: "onboarding
 * friction is the whole game." A device key signs perfectly well, and until now
 * that was the whole identity — but it cannot be recovered. Clearing site data
 * loses the key, and with it every future payment credited to that address,
 * which is a bad thing to discover after doing the work.
 *
 * A Privy embedded wallet is the same signing capability with an account behind
 * it: log in with email or Google on a second device and the same address comes
 * back. That is what makes an on-chain balance survive a lost phone.
 *
 * The app id is public by design and ships in the bundle. The secret never
 * leaves the server; nothing in this file touches it.
 */

import type { PrivyClientConfig } from "@privy-io/react-auth";
import { sepolia } from "viem/chains";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/** Absent id means social login is simply unavailable, not that capture is. */
export function privyConfigured(): boolean {
  return PRIVY_APP_ID.length > 0;
}

export const privyConfig: PrivyClientConfig = {
  // Email and Google only. A wallet-connect flow would ask a contributor to
  // already own a wallet, which is exactly the friction §3 removes.
  loginMethods: ["email", "google"],

  embeddedWallets: {
    ethereum: {
      // The wallet exists the moment someone logs in, because the first thing
      // that happens afterwards is signing an episode.
      createOnLogin: "users-without-wallets",
    },
    // Nothing here should ever prompt: the contributor is head-mounted and
    // mid-task, and a confirmation dialog they cannot see would hang the flow.
    showWalletUIs: false,
  },

  defaultChain: sepolia,
  supportedChains: [sepolia],

  appearance: {
    theme: "dark",
    accentColor: "#38bdf8",
    logo: undefined,
    walletChainType: "ethereum-only",
  },
};
