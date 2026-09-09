import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Selfie Check needs a real device camera and World App, so testing it
   * means tunnelling the dev server (ngrok) and opening that URL on a phone
   * — a different origin than localhost. Without this, Next's dev server
   * silently blocks every /_next/static/* chunk request from that origin:
   * the page's initial HTML still loads, but no JS ever runs, which looks
   * like a broken app rather than a blocked one. Wildcarded because ngrok's
   * free tier assigns a new subdomain on every restart.
   */
  allowedDevOrigins: ["*.ngrok-free.dev", "*.ngrok-free.app", "*.ngrok.io", "*.ngrok.app"],
  turbopack: {
    resolveAlias: {
      /**
       * @tensorflow-models/hand-pose-detection statically imports
       * @mediapipe/hands to support its "mediapipe" runtime. We use the "tfjs"
       * runtime exclusively, which reuses the TensorFlow.js runtime optical
       * flow already loads, so pulling in MediaPipe's WASM build would add
       * megabytes for a code path that never runs.
       *
       * Without this alias the build fails outright with
       * "Export Hands doesn't exist in target module", since the package is
       * an optional peer dependency and is deliberately not installed.
       */
      "@mediapipe/hands": "./src/lib/analysis/stubs/mediapipe-hands.ts",
    },
  },
};

export default nextConfig;
