/**
 * Hand landmark detection — the "pivot points".
 *
 * MediaPipe HandLandmarker returns 21 joints per hand. Both the WASM runtime
 * and the model are self-hosted from /public rather than pulled from a CDN:
 * the demo cannot depend on network reachability at the moment it runs, and a
 * strict CSP would block the CDN anyway.
 *
 * product-spec §3.1 lists hand tracking as [ROADMAP], citing battery and
 * thermal cost. Running it post-capture on ~120 downscaled frames rather than
 * live on every frame is what makes it affordable now.
 */

import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { FrameHands, Landmark } from "./framing";
import type { SampledFrame } from "./frames";

const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/models/hand_landmarker.task";

/** Indices of the joints that read as pivots when drawn: wrist, then knuckles. */
export const PIVOT_INDICES = [0, 1, 2, 5, 9, 13, 17] as const;

let cached: Promise<HandLandmarker> | null = null;

export function createHandLandmarker(): Promise<HandLandmarker> {
  // The model is ~7.8MB; loading it more than once per session is wasteful.
  cached ??= (async () => {
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    return HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
      runningMode: "IMAGE",
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  })().catch((err) => {
    // Do not cache a failure — a transient load error should be retryable.
    cached = null;
    throw err;
  });

  return cached;
}

export interface DetectOptions {
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export async function detectHands(
  frames: readonly SampledFrame[],
  options: DetectOptions = {},
): Promise<FrameHands[]> {
  if (frames.length === 0) return [];

  const detector = await createHandLandmarker();
  const out: FrameHands[] = [];

  for (let i = 0; i < frames.length; i++) {
    if (options.signal?.aborted) break;

    const { t, image } = frames[i];
    const result = detector.detect(image);

    const hands: Landmark[][] = (result.landmarks ?? []).map((hand) =>
      hand.map(({ x, y }) => ({ x, y })),
    );

    out.push({ t, hands });
    options.onProgress?.(i + 1, frames.length);
  }

  return out;
}

/** Free the model. Called when leaving the capture flow. */
export async function disposeHandLandmarker(): Promise<void> {
  if (!cached) return;
  try {
    (await cached).close();
  } catch {
    // Already closed or never finished loading.
  }
  cached = null;
}
