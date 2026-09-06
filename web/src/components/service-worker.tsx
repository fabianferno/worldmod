"use client";

import { useEffect } from "react";

/**
 * Registers the service worker.
 *
 * Registration is deferred until after load so it never competes with the
 * first paint or, worse, with the camera warm-up on the capture screen.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // A failed registration costs installability and offline caching,
        // never capture itself; there is nothing useful to tell the user.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
