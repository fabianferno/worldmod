/**
 * Post-capture quality analysis.
 *
 * Joins the two meters a contributor needs before uploading:
 *
 *   framing      — were the hands where the task needs them? (landmarks)
 *   plausibility — does the image motion match the gyro? (flow vs IMU)
 *
 * They answer different questions. A perfectly authentic episode that never
 * caught the hands is useless data; a beautifully framed screen replay is
 * fraud. Neither meter subsumes the other.
 */

import * as tf from "@tensorflow/tfjs";
import type { RawCapture } from "@/lib/capture";
import { plausibility, type FlowSample, type PlausibilityReport } from "./correlate";
import { estimateFlow, toGrayscale } from "./flow";
import { extractFrames, type SampledFrame } from "./frames";
import { framingScore, type FrameHands, type FramingReport } from "./framing";
import { detectHands } from "./landmarks";

export type AnalysisStage = "extracting" | "framing" | "motion" | "done";

export interface QualityReport {
  framing: FramingReport;
  plausibility: PlausibilityReport;
  framesAnalyzed: number;
  /** Per-frame landmarks, retained so the review view can draw the pivots. */
  hands: FrameHands[];
  /**
   * One representative frame with its landmarks, for the pivot overlay.
   * Prefers a frame where hands were actually detected — showing an empty
   * frame would tell the contributor nothing about why they scored low.
   */
  preview: { image: ImageData; hands: FrameHands } | null;
  elapsedMs: number;
  backend: string;
}

export interface AnalyzeOptions {
  onProgress?: (stage: AnalysisStage, done: number, total: number) => void;
  signal?: AbortSignal;
  targetFps?: number;
  maxEdge?: number;
}

/**
 * Prefer WebGL, fall back to CPU.
 *
 * On a phone that has just finished encoding video the GPU path matters: the
 * CPU backend is roughly an order of magnitude slower and would leave the
 * contributor staring at a spinner.
 */
async function selectBackend(): Promise<string> {
  for (const backend of ["webgl", "cpu"]) {
    try {
      if (await tf.setBackend(backend)) {
        await tf.ready();
        return backend;
      }
    } catch {
      // Try the next one.
    }
  }
  await tf.ready();
  return tf.getBackend();
}

/** Image motion between consecutive sampled frames, in pixels per second. */
async function flowSeries(
  frames: readonly SampledFrame[],
  options: AnalyzeOptions,
): Promise<FlowSample[]> {
  const out: FlowSample[] = [];
  if (frames.length < 2) return out;

  let prev = toGrayscale(frames[0].image);

  try {
    for (let i = 1; i < frames.length; i++) {
      if (options.signal?.aborted) break;

      const next = toGrayscale(frames[i].image);
      const t0 = frames[i - 1].t;
      const t1 = frames[i].t;
      const dtSeconds = (t1 - t0) / 1000;

      const flow = dtSeconds > 0 ? await estimateFlow(prev, next, {}) : null;
      if (flow) {
        // Per-second rates, so intervals of differing length stay comparable.
        out.push({ t0, t1, u: flow.u / dtSeconds, v: flow.v / dtSeconds });
      }

      prev.dispose();
      prev = next;
      options.onProgress?.("motion", i, frames.length - 1);
    }
  } finally {
    prev.dispose();
  }

  return out;
}

/** The most informative frame to show back: one with hands, else the middle. */
function pickPreview(
  frames: readonly SampledFrame[],
  hands: readonly FrameHands[],
): { image: ImageData; hands: FrameHands } | null {
  if (frames.length === 0) return null;

  const withHands = hands.findIndex((f) => f.hands.some((h) => h.length > 0));
  const index = withHands >= 0 ? withHands : Math.floor(frames.length / 2);
  const frame = frames[index];
  if (!frame) return null;

  return { image: frame.image, hands: hands[index] ?? { t: frame.t, hands: [] } };
}

export async function analyzeCapture(
  capture: RawCapture,
  options: AnalyzeOptions = {},
): Promise<QualityReport> {
  const started = performance.now();
  const backend = await selectBackend();

  const frames = await extractFrames(capture.video.blob, {
    targetFps: options.targetFps,
    maxEdge: options.maxEdge,
    signal: options.signal,
    onProgress: (done, total) => options.onProgress?.("extracting", done, total),
  });

  const hands = await detectHands(frames, {
    signal: options.signal,
    onProgress: (done, total) => options.onProgress?.("framing", done, total),
  });

  const flow = await flowSeries(frames, options);

  options.onProgress?.("done", 1, 1);

  return {
    preview: pickPreview(frames, hands),
    framing: framingScore(hands),
    plausibility: plausibility(flow, capture.imu.stream.samples),
    framesAnalyzed: frames.length,
    hands,
    elapsedMs: performance.now() - started,
    backend,
  };
}
