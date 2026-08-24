/**
 * World Mod service worker.
 *
 * Hand-written rather than generated. It does two jobs, and a generator would
 * have added a build step and a dependency to do the same:
 *
 *  1. Satisfies the installability requirement — a browser will not offer to
 *     install an app whose service worker has no fetch handler.
 *  2. Caches the hand-tracking models. They are ~4MB and are fetched before
 *     every capture; serving them from cache turns a multi-second wait at the
 *     start of each session into an instant one.
 *
 * Deliberately NOT cached: /api/*. Bounties, episodes and payment decisions
 * must never be served stale — a contributor shown a cached "accepted" for an
 * episode the server rejected would be told they had been paid when they had
 * not.
 */

const VERSION = "v1";
const SHELL_CACHE = `worldmod-shell-${VERSION}`;
const MODEL_CACHE = `worldmod-models-${VERSION}`;

const SHELL = ["/", "/c", "/b/bounties", "/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one missing route cannot fail the whole install.
      await Promise.allSettled(SHELL.map((url) => cache.add(url)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, MODEL_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

/** Model weights are immutable and large: cache first, always. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

/** Everything else prefers the network and falls back to whatever we hold. */
async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && request.method === "GET") cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    if (request.mode === "navigate") {
      const offline = await cache.match("/offline");
      if (offline) return offline;
    }
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never serve a stale bounty, episode or payment decision.
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/models/")) {
    event.respondWith(cacheFirst(request, MODEL_CACHE));
    return;
  }

  event.respondWith(networkFirst(request));
});
