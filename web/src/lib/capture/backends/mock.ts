/**
 * Deterministic capture backend for UI tests and local development without a
 * camera. Produces a well-formed RawCapture so every consumer downstream —
 * manifest assembly, hashing, upload — can be exercised end to end.
 */

import type { FrameTiming } from "@/lib/manifest";
import type { ImuRecording } from "../imu";
import {
  CaptureError,
  type CaptureBackend,
  type CaptureCapabilities,
  type CaptureOpts,
  type RawCapture,
} from "../types";

export interface MockCaptureOptions {
  durationMs?: number;
  fps?: number;
  imuRateHz?: number;
  /** Force a specific failure, to exercise the UI's error states. */
  failWith?: CaptureError;
}

function syntheticImu(durationMs: number, rateHz: number): ImuRecording {
  const count = Math.max(0, Math.floor((durationMs / 1000) * rateHz));
  const step = 1000 / rateHz;

  const samples = Array.from({ length: count }, (_, i) => {
    const t = i * step;
    // A slow head sweep, so flow-vs-gyro fixtures have something to correlate.
    const phase = (t / 1000) * 0.5 * Math.PI * 2;
    return {
      t,
      ax: 0,
      ay: 0,
      az: 9.8125,
      rx: Math.sin(phase) * 12,
      ry: Math.cos(phase) * 4,
      rz: 0,
    };
  });

  const span = samples.length > 1 ? samples[samples.length - 1].t - samples[0].t : 0;

  return {
    stream: { startedAtEpochMs: 1786550400123, samples },
    rateHzObserved: span > 0 ? ((samples.length - 1) / span) * 1000 : 0,
    samples: samples.length,
    accelSource: "linear",
    screenOrientation: "portrait-primary",
    durationMs,
  };
}

export class MockCapture implements CaptureBackend {
  private running = false;
  private readonly opts: Required<Omit<MockCaptureOptions, "failWith">> &
    Pick<MockCaptureOptions, "failWith">;

  constructor(options: MockCaptureOptions = {}) {
    this.opts = {
      durationMs: options.durationMs ?? 15_000,
      fps: options.fps ?? 30,
      imuRateHz: options.imuRateHz ?? 58.7,
      failWith: options.failWith,
    };
  }

  get frameTiming(): FrameTiming {
    return "track_processor";
  }

  get previewStream(): MediaStream | null {
    return null;
  }

  async probe(): Promise<CaptureCapabilities> {
    return {
      uaClass: "desktop_chrome",
      frameTiming: "track_processor",
      hasCamera: true,
      hasMotionSensor: true,
      mimeType: "video/webm;codecs=vp9,opus",
      videoDevices: [{ deviceId: "mock-wide", label: "Mock Wide Camera" }],
      canSelectLens: true,
    };
  }

  async preview(_opts: CaptureOpts): Promise<MediaStream | null> {
    void _opts;
    return null;
  }

  async start(_opts: CaptureOpts): Promise<void> {
    void _opts;
    if (this.running) throw new CaptureError("not_recording", "Mock capture already running.");
    if (this.opts.failWith) throw this.opts.failWith;
    this.running = true;
  }

  async stop(): Promise<RawCapture> {
    if (!this.running) {
      throw new CaptureError("not_recording", "stop() called with no capture in progress.");
    }
    this.running = false;

    const { durationMs, fps, imuRateHz } = this.opts;
    const frameCount = Math.floor((durationMs / 1000) * fps);
    const frameTimestampsMs = Array.from({ length: frameCount }, (_, i) => (i * 1000) / fps);

    return {
      video: {
        blob: new Blob([new Uint8Array(1024)], { type: "video/webm" }),
        mimeType: "video/webm;codecs=vp9,opus",
        width: 1280,
        height: 720,
        fpsNominal: fps,
        fpsObserved: fps,
        frameCount,
        deviceLabel: "Mock Wide Camera",
        fovDeg: null,
        frameTiming: "track_processor",
        frameTimestampsMs,
      },
      audio: null,
      imu: syntheticImu(durationMs, imuRateHz),
      orientation: { count: 120, absolute: false },
      location: null,
      startedAtEpochMs: 1786550400123,
      durationMs,
      measuredSkewMs: 4.2,
    };
  }

  abort(): void {
    this.running = false;
  }
}
