/**
 * Hand landmark detection — the "pivot points".
 *
 * Runs on the TensorFlow.js runtime that optical flow already loads, so hand
 * tracking costs model weights and no second runtime. The earlier MediaPipe
 * Tasks approach shipped its own ~34MB WASM build alongside TFJS: two tensor
 * runtimes doing the same class of work, on a phone, for one feature.
 *
 *   MediaPipe Tasks   34MB WASM + 7.8MB model = ~42MB
 *   TFJS lite models  4.1MB, reusing the existing runtime
 *
 * Models are self-hosted (see scripts/fetch-vision-assets.mjs) rather than
 * fetched from tfhub at runtime — the demo cannot depend on network
 * reachability at the moment it runs.
 *
 * product-spec §3.1 lists hand tracking as [ROADMAP], citing battery and
 * thermal cost. The lite models, running post-capture on downscaled frames
 * rather than live on every frame, are what make it affordable now.
 */

import "@tensorflow/tfjs";
import * as handPoseDetection from "@tensorflow-models/hand-pose-detection";
import type { Landmark } from "./framing";

const DETECTOR_URL = "/models/hand/detector/model.json";
const LANDMARK_URL = "/models/hand/landmark/model.json";

type Detector = handPoseDetection.HandDetector;

let cached: Promise<Detector> | null = null;

export function createHandLandmarker(): Promise<Detector> {
  cached ??= handPoseDetection
    .createDetector(handPoseDetection.SupportedModels.MediaPipeHands, {
      runtime: "tfjs",
      modelType: "lite",
      maxHands: 2,
      detectorModelUrl: DETECTOR_URL,
      landmarkModelUrl: LANDMARK_URL,
    })
    .catch((err: unknown) => {
      // Never cache a failure — a transient load error must stay retryable.
      cached = null;
      throw err;
    });

  return cached;
}

/**
 * The tfjs runtime reports keypoints in PIXELS, unlike the MediaPipe Tasks
 * runtime which reports them normalised. The framing scorer works in
 * normalised coordinates so its guide region stays resolution-independent —
 * getting this wrong would silently score every hand as outside the guide.
 */
export function normalizeKeypoints(
  keypoints: ReadonlyArray<{ x: number; y: number }>,
  width: number,
  height: number,
): Landmark[] {
  if (width <= 0 || height <= 0) return [];
  return keypoints.map(({ x, y }) => ({ x: x / width, y: y / height }));
}

/** Free the models. Called when leaving the capture flow. */
export async function disposeHandLandmarker(): Promise<void> {
  if (!cached) return;
  try {
    (await cached).dispose();
  } catch {
    // Already disposed, or never finished loading.
  }
  cached = null;
}
