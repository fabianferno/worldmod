import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
