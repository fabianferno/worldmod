/**
 * IMU recorder.
 *
 * Two things here are load-bearing for the validator's flow-vs-gyro check:
 *
 *  - The sample rate is MEASURED, never assumed. product-spec §3.1 notes a
 *    ~60Hz ceiling, but iOS Low Power Mode silently drops well below it, and a
 *    dataset that claims 60Hz while delivering 20Hz is worse than one that
 *    admits 20Hz.
 *  - Axes are LABELLED, not normalized. DeviceMotionEvent.rotationRate is
 *    alpha=z, beta=x, gamma=y in deg/s, and its relationship to the camera
 *    frame depends on screen orientation. Mapping it here would mean debugging
 *    coordinate frames on a phone; the validator does it in Python instead.
 *
 * See docs/superpowers/specs/2026-08-23-contributor-pwa-design.md §5.3, §5.4.
 */

import type { ImuSample, ImuStream } from "./imu-codec";

export type MotionPermission = "granted" | "denied" | "unsupported" | "not_required";

/** Which acceleration field the device actually populated. */
export type AccelSource = "linear" | "including_gravity" | "absent";

export interface ImuRecording {
  stream: ImuStream;
  /** Measured from sample timestamps, not from any declared rate. */
  rateHzObserved: number;
  samples: number;
  accelSource: AccelSource;
  screenOrientation: string;
  /** Wall-clock duration of the recording window, milliseconds. */
  durationMs: number;
}

export interface ImuRecorderOptions {
  /** Defaults to window. Injected so the recorder is testable off-browser. */
  target?: EventTarget;
  /** Monotonic clock. Defaults to performance.now. */
  now?: () => number;
  /** Wall clock, for the stream's epoch anchor. Defaults to Date.now. */
  epochNow?: () => number;
  /** Defaults to reading screen.orientation. */
  orientation?: () => string;
}

/** Minimal structural view of DeviceMotionEvent — avoids a DOM lib dependency. */
interface MotionLike {
  acceleration?: { x: number | null; y: number | null; z: number | null } | null;
  accelerationIncludingGravity?: { x: number | null; y: number | null; z: number | null } | null;
  rotationRate?: { alpha: number | null; beta: number | null; gamma: number | null } | null;
}

function num(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function hasAnyComponent(
  v: { x: number | null; y: number | null; z: number | null } | null | undefined,
): boolean {
  return !!v && (v.x !== null || v.y !== null || v.z !== null);
}

function defaultOrientation(): string {
  const o = (globalThis as { screen?: { orientation?: { type?: string } } }).screen?.orientation;
  return o?.type ?? "unknown";
}

/**
 * Ask for motion permission.
 *
 * On iOS this MUST be called from inside a real user gesture — a button tap,
 * never an on-mount effect — or the request rejects without ever prompting.
 */
export async function requestMotionPermission(): Promise<MotionPermission> {
  const ctor = (globalThis as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } })
    .DeviceMotionEvent;

  if (!ctor) return "unsupported";
  if (typeof ctor.requestPermission !== "function") return "not_required";

  try {
    return (await ctor.requestPermission()) === "granted" ? "granted" : "denied";
  } catch {
    // iOS rejects rather than resolving when called outside a user gesture.
    return "denied";
  }
}

export class ImuRecorder {
  private readonly target: EventTarget;
  private readonly now: () => number;
  private readonly epochNow: () => number;
  private readonly orientation: () => string;

  private samples: ImuSample[] = [];
  private accelSource: AccelSource = "absent";
  private t0 = 0;
  private startedAtEpochMs = 0;
  private recording = false;

  constructor(options: ImuRecorderOptions = {}) {
    this.target = options.target ?? (globalThis as unknown as EventTarget);
    this.now = options.now ?? (() => performance.now());
    this.epochNow = options.epochNow ?? (() => Date.now());
    this.orientation = options.orientation ?? defaultOrientation;
  }

  private readonly onMotion = (event: Event): void => {
    if (!this.recording) return;

    const e = event as unknown as MotionLike;

    let source: AccelSource = "absent";
    let accel: { x: number | null; y: number | null; z: number | null } | null | undefined;

    if (hasAnyComponent(e.acceleration)) {
      source = "linear";
      accel = e.acceleration;
    } else if (hasAnyComponent(e.accelerationIncludingGravity)) {
      source = "including_gravity";
      accel = e.accelerationIncludingGravity;
    }

    // Record the first source we actually see and keep it for the episode; a
    // mid-episode switch would make the stream self-inconsistent.
    if (this.accelSource === "absent") this.accelSource = source;

    const r = e.rotationRate;

    this.samples.push({
      t: this.now() - this.t0,
      ax: num(accel?.x),
      ay: num(accel?.y),
      az: num(accel?.z),
      // Declared convention: alpha=z, beta=x, gamma=y, degrees per second.
      rx: num(r?.beta),
      ry: num(r?.gamma),
      rz: num(r?.alpha),
    });
  };

  get isRecording(): boolean {
    return this.recording;
  }

  start(): void {
    if (this.recording) throw new Error("ImuRecorder is already recording.");

    this.samples = [];
    this.accelSource = "absent";
    this.t0 = this.now();
    this.startedAtEpochMs = this.epochNow();
    this.recording = true;

    this.target.addEventListener("devicemotion", this.onMotion);
  }

  stop(): ImuRecording {
    if (!this.recording) throw new Error("ImuRecorder is not recording.");

    this.target.removeEventListener("devicemotion", this.onMotion);
    this.recording = false;

    const samples = this.samples;
    const durationMs = this.now() - this.t0;

    return {
      stream: { startedAtEpochMs: this.startedAtEpochMs, samples },
      rateHzObserved: observedRate(samples),
      samples: samples.length,
      accelSource: this.accelSource,
      screenOrientation: this.orientation(),
      durationMs,
    };
  }

  /** Detach without producing a recording — for aborted or discarded episodes. */
  abort(): void {
    this.target.removeEventListener("devicemotion", this.onMotion);
    this.recording = false;
    this.samples = [];
  }
}

/**
 * Rate measured across the sample window. Uses the span between first and last
 * timestamps rather than the recorder's own duration, so a listener that
 * attached late or stopped early is reflected honestly.
 */
export function observedRate(samples: ImuSample[]): number {
  if (samples.length < 2) return 0;
  const span = samples[samples.length - 1].t - samples[0].t;
  if (span <= 0) return 0;
  return ((samples.length - 1) / span) * 1000;
}
