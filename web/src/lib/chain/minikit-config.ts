"use client";

/**
 * World App mini-app configuration — replaces Privy as the recoverable
 * identity backend.
 *
 * product-spec §10.3 named World Network proof-of-personhood as a planned
 * integration; this is that integration's foundation. Where Privy gave a
 * contributor an embedded wallet reachable by logging into an email/Google
 * account, MiniKit gives them the wallet already inside World App — reachable
 * by being signed into World App on any device, with no separate account to
 * create.
 *
 * The app id is public by design (it identifies the mini app to World App,
 * not a secret) and ships in the bundle, same as Privy's was.
 */

export const WORLD_APP_ID = process.env.NEXT_PUBLIC_WORLD_APP_ID ?? "";

/** Absent id means MiniKit has nothing to install against. */
export function worldAppIdConfigured(): boolean {
  return WORLD_APP_ID.length > 0;
}
