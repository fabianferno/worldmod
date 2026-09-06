/**
 * Live analysis during recording.
 *
 * Grading happens on frames as the camera produces them, not on the recorded
 * file. That was originally a thermal decision made the other way, and the
 * device settled it: Chromium's MediaRecorder MP4 declares a near-zero
 * duration, so decoding the recording yielded no frames at all. Sampling the
 * live stream never touches a container, needs no demuxer, and gives the
 * wearer feedback while they can still act on it.
 *
 * The cost is real — inference competes with the encoder for the same thermal
 * budget. Three things keep it affordable:
 *
 *  - Sampling is throttled well below capture rate, and analysis runs on a
 *    downscaled copy.
 *  - Hand detection runs at a fraction of the flow rate; flow is cheap, the
 *    detector is not.
 *  - Ticks are DROPPED while inference is in flight, never queued. A backlog
 *    would grow without bound and turn a slow device into an unresponsive one.
 *  - **Nothing is read back to the CPU on the hot path.** Frames go from the
 *    video element to the GPU and stay there. The first version pulled every
 *    sampled frame down with getImageData and pushed it back up again, and the
 *    recorded video showed the cost: 24.9fps against a nominal 30, ~114 frames
 *    missing from a 15s take, and one 1330ms gap with no video at all — during
 *    the movement the validator most needs to see.
 *
 * fps_observed in the manifest is what will show the cost honestly.
 */

import * as tf from "@tensorflow/tfjs";
import { estimateFlow, grayscaleFromVideo } from "./flow";
import type { FlowSample } from "./correlate";
import type { FrameHands, Landmark } from "./framing";
import { createHandLandmarker, normalizeKeypoints } from "./landmarks";
import { dHash } from "@/lib/validator/phash";

export interface LiveAnalyzerOptions {
  /** Frames per second sampled for optical flow. */
  flowFps?: number;
  /** Run hand detection on one in every N sampled frames. */
  detectEvery?: number;
  /** Longest edge of the analysis canvas. */
  maxEdge?: number;
  /**
   * Hash one in every N sampled frames. Perceptual hashing is the only
   * consumer needing CPU pixels, and a duplicate signature does not need
   * every frame — so the readback it costs is paid rarely.
   */
  hashEvery?: number;
  /** Called whenever a new detection lands, for the overlay. */
  onHands?: (hands: Landmark[][]) => void;
}

const DEFAULTS = { flowFps: 8, detectEvery: 2, maxEdge: 192, hashEvery: 4 } as const;

export interface LiveStats {
  sampledFrames: number;
  detections: number;
  droppedTicks: number;
  /** Mean wall-clock cost of a detection, milliseconds. */
  meanDetectMs: number;
}

export class LiveAnalyzer {
  private readonly video: HTMLVideoElement;
  private readonly opts: Required<Omit<LiveAnalyzerOptions, "onHands">> &
    Pick<LiveAnalyzerOptions, "onHands">;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private rafHandle: number | null = null;
  private running = false;
  private busy = false;

  private t0 = 0;
  private lastSampleMs = -Infinity;
  private tickIndex = 0;

  private prevGray: tf.Tensor4D | null = null;
  private prevT: number | null = null;

  private readonly flow: FlowSample[] = [];
  private readonly hands: FrameHands[] = [];
  /**
   * Perceptual hash per sampled frame.
   *
   * Computed here, on the frames as captured, so the signature is sealed
   * into the manifest alongside the stream digests. Deriving it server-side
   * later would leave it outside the commitment and therefore forgeable.
   */
  private readonly frameHashes: string[] = [];

  /** Most recent frame that actually had hands, kept for the review overlay. */
  private preview: { image: ImageData; hands: FrameHands } | null = null;
  /** Most recent frame pulled to the CPU, reused for the review overlay. */
  private lastImage: { image: ImageData; t: number } | null = null;

  private sampled = 0;
  private detections = 0;
  private dropped = 0;
  private detectMsTotal = 0;

  constructor(video: HTMLVideoElement, options: LiveAnalyzerOptions = {}) {
    this.video = video;
    this.opts = { ...DEFAULTS, ...options };
  }

  /**
   * Load the model and backend before recording starts.
   *
   * Warming up here rather than on the first frame keeps a multi-second model
   * load out of the beginning of every episode, where it would silently cost
   * the wearer the first seconds of their take.
   */
  async warmUp(): Promise<void> {
    for (const backend of ["webgl", "cpu"]) {
      try {
        if (await tf.setBackend(backend)) break;
      } catch {
        // Try the next.
      }
    }
    await tf.ready();
    await createHandLandmarker();
  }

