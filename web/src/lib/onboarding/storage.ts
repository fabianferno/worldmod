"use client";

/**
 * Whether this browser has seen the onboarding tour.
 *
 * One flag, same discipline as the rest of the app's client storage: absent on
 * the server, and can throw in a private window or with site data blocked, so
 * every access is guarded and a failure reads as "not yet seen" rather than
 * taking down the screen that checks it. A false "not seen" only costs one
 * extra tour, which is the safe direction to fail.
 */

export const ONBOARDED_STORAGE = "worldmod.onboarded";

export function hasOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_STORAGE) === "1";
  } catch {
    return false;
  }
}

export function markOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_STORAGE, "1");
  } catch {
    // Unavailable storage just means the tour may auto-run again next visit.
  }
}
