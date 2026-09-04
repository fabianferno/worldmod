import { describe, expect, it } from "vitest";
import { alignedTraces, type FlowSample } from "./correlate";
import type { ImuSample } from "@/lib/capture/imu-codec";

/**
 * The overlay is evidence a viewer reads instead of trusting a number, so what
 * matters is that the picture agrees with the score: traces that track for a
 * genuine pairing, and traces that do not for a mismatched one.
 */

function imu(count: number, rate: number, shape: (t: number) => number): ImuSample[] {
  return Array.from({ length: count }, (_, i) => {
    const t = (i / rate) * 1000;
    return { t, ax: 0, ay: 0, az: 9.81, rx: 0, ry: shape(t), rz: 0 };
  });
}

function flowFrom(samples: ImuSample[], fps: number, gain: number, phase = 0): FlowSample[] {
  const step = 1000 / fps;
  const out: FlowSample[] = [];
  for (let t = 0; t + step <= samples[samples.length - 1].t; t += step) {
    const at = samples.find((s) => s.t >= t + phase) ?? samples[0];
    out.push({ t0: t, t1: t + step, u: at.ry * gain, v: 0 });
  }
  return out;
}

describe("alignedTraces", () => {
  const gyro = imu(600, 60, (t) => Math.sin(t / 300));

  it("produces two traces that track each other for a genuine pairing", () => {
    const traces = alignedTraces(flowFrom(gyro, 8, 40), gyro, 0);
    expect(traces.length).toBeGreaterThan(10);

    // Same sign on most samples is what "these track each other" looks like.
    const agreeing = traces.filter((p) => Math.sign(p.flowYaw) === Math.sign(p.gyroYaw)).length;
    expect(agreeing / traces.length).toBeGreaterThan(0.8);
  });

  it("does not make an unrelated pairing look aligned", () => {
    // A different frequency stands in for footage that did not come from this
    // phone — which is what a screen replay is.
    const other = imu(600, 60, (t) => Math.sin(t / 91));
    const traces = alignedTraces(flowFrom(other, 8, 40), gyro, 0);

    const agreeing = traces.filter((p) => Math.sign(p.flowYaw) === Math.sign(p.gyroYaw)).length;
    expect(agreeing / traces.length).toBeLessThan(0.75);
  });

  it("scales each channel independently, because the units differ", () => {
    // Flow is pixels per second and gyro is degrees per second, with no
    // conversion available without a focal length the browser will not report.
    const traces = alignedTraces(flowFrom(gyro, 8, 1000), gyro, 0);
    for (const p of traces) {
      expect(Math.abs(p.flowYaw)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.gyroYaw)).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...traces.map((p) => Math.abs(p.flowYaw)))).toBeCloseTo(1, 5);
  });

  it("samples across the whole take rather than truncating it", () => {
    // A head slice would hide divergence at the end, which is exactly what
    // this is meant to reveal.
    const flow = flowFrom(gyro, 8, 40);
    const traces = alignedTraces(flow, gyro, 0, 10);

    expect(traces.length).toBeLessThanOrEqual(10);
    expect(traces[traces.length - 1].t).toBeGreaterThan(flow[flow.length - 1].t0 * 0.7);
  });

  it("returns nothing when the streams cannot be paired", () => {
    expect(alignedTraces([], gyro, 0)).toEqual([]);
  });
});
