import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),

      /**
       * Privy imports @stripe/crypto for a fiat on-ramp nothing here uses.
       * An ES import, so an alias does reach it — unlike @mediapipe/hands,
       * which is required from CommonJS inside node_modules and needed a real
       * package under stubs/ instead.
       */
      "@stripe/crypto": fileURLToPath(
        new URL("./src/lib/chain/stubs/stripe-crypto.ts", import.meta.url),
      ),
    },
  },
  test: {
    // Default environment is node. Modules under test use only standard web
    // APIs (WebCrypto, TypedArrays, EventTarget) so they run unmodified in
    // both runtimes — which is the point, since the API route and the capture
    // client share them.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
