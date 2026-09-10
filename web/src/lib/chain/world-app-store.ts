"use client";

/**
 * Remembering a World App sign-in across reloads.
 *
 * `signer-context` holds the connected address in React state, which a reload
 * throws away — so a contributor who signed in silently dropped back to the
 * device key every time the app was reopened. This keeps the address so the
 * session sticks.
 *
 * What is kept is only the public address. The private key never leaves World
 * App and every signature still goes through `MiniKit.signTypedData`, which
 * re-prompts, so a stale or forged value here cannot sign anything — the worst
 * it does is name a wrong address the next signature would not match. That is
 * also why restoring this on mount never calls `walletAuth`: the header of
 * `signer-context` is emphatic that connecting is never automatic, and reading
 * a remembered address is not connecting.
 *
 * Every access is guarded. localStorage is absent on the server and can throw
 * in a private window or with site data blocked; this runs inside the render
 * that decides which identity to show, and must degrade to "not signed in"
 * rather than take the screen down with it — the same contract the device key
 * relies on.
 */

export const WORLD_APP_ADDRESS_STORAGE = "worldmod.world_app_address";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The remembered World App address, or null if none is stored or valid. */
export function loadWorldAppAddress(): `0x${string}` | null {
  try {
    const stored = localStorage.getItem(WORLD_APP_ADDRESS_STORAGE);
    return stored && ADDRESS.test(stored) ? (stored as `0x${string}`) : null;
  } catch {
    return null;
  }
}

export function saveWorldAppAddress(address: `0x${string}`): void {
  try {
    localStorage.setItem(WORLD_APP_ADDRESS_STORAGE, address);
  } catch {
    // Unavailable storage just means the sign-in won't survive a reload.
  }
  emit();
}

export function clearWorldAppAddress(): void {
  try {
    localStorage.removeItem(WORLD_APP_ADDRESS_STORAGE);
  } catch {
    // Nothing to clean up if we could never write it.
  }
  emit();
}

/**
 * Expose the stored address as an external store so `signer-context` can read
 * it with `useSyncExternalStore` — the same hook the file already uses for
 * mount detection. That keeps hydration honest (the server snapshot is null,
 * since there is no storage there) without setting React state inside an
 * effect, and lets connect/disconnect re-render every reader by writing
 * through `save`/`clear` rather than threading a setter around.
 */
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeWorldAppAddress(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
