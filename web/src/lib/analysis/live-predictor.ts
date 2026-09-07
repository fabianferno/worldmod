/**
 * The live "what happens next" overlay — product-spec §8.2's rollout
 * visualisation, running during capture instead of once over a finished
 * episode.
 *
 * Mirrors LiveAnalyzer's discipline deliberately: a RAF tick loop throttled
 * well below the encoder's frame rate, drop-when-busy rather than queueing,
 * and everything heavy done off the device. The lesson that produced that
 * pattern — on-device inference stealing frames from the encoder, see
 * live.ts's header — applies here too, so this does *no* local inference at
 * all. It grabs a small square crop, ships the raw pixels to the server, and
 * waits; the encoder and the dynamics head both run in Node, per
 * lib/worldmodel/predict.ts.
 *
 * A missing model (nobody has run trainer/export_live.py) is a normal state,
 * not a failure: this checks once at start and simply never ticks if there is
 * nothing to call.
 */

import { motionTupleFrom, type MotionLike } from "../capture/imu";

export interface LivePrediction {
  /** The nearest frame the model has actually seen so far this take. */
  image: ImageData;
  /** Squared distance in the model's own latent space; smaller is closer. */
  distance: number;
  /** True while there are too few prior frames to compare against yet. */
  warming: boolean;
}

export interface LivePredictorOptions {
  /** Throttled well under the hand overlay's rate — this is a network round trip. */
  predictFps?: number;
  onPrediction?: (prediction: LivePrediction) => void;
  /** Called once if no exported model is available; the caller can hide the panel. */
  onUnavailable?: () => void;
}

const DEFAULTS = { predictFps: 2 } as const;

export class LivePredictor {
  private readonly video: HTMLVideoElement;
  private readonly sessionId: string;
  private readonly opts: Required<Omit<LivePredictorOptions, "onPrediction" | "onUnavailable">> &
    Pick<LivePredictorOptions, "onPrediction" | "onUnavailable">;

  private cropCanvas: HTMLCanvasElement | null = null;
  private cropCtx: CanvasRenderingContext2D | null = null;
  private frameSize = 0;

  private running = false;
  private busy = false;
  private available = false;
  private lastTickMs = -Infinity;
  private rafHandle: number | null = null;

  private motion = { ax: 0, ay: 0, az: 0, rx: 0, ry: 0, rz: 0 };
  private readonly onMotion = (event: Event): void => {
    const sample = motionTupleFrom(event as unknown as MotionLike);
    this.motion = { ax: sample.ax, ay: sample.ay, az: sample.az, rx: sample.rx, ry: sample.ry, rz: sample.rz };
  };

  constructor(video: HTMLVideoElement, sessionId: string, options: LivePredictorOptions = {}) {
    this.video = video;
    this.sessionId = sessionId;
    this.opts = { ...DEFAULTS, ...options };
  }

  /**
   * Check once whether a model is exported, and size the crop canvas to
   * whatever it expects. Call before start(), same as LiveAnalyzer.warmUp().
   */
  async warmUp(): Promise<void> {
    try {
      const response = await fetch("/api/world/predict");
      const data = (await response.json()) as { available: boolean; size?: number };
      this.available = data.available && typeof data.size === "number";
      if (this.available && data.size) {
        this.frameSize = data.size;
        this.cropCanvas = document.createElement("canvas");
        this.cropCanvas.width = data.size;
        this.cropCanvas.height = data.size;
        this.cropCtx = this.cropCanvas.getContext("2d", { willReadFrequently: true });
      }
    } catch {
      this.available = false;
    }
    if (!this.available) this.opts.onUnavailable?.();
  }

  start(): void {
    if (!this.available || this.running) return;

    window.addEventListener("devicemotion", this.onMotion);
    this.running = true;
    this.lastTickMs = -Infinity;
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  private readonly tick = (): void => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.tick);

    const now = performance.now();
    if (now - this.lastTickMs < 1000 / this.opts.predictFps) return;
    if (this.busy) return; // Drop, not queue — same reasoning as LiveAnalyzer.

    this.lastTickMs = now;
    void this.predict();
  };

  private async predict(): Promise<void> {
    const ctx = this.cropCtx;
    const canvas = this.cropCanvas;
    if (!ctx || !canvas) return;

    this.busy = true;
    try {
      const vw = this.video.videoWidth;
      const vh = this.video.videoHeight;
      if (!vw || !vh) return;

      // Centre-crop to a square, matching extract_frames() in the trainer's
      // data.py exactly: same edge length, same origin. A different crop here
      // would feed the encoder a distribution it never trained on.
      const edge = Math.min(vw, vh);
      const sx = (vw - edge) / 2;
      const sy = (vh - edge) / 2;
      ctx.drawImage(this.video, sx, sy, edge, edge, 0, 0, canvas.width, canvas.height);

      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const rgb = new Uint8Array(this.frameSize * this.frameSize * 3);
      for (let i = 0, j = 0; i < image.data.length; i += 4, j += 3) {
        rgb[j] = image.data[i];
        rgb[j + 1] = image.data[i + 1];
        rgb[j + 2] = image.data[i + 2];
      }

      const { ax, ay, az, rx, ry, rz } = this.motion;
      const params = new URLSearchParams({
        session: this.sessionId,
        ax: String(ax), ay: String(ay), az: String(az),
        rx: String(rx), ry: String(ry), rz: String(rz),
      });

      const response = await fetch(`/api/world/predict?${params}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: rgb as BodyInit,
      });
      if (!response.ok) return;

      const thumbBytes = new Uint8Array(await response.arrayBuffer());
      const size = Number(response.headers.get("x-thumbnail-size") ?? 0);
      if (!size || thumbBytes.length !== size * size * 3) return;

      const thumbImage = new ImageData(size, size);
      for (let i = 0, j = 0; i < thumbBytes.length; i += 3, j += 4) {
        thumbImage.data[j] = thumbBytes[i];
        thumbImage.data[j + 1] = thumbBytes[i + 1];
        thumbImage.data[j + 2] = thumbBytes[i + 2];
        thumbImage.data[j + 3] = 255;
      }

      this.opts.onPrediction?.({
        image: thumbImage,
        distance: Number(response.headers.get("x-distance") ?? 0),
        warming: response.headers.get("x-warming") === "true",
      });
    } catch {
      // A dropped prediction is not a failed take; just skip this tick.
    } finally {
      this.busy = false;
    }
  }

  stop(): void {
    this.running = false;
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
    window.removeEventListener("devicemotion", this.onMotion);
  }

  dispose(): void {
    if (this.running) this.stop();
    this.cropCanvas = null;
    this.cropCtx = null;
  }
}
