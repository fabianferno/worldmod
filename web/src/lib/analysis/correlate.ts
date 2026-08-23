/**
 * Flow-vs-gyro plausibility scoring.
 *
 * Head motion shows up in two independent streams: the camera's image moves,
 * and the gyroscope reads angular velocity. Genuine head-mounted capture makes
 * those track each other. A screen replay, stock footage, or a synthesised IMU
 * trace does not. This is product-spec §6.3's check, computed on-device.
 *
 * Three decisions worth stating:
 *
 *  - **Scale-invariance saves us from needing the field of view.** Converting
 *    pixel flow into an angle requires focal length in pixels, which the web
 *    exposes nowhere. Pearson correlation is invariant to linear scaling, so
 *    raw pixel rates can be correlated against deg/s directly and the unknown
 *    focal length cancels.
 *  - **Magnitude, not sign.** Whether yaw-right moves the image left or right
 *    depends on device and orientation conventions we deliberately do not
 *    normalise on-device. A spoof produces r near zero, not r near -1, so |r|
 *    is the statistic that separates real from fake. Signs are reported so a
 *    convention can be pinned later.
 *  - **Low motion means undefined, not fake.** Correlation over a near-still
 *    recording is dominated by noise. Scoring that as a low number would fail
 *    honest captures, so it returns a distinct verdict instead.
 */

import type { ImuSample } from "@/lib/capture";

/** Image motion between two frames, in pixels per second over [t0, t1]. */
export interface FlowSample {
  /** Start of the frame interval, ms from recording start. */
  t0: number;
  /** End of the frame interval, ms from recording start. */
  t1: number;
  /** Horizontal image rate, px/s. Pairs with yaw. */
  u: number;
  /** Vertical image rate, px/s. Pairs with pitch. */
  v: number;
}

export type PlausibilityVerdict = "ok" | "insufficient_motion" | "insufficient_frames";

export interface PlausibilityReport {
  verdict: PlausibilityVerdict;
  /** 0–100 for display, null when no verdict was reached. */
  percent: number | null;
  /** Combined |r| across axes, 0–1. */
  correlation: number | null;
  perAxis: { yaw: number | null; pitch: number | null };
  pairs: number;
  motionRmsDegPerSec: number;
}

export interface PlausibilityOptions {
  /** Below this gyro RMS the correlation is noise, not evidence. */
  minMotionRmsDegPerSec?: number;
  minPairs?: number;
}

const DEFAULTS = { minMotionRmsDegPerSec: 3, minPairs: 8 } as const;

/** Pearson correlation. Null when either series has no variance. */
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;

  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }

  const denom = Math.sqrt(sxx * syy);
  if (denom === 0) return null;

  const r = sxy / denom;
  // Guard against floating-point excursions past ±1.
  return Math.max(-1, Math.min(1, r));
}

/**
 * Mean angular rate over each [t_i, t_{i+1}] interval, sampled from the IMU.
 *
 * Frames and IMU samples run at different rates on different clocks; this puts
 * the gyro onto the frame pairs' timeline so the two can be compared term by
 * term. Intervals containing no IMU sample yield null and are dropped by the
 * caller rather than interpolated into existence.
 */
export function gyroRatesOverIntervals(
  samples: readonly ImuSample[],
  intervals: ReadonlyArray<{ t0: number; t1: number }>,
): Array<{ t: number; wx: number; wy: number } | null> {
  return intervals.map(({ t0, t1 }) => {
    let n = 0;
    let sx = 0;
    let sy = 0;
    for (const s of samples) {
      if (s.t >= t0 && s.t < t1) {
        n++;
        sx += s.rx;
        sy += s.ry;
      }
    }
    return n === 0 ? null : { t: (t0 + t1) / 2, wx: sx / n, wy: sy / n };
  });
}

/** RMS angular speed across the pitch/yaw axes, deg/s. */
export function motionRms(rates: ReadonlyArray<{ wx: number; wy: number }>): number {
  if (rates.length === 0) return 0;
  let acc = 0;
  for (const r of rates) acc += r.wx * r.wx + r.wy * r.wy;
  return Math.sqrt(acc / rates.length);
}

export function plausibility(
  flow: readonly FlowSample[],
  imu: readonly ImuSample[],
  options: PlausibilityOptions = {},
): PlausibilityReport {
  const { minMotionRmsDegPerSec, minPairs } = { ...DEFAULTS, ...options };

  const gyro = gyroRatesOverIntervals(imu, flow);

  const us: number[] = [];
  const vs: number[] = [];
  const wxs: number[] = [];
  const wys: number[] = [];

  for (let i = 0; i < flow.length; i++) {
    const g = gyro[i];
    if (!g) continue;
    us.push(flow[i].u);
    vs.push(flow[i].v);
    wxs.push(g.wx);
    wys.push(g.wy);
  }

  const rms = motionRms(wxs.map((wx, i) => ({ wx, wy: wys[i] })));

  if (us.length < minPairs) {
    return {
      verdict: "insufficient_frames",
      percent: null,
      correlation: null,
      perAxis: { yaw: null, pitch: null },
      pairs: us.length,
      motionRmsDegPerSec: rms,
    };
  }

  if (rms < minMotionRmsDegPerSec) {
    return {
      verdict: "insufficient_motion",
      percent: null,
      correlation: null,
      perAxis: { yaw: null, pitch: null },
      pairs: us.length,
      motionRmsDegPerSec: rms,
    };
  }

  // Horizontal image motion pairs with yaw, vertical with pitch.
  const yaw = pearson(us, wys);
  const pitch = pearson(vs, wxs);

  // Weight each axis by how much the gyro actually moved on it, so an axis
  // with no real motion cannot dilute a good score on the axis that did move.
  const wYaw = variance(wys);
  const wPitch = variance(wxs);
  const parts: Array<[number, number]> = [];
  if (yaw !== null && wYaw > 0) parts.push([Math.abs(yaw), wYaw]);
  if (pitch !== null && wPitch > 0) parts.push([Math.abs(pitch), wPitch]);

  if (parts.length === 0) {
    return {
      verdict: "insufficient_motion",
      percent: null,
      correlation: null,
      perAxis: { yaw, pitch },
      pairs: us.length,
      motionRmsDegPerSec: rms,
    };
  }

  const totalWeight = parts.reduce((acc, [, w]) => acc + w, 0);
  const combined = parts.reduce((acc, [r, w]) => acc + r * w, 0) / totalWeight;

  return {
    verdict: "ok",
    percent: Math.round(combined * 1000) / 10,
    correlation: combined,
    perAxis: { yaw, pitch },
    pairs: us.length,
    motionRmsDegPerSec: rms,
  };
}

function variance(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((acc, x) => acc + (x - mean) ** 2, 0) / xs.length;
}
