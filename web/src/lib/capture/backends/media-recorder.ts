/**
 * MediaRecorder capture backend — the Safari path, and the base the Chromium
 * path extends.
 *
 * Timestamps are anchored at MediaRecorder.onstart rather than at start()
 * being called: the gap between requesting a recording and the encoder
 * actually beginning is not negligible on a cold camera, and anchoring at the
 * wrong end of it puts a fixed error into every episode's sync.
 *
 * fpsObserved is null here. Safari exposes no per-frame capture timestamps, so
 * the honest client-side answer is "unknown" — it gets derived from decoded
 * container PTS server-side and lives outside the signed commitment.
 *
 * See docs/superpowers/specs/2026-08-23-contributor-pwa-design.md §5.1, §5.2.
 */

import { detectFrameTiming, fovFromSettings, negotiateMimeType } from "../detect";
import { ImuRecorder } from "../imu";
import {
  CaptureError,
  type CaptureBackend,
  type CaptureCapabilities,
  type CaptureOpts,
  type RawCapture,
  type VideoDeviceInfo,
} from "../types";
import { classifyUserAgent } from "../detect";
import type { FrameTiming } from "@/lib/manifest";

/** Minimum useful episode. Shorter than this is a misfire, not a contribution. */
const MIN_DURATION_MS = 1_000;

export class MediaRecorderCapture implements CaptureBackend {
  protected stream: MediaStream | null = null;
  protected recorder: MediaRecorder | null = null;
  protected imu: ImuRecorder | null = null;

  private chunks: Blob[] = [];
  private mimeType = "";
  private startedAtEpochMs = 0;
  private t0 = 0;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private recorderError: Error | null = null;

  get frameTiming(): FrameTiming {
    return "recorder_anchored";
  }

  get previewStream(): MediaStream | null {
    return this.stream;
  }

  async probe(): Promise<CaptureCapabilities> {
    const uaClass = classifyUserAgent({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints ?? 0,
    });

    let videoDevices: VideoDeviceInfo[] = [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      videoDevices = devices
        .filter((d) => d.kind === "videoinput")
        .map((d) => ({ deviceId: d.deviceId, label: d.label }));
    } catch {
      // enumerateDevices can reject before any permission has been granted.
      videoDevices = [];
    }

    return {
      uaClass,
      frameTiming: detectFrameTiming(),
      hasCamera: videoDevices.length > 0 || !!navigator.mediaDevices?.getUserMedia,
      hasMotionSensor: "DeviceMotionEvent" in globalThis,
      mimeType: negotiateMimeType(),
      videoDevices,
      // Labels are empty until permission is granted, and Safari does not
      // reliably surface the ultra-wide lens even once it is.
      canSelectLens: videoDevices.filter((d) => d.label !== "").length > 1,
    };
  }

  async preview(opts: CaptureOpts): Promise<MediaStream> {
    this.stream ??= await this.acquireStream(opts);
    return this.stream;
  }