  start(): void {
    if (this.running) return;

    const width = this.video.videoWidth;
    const height = this.video.videoHeight;
    if (!width || !height) throw new Error("Preview has no dimensions yet.");

    const scale = Math.min(1, this.opts.maxEdge / Math.max(width, height));
    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.max(2, Math.round(width * scale));
    this.canvas.height = Math.max(2, Math.round(height * scale));
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });

    this.running = true;
    this.t0 = performance.now();
    this.lastSampleMs = -Infinity;
    this.tickIndex = 0;

    this.rafHandle = requestAnimationFrame(this.tick);
  }

  private readonly tick = (): void => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.tick);

    const now = performance.now();
    if (now - this.lastSampleMs < 1000 / this.opts.flowFps) return;

    // Dropping while busy is deliberate: queueing would build a backlog that
    // outlives the recording and make the device progressively less responsive.
    if (this.busy) {
      this.dropped++;
      return;
    }

    this.lastSampleMs = now;
    void this.analyzeFrame(now - this.t0);
  };

  private async analyzeFrame(t: number): Promise<void> {
    this.busy = true;
    try {
      this.sampled++;
      const index = this.tickIndex++;

      // The only CPU readback, and only occasionally.
      if (index % this.opts.hashEvery === 0) this.hashFrame(t);

      if (index % this.opts.detectEvery === 0) await this.detect(t);
      await this.trackFlow(t);
    } catch {
      // A single bad frame must never end the recording.
    } finally {
      this.busy = false;
    }
  }

  /** Perceptual signature for duplicate detection; needs pixels on the CPU. */
  private hashFrame(t: number): void {
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;

    try {
      ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      this.frameHashes.push(dHash(image));
      this.lastImage = { image, t };
    } catch {
      // A degenerate frame is not worth failing the episode over.
    }
  }

  private async detect(t: number): Promise<void> {
    const detector = await createHandLandmarker();
    const started = performance.now();

    // The video element goes straight to the detector; no readback.
    const found = await detector.estimateHands(this.video, { flipHorizontal: false });
    this.detectMsTotal += performance.now() - started;
    this.detections++;

    const width = this.video.videoWidth || 1;
    const height = this.video.videoHeight || 1;
    const hands = found.map((h) => normalizeKeypoints(h.keypoints, width, height));
    const frame: FrameHands = { t, hands };
    this.hands.push(frame);

    // Retaining a frame with hands means the review overlay can show why a
    // score came out as it did, rather than an arbitrary empty frame. It uses
    // the most recent hashed frame, since that is the only one on the CPU.
    if (hands.some((h) => h.length > 0) && this.lastImage) {
      this.preview = { image: this.lastImage.image, hands: frame };
    }

    this.opts.onHands?.(hands);
  }

  private async trackFlow(t: number): Promise<void> {
    const gray = grayscaleFromVideo(this.video, this.opts.maxEdge);

    if (this.prevGray && this.prevT !== null) {
      const dtSeconds = (t - this.prevT) / 1000;
      if (dtSeconds > 0) {
        const estimate = await estimateFlow(this.prevGray, gray);
        if (estimate) {
          this.flow.push({
            t0: this.prevT,
            t1: t,
            u: estimate.u / dtSeconds,
            v: estimate.v / dtSeconds,
          });
        }
      }
      this.prevGray.dispose();
    }

    this.prevGray = gray;
    this.prevT = t;
  }

  /** Stop sampling and hand back everything accumulated. */
  stop(): {
    flow: FlowSample[];
    hands: FrameHands[];
    stats: LiveStats;
    preview: { image: ImageData; hands: FrameHands } | null;
    frameHashes: string[];
  } {
    this.running = false;
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;

    this.prevGray?.dispose();
    this.prevGray = null;
    this.prevT = null;

    return {
      flow: [...this.flow],
      hands: [...this.hands],
      preview: this.preview,
      frameHashes: [...this.frameHashes],
      stats: {
        sampledFrames: this.sampled,
        detections: this.detections,
        droppedTicks: this.dropped,
        meanDetectMs: this.detections === 0 ? 0 : this.detectMsTotal / this.detections,
      },
    };
  }

  dispose(): void {
    if (this.running) this.stop();
    this.canvas = null;
    this.ctx = null;
  }
}
