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
 *  - **Nothing is read back to the CPU on the hot path.** The expensive step
 *    was getImageData, which forces a synchronous GPU-to-CPU readback and
 *    flushes the pipeline; the recorded video showed the cost as 24.9fps
 *    against a nominal 30, ~114 frames missing from a 15s take, and one 1330ms
 *    gap with no video at all — during the movement the validator most needs.
 *
    Two input paths, deliberately:
 *
 *      flow      reads the canvas as a GPU texture, no readback at all;
 *      detection is handed ImageData, which is the input it demonstrably
 *                works with on this device.
 *
 *    Reading the video element directly was tried and reverted — Android
 *    delivers a hardware-decoded texture that can come back empty with nothing
 *    raised. Passing the canvas to the detector was tried and also reverted:
 *    flow kept working through the very same canvas (motion scored 75% on a
 *    real take) while detection returned nothing, so the canvas was fine and
 *    the detector's handling of it was not.
 *
 *    The readback therefore stays, but only on detection ticks — half as often
 *    as the version whose stalls started all this.
 *
 * fps_observed in the manifest is what will show the cost honestly.
 */

import * as tf from "@tensorflow/tfjs";
import { estimateFlow, grayscaleFromCanvas } from "./flow";
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
  /** Ticks that threw. A silent zero here is the difference between
   *  'no hands in frame' and 'detection is broken', and the two look
   *  identical to a contributor. */
  errors: number;
  lastError: string | null;
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
  private errors = 0;
  private lastError: string | null = null;

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
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;

    this.busy = true;
    try {
      this.sampled++;
      const index = this.tickIndex++;

      // One rasterisation per tick; Android's video texture cannot be read
      // directly, so everything downstream works from this canvas.
      ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);

      const detecting = index % this.opts.detectEvery === 0;
      const hashing = index % this.opts.hashEvery === 0;

      // One readback shared by both consumers that need CPU pixels.
      const image = detecting || hashing ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;

      if (image && hashing) this.hashFrame(image, t);
      if (image && detecting) await this.detect(image, t);

      await this.trackFlow(t);
    } catch (err) {
      // A single bad frame must never end the recording — but a run of them is
      // a broken tracker, and swallowing that silently made it indisting-
      // uishable from a wearer holding their hands out of frame.
      this.errors++;
      this.lastError = err instanceof Error ? err.message : String(err);
      if (this.errors <= 3) console.error("[LiveAnalyzer] frame failed:", err);
    } finally {
      this.busy = false;
    }
  }

  /** Perceptual signature for duplicate detection. */
  private hashFrame(image: ImageData, t: number): void {
    try {
      this.frameHashes.push(dHash(image));
      this.lastImage = { image, t };
    } catch {
      // A degenerate frame is not worth failing the episode over.
    }
  }

  private async detect(image: ImageData, t: number): Promise<void> {
    const detector = await createHandLandmarker();
    const started = performance.now();

    // ImageData, not the canvas — see the note at the top of the file.
    const found = await detector.estimateHands(image, { flipHorizontal: false });
    this.detectMsTotal += performance.now() - started;
    this.detections++;

    const hands = found.map((h) => normalizeKeypoints(h.keypoints, image.width, image.height));
    const frame: FrameHands = { t, hands };
    this.hands.push(frame);

    // Retaining a frame with hands means the review overlay can show why a
    // score came out as it did, rather than an arbitrary empty frame. It uses
    // the most recent hashed frame, since that is the only one on the CPU.
    if (hands.some((h) => h.length > 0)) this.preview = { image, hands: frame };

    this.opts.onHands?.(hands);
  }

  private async trackFlow(t: number): Promise<void> {
    const gray = grayscaleFromCanvas(this.canvas!);

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
        errors: this.errors,
        lastError: this.lastError,
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