  async start(opts: CaptureOpts): Promise<void> {
    if (this.recorder) throw new CaptureError("not_recording", "Capture already in progress.");

    const mimeType = negotiateMimeType();
    if (!mimeType) {
      throw new CaptureError(
        "unsupported_mime",
        "This browser cannot record any container this client understands.",
      );
    }
    this.mimeType = mimeType;

    // Reuse the viewfinder stream when preview() already acquired one;
    // re-acquiring mid-session costs a visible camera restart.
    this.stream ??= await this.acquireStream(opts);
    await this.onStreamAcquired(this.stream);

    this.recorder = new MediaRecorder(this.stream, { mimeType });
    this.chunks = [];
    this.recorderError = null;

    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.onerror = () => {
      this.recorderError = new CaptureError(
        "interrupted",
        "Recording was interrupted by the browser.",
      );
    };

    this.imu = new ImuRecorder();

    await new Promise<void>((resolve, reject) => {
      const rec = this.recorder!;
      rec.onstart = () => {
        // Anchor both clocks at the moment encoding actually begins.
        this.t0 = performance.now();
        this.startedAtEpochMs = Date.now();
        this.imu!.start();
        resolve();
      };
      const failed = () =>
        reject(new CaptureError("interrupted", "Recorder failed to start."));
      rec.addEventListener("error", failed, { once: true });

      try {
        rec.start();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    // Hard ceiling from the bounty's duration range; also the thermal mitigation.
    this.stopTimer = setTimeout(() => {
      if (this.recorder?.state === "recording") this.recorder.stop();
    }, opts.maxDurationMs);
  }

  async stop(): Promise<RawCapture> {
    const recorder = this.recorder;
    const imu = this.imu;
    if (!recorder || !imu) {
      throw new CaptureError("not_recording", "stop() called with no capture in progress.");
    }

    this.clearStopTimer();

    if (recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.stop();
      });
    }

    const imuRecording = imu.stop();
    const durationMs = performance.now() - this.t0;
    const videoDetail = await this.collectVideoDetail();
    const track = this.stream?.getVideoTracks()[0] ?? null;
    const settings = track?.getSettings() ?? {};

    this.releaseStream();

    if (this.recorderError) {
      this.reset();
      throw this.recorderError;
    }

    const blob = new Blob(this.chunks, { type: this.mimeType });
    if (blob.size === 0) {
      this.reset();
      throw new CaptureError("interrupted", "Recording produced no data.");
    }
    if (durationMs < MIN_DURATION_MS) {
      this.reset();
      throw new CaptureError(
        "too_short",
        `Episode was ${Math.round(durationMs)}ms; too short to be useful.`,
      );
    }

    const capture: RawCapture = {
      video: {
        blob,
        mimeType: this.mimeType,
        width: settings.width ?? 0,
        height: settings.height ?? 0,
        fpsNominal: settings.frameRate ?? 0,
        fpsObserved: videoDetail.fpsObserved,
        frameCount: videoDetail.frameCount,
        deviceLabel: track?.label ?? null,
        fovDeg: fovFromSettings(settings),
        frameTiming: this.frameTiming,
        frameTimestampsMs: videoDetail.frameTimestampsMs,
      },
      audio: null,
      imu: imuRecording,
      startedAtEpochMs: this.startedAtEpochMs,
      durationMs,
      measuredSkewMs: videoDetail.measuredSkewMs,
    };

    this.reset();
    return capture;
  }

  abort(): void {
    this.clearStopTimer();
    try {
      if (this.recorder?.state !== "inactive") this.recorder?.stop();
    } catch {
      // Already torn down; nothing to salvage.
    }
    this.imu?.abort();
    this.releaseStream();
    this.reset();
  }

  // --- extension points for the Chromium backend -------------------------

  /** Hook for subclasses to tap the track before recording begins. */
  protected async onStreamAcquired(_stream: MediaStream): Promise<void> {
    void _stream;
  }

  /**
   * Per-frame detail, where the platform can supply it. The base class cannot,
   * and says so rather than guessing.
   */
  protected async collectVideoDetail(): Promise<{
    frameCount: number;
    fpsObserved: number | null;
    frameTimestampsMs: number[] | null;
    measuredSkewMs: number | null;
  }> {
    return { frameCount: 0, fpsObserved: null, frameTimestampsMs: null, measuredSkewMs: null };
  }

  protected get captureStartMs(): number {
    return this.t0;
  }

  // --- internals ---------------------------------------------------------

  private async acquireStream(opts: CaptureOpts): Promise<MediaStream> {
    const video: MediaTrackConstraints = {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    };
    if (opts.deviceId) video.deviceId = { exact: opts.deviceId };

    try {
      return await navigator.mediaDevices.getUserMedia({ video, audio: opts.audio });
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new CaptureError("permission_denied", "Camera permission was denied.");
      }
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        throw new CaptureError("no_camera", "No usable camera was found.");
      }
      throw err;
    }
  }

  private releaseStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private clearStopTimer(): void {
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }

  private reset(): void {
    this.recorder = null;
    this.imu = null;
    this.chunks = [];
  }
}
