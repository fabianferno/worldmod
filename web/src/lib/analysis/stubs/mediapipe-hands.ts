/**
 * Stub for @mediapipe/hands.
 *
 * @tensorflow-models/hand-pose-detection statically imports this to support
 * its "mediapipe" runtime, which loads MediaPipe's own WASM build. We use the
 * "tfjs" runtime exclusively — it reuses the TensorFlow.js runtime optical
 * flow already loads — so the real package would add megabytes of WASM for a
 * code path that never executes.
 *
 * Aliased in next.config.ts. Touching this at runtime means something selected
 * the mediapipe runtime by mistake, so it throws rather than failing quietly.
 */

function refuse(): never {
  throw new Error(
    "The MediaPipe hands runtime is not bundled. Hand tracking uses the tfjs " +
      "runtime; see src/lib/analysis/landmarks.ts.",
  );
}

export class Hands {
  constructor() {
    refuse();
  }
}

export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [];

const stub = { Hands, HAND_CONNECTIONS };
export default stub;
