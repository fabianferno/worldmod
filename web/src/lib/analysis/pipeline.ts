/**
 * Quality report assembly.
 *
 * Joins the two meters a contributor needs before uploading:
 *
 *   framing      — were the hands where the task needs them? (landmarks)
 *   plausibility — does the image motion match the gyro? (flow vs IMU)
 *
 * They answer different questions. A perfectly authentic episode that never
 * caught the hands is useless data; a beautifully framed screen replay is
 * fraud. Neither meter subsumes the other.
 *
 * Both inputs are gathered live during recording by LiveAnalyzer, so this is
 * pure assembly — no decoding, no inference, no I/O.
 */

import * as tf from "@tensorflow/tfjs";
import type { ImuSample } from "@/lib/capture";
import { plausibility, type FlowSample, type PlausibilityReport } from "./correlate";
import { framingScore, type FrameHands, type FramingReport } from "./framing";
import type { LiveStats } from "./live";
import { episodeSignature } from "@/lib/validator/phash";

export interface QualityReport {
  framing: FramingReport;
  plausibility: PlausibilityReport;
  /** Frames sampled for analysis — not the number of frames recorded. */
  framesAnalyzed: number;
  hands: FrameHands[];
  /**
   * A frame that had hands, with its landmarks, for the review overlay.
   * Showing an empty frame would tell the contributor nothing about why they
   * scored as they did.
   */
  preview: { image: ImageData; hands: FrameHands } | null;
  stats: LiveStats;
  /** Perceptual signature, for near-duplicate detection. */
  signature: string[];
  backend: string;
}

export interface FinalizeInput {
  flow: readonly FlowSample[];
  hands: readonly FrameHands[];
  imu: readonly ImuSample[];
  stats: LiveStats;
  preview: { image: ImageData; hands: FrameHands } | null;
  frameHashes?: readonly string[];
}

export function finalizeQuality({
  flow,
  hands,
  imu,
  stats,
  preview,
  frameHashes,
}: FinalizeInput): QualityReport {
  return {
    framing: framingScore(hands),
    plausibility: plausibility(flow, imu),
    framesAnalyzed: stats.sampledFrames,
    hands: [...hands],
    preview,
    stats,
    signature: episodeSignature(frameHashes ?? []),
    backend: tf.getBackend(),
  };
}
