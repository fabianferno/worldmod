/**
 * Capture backend contract.
 *
 * One interface, three implementations: Chromium (real per-frame capture
 * timestamps), Safari (recorder-anchored), and a mock for UI tests. A
 * capability-detecting factory picks at runtime — neither platform is the
 * designated demo device, so the client records what it actually got rather
 * than what it hoped for.
 *
 * See docs/superpowers/specs/2026-08-23-contributor-pwa-design.md §5.1.
 */

import type { FrameTiming, UaClass } from "@/lib/manifest";
import type { CoarseLocation } from "./geo";
import type { ImuRecording } from "./imu";

export interface VideoDeviceInfo {
  deviceId: string;
  label: string;
}

export interface CaptureCapabilities {
  uaClass: UaClass;
  /** Whether real per-frame capture timestamps are obtainable on this platform. */
  frameTiming: FrameTiming;
  hasCamera: boolean;
  hasMotionSensor: boolean;
  /** Container/codec the platform will actually record, negotiated at probe time. */
  mimeType: string | null;
  videoDevices: VideoDeviceInfo[];
  /** True when the platform exposes enough to choose a wider lens. */
  canSelectLens: boolean;
}

export interface CaptureOpts {
  /** Hard ceiling, from the bounty's duration_range_s. Also the thermal mitigation. */
  maxDurationMs: number;
  audio: boolean;
  /** Prefer the widest available lens — partial mitigation for the FOV problem. */
  preferWidestLens?: boolean;
  /**
   * Record a coarse position. Off unless asked: product-spec §3.1 makes GPS
   * opt-in, and a head-mounted camera plus a location is a far more
   * sensitive record than either alone.
   */
  location?: boolean;
  deviceId?: string;
}

export interface CapturedVideo {
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  /** What the track was configured for. */
  fpsNominal: number;
  /**
   * What was actually delivered. Diverges from nominal under thermal
   * throttling, which is why skew accumulates rather than staying constant.
   */
  fpsObserved: number | null;
  frameCount: number;
  deviceLabel: string | null;
  fovDeg: number | null;
  frameTiming: FrameTiming;
  /**
   * Per-frame capture times in milliseconds from capture start, where the
   * platform provides them. Null on Safari, where they are recovered from
   * decoded container PTS server-side instead.
   */
  frameTimestampsMs: number[] | null;
}

/**
 * Audio is muxed into the video container by a single MediaRecorder rather
 * than captured by a second recorder. Two recorders over one source is a
 * sync problem the flow-vs-gyro check does not need solved.
 */
export interface CapturedAudio {
  blob: Blob;
  mimeType: string;
}

/**
 * A complete capture. The invariant is that stop() returns one of these or
 * throws — a partial episode is discarded, never uploaded.
 */
export interface RawCapture {
  video: CapturedVideo;
  audio: CapturedAudio | null;
  imu: ImuRecording;
  /** OS-fused attitude estimate, when the platform reported one. */
  orientation: { count: number; absolute: boolean } | null;
  /** Coarse position, only when the contributor opted in. */
  location: CoarseLocation | null;
  startedAtEpochMs: number;
  durationMs: number;
  /**
   * Measured offset between the video and IMU clocks where it can be
   * determined, else null. Never a hardcoded constant.
   */
  measuredSkewMs: number | null;
}

export interface CaptureBackend {
  readonly frameTiming: FrameTiming;
  probe(): Promise<CaptureCapabilities>;
  /** Live stream for the viewfinder, available once preview() or start() has run. */
  readonly previewStream: MediaStream | null;
  /**
   * Acquire the camera and expose a live stream WITHOUT recording, so the
   * wearer can check framing first. Given a phone's narrow field of view,
   * discovering the hands are out of frame after a take is too late.
   */
  preview(opts: CaptureOpts): Promise<MediaStream | null>;
  start(opts: CaptureOpts): Promise<void>;
  stop(): Promise<RawCapture>;
  /** Tear down without producing a capture. Safe to call at any time. */
  abort(): void;
}

/** Thrown when capture fails in a way the UI must explain rather than retry blindly. */
export class CaptureError extends Error {
  constructor(
    readonly code:
      | "permission_denied"
      | "no_camera"
      | "no_motion_sensor"
      | "unsupported_mime"
      | "interrupted"
      | "too_short"
      | "not_recording",
    message: string,
  ) {
    super(message);
    this.name = "CaptureError";
  }
}
