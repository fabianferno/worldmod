/**
 * The live overlay — hand landmarks only.
 *
 * Draws the skeleton so a wearer can fix their framing mid-take, and does
 * nothing else. Scoring is the server's job.
 *
 * It used to score here too, and the recordings showed what that cost: 26.9fps
 * against a nominal 30, 49 gaps longer than 1.5x the frame interval, the worst
 * 818ms — and those gaps land during movement, which is exactly what the motion
 * check needs to see. The phone was damaging the footage in order to grade it.
 *
 * Optical flow is gone from the device entirely; it ran every tick and was the
 * bulk of the load. Detection stays because it is the only thing that can stop
 * a wasted take: a wearer who cannot see their hands in the overlay can tilt
 * the phone before the fifteen seconds are gone. A client-computed score could
 * never have been authoritative anyway — the contributor owns the device.
 */

import * as tf from "@tensorflow/tfjs";
import type { Landmark } from "./framing";
import { createHandLandmarker, normalizeKeypoints } from "./landmarks";

export interface LiveOverlayOptions {
  /** Overlay refresh rate. Low on purpose — the encoder has priority. */
  detectFps?: number;
  /** Longest edge of the analysis canvas. */
  maxEdge?: number;
  onHands?: (hands: Landmark[][]) => void;
}

const DEFAULTS = { detectFps: 3, maxEdge: 192 } as const;

export interface OverlayStats {
  detections: number;
  droppedTicks: number;
  /** A run of these means a broken tracker, not a wearer with hands out of frame. */
  errors: number;
  lastError: string | null;
  meanDetectMs: number;
}

export class LiveAnalyzer {
  private readonly video: HTMLVideoElement;
  private readonly opts: Required<Omit<LiveOverlayOptions, "onHands">> &
    Pick<LiveOverlayOptions, "onHands">;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private rafHandle: number | null = null;
  private running = false;
  private busy = false;
  private lastSampleMs = -Infinity;

  private detections = 0;
  private dropped = 0;
  private detectMsTotal = 0;
  private errors = 0;
  private lastError: string | null = null;

  constructor(video: HTMLVideoElement, options: LiveOverlayOptions = {}) {
    this.video = video;
    this.opts = { ...DEFAULTS, ...options };
  }

  /**
   * Load the model before recording starts.
   *
   * Warming up here keeps a multi-second model load out of the beginning of
   * every take, where it would silently cost the wearer their first seconds.
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
    this.lastSampleMs = -Infinity;
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  private readonly tick = (): void => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.tick);

    const now = performance.now();
    if (now - this.lastSampleMs < 1000 / this.opts.detectFps) return;

    // Dropping while busy is deliberate: queueing would build a backlog that
    // outlives the recording and make the device progressively less responsive.
    if (this.busy) {
      this.dropped++;
      return;
    }

    this.lastSampleMs = now;
    void this.detect();
  };

  private async detect(): Promise<void> {
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;

    this.busy = true;
    try {
      // Rasterise through the canvas: Android hands over a hardware-decoded
      // video texture that reads as empty, silently.
      ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const detector = await createHandLandmarker();
      const started = performance.now();
      // ImageData, not the canvas — passing the canvas returned nothing.
      const found = await detector.estimateHands(image, { flipHorizontal: false });

      this.detectMsTotal += performance.now() - started;
      this.detections++;

      this.opts.onHands?.(
        found.map((hand) => normalizeKeypoints(hand.keypoints, image.width, image.height)),
      );
    } catch (err) {
      // A single bad frame must not end the recording, but a run of them is a
      // broken tracker — and swallowing that made it indistinguishable from a
      // wearer holding their hands out of frame.
      this.errors++;
      this.lastError = err instanceof Error ? err.message : String(err);
      if (this.errors <= 3) console.error("[LiveOverlay] frame failed:", err);
    } finally {
      this.busy = false;
    }
  }

  stop(): OverlayStats {
    this.running = false;
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;

    return {
      detections: this.detections,
      droppedTicks: this.dropped,
      errors: this.errors,
      lastError: this.lastError,
      meanDetectMs: this.detections === 0 ? 0 : this.detectMsTotal / this.detections,
    };
  }

  dispose(): void {
    if (this.running) this.stop();
    this.canvas = null;
    this.ctx = null;
  }
}
