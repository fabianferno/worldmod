import { describe, expect, it } from "vitest";
import { alignFrames, type FrameObservation } from "./align";

/**
 * Reproduces what an S24 Ultra actually produced: capture-clock timestamps are
 * microseconds since boot, roughly 2.4 hours ahead of a page-relative clock.
 */
const BOOT_OFFSET_US = 8_659_680_000;

function frames({
  count,
  fps,
  startUs = BOOT_OFFSET_US,
  trueOffsetMs,
  latencyMs = () => 3,
}: {
  count: number;
  fps: number;
  startUs?: number;
  trueOffsetMs: number;
  latencyMs?: (i: number) => number;
}): FrameObservation[] {
  const stepUs = 1_000_000 / fps;
  return Array.from({ length: count }, (_, i) => {
    const tsUs = startUs + i * stepUs;
    return { tsUs, arrivalMs: tsUs / 1000 + trueOffsetMs + latencyMs(i) };
  });
}

describe("alignFrames", () => {
  const captureStartMs = 1_200;
  // performance.now() at the instant the capture clock read BOOT_OFFSET_US.
  const trueOffsetMs = captureStartMs - BOOT_OFFSET_US / 1000;

  it("does not report device uptime as skew", () => {
    // The regression this exists for: naive subtraction gave 8,659,680 ms.
    const observed = frames({ count: 60, fps: 30, trueOffsetMs });
    const { measuredSkewMs } = alignFrames(observed, captureStartMs);

    expect(measuredSkewMs).not.toBeNull();
    expect(Math.abs(measuredSkewMs!)).toBeLessThan(100);
  });

  it("recovers the clock offset from the fastest-arriving frame", () => {
    // One frame arrives with no extra latency; it pins the offset exactly.
    const observed = frames({
      count: 20,
      fps: 30,
      trueOffsetMs,
      latencyMs: (i) => (i === 7 ? 0 : 12),
    });

    expect(alignFrames(observed, captureStartMs).clockOffsetMs).toBeCloseTo(trueOffsetMs, 6);
  });

  it("uses the minimum rather than the mean, so latency does not bias every frame", () => {
    const observed = frames({
      count: 20,
      fps: 30,
      trueOffsetMs,
      // Mostly slow arrivals with one fast one — a mean would be badly skewed.
      latencyMs: (i) => (i === 0 ? 1 : 40),
    });

    const { clockOffsetMs } = alignFrames(observed, captureStartMs);
    expect(clockOffsetMs! - trueOffsetMs).toBeCloseTo(1, 6);
  });

  it("excludes pre-roll frames captured before recording began", () => {
    // The sidecar taps the track at stream acquisition, ~400ms before the
    // recorder starts — those frames are not in the encoded video.
    const preRollCount = 12;
    const stepUs = 1_000_000 / 30;
    const observed = frames({
      count: 60,
      fps: 30,
      startUs: BOOT_OFFSET_US - preRollCount * stepUs,
      trueOffsetMs,
      latencyMs: () => 0,
    });

    const result = alignFrames(observed, captureStartMs);
    expect(result.preRollFrames).toBe(preRollCount);
    expect(result.frameCount).toBe(60 - preRollCount);
    expect(result.frameTimestampsMs.every((t) => t >= 0)).toBe(true);
  });

  it("puts frame times on the same origin as IMU samples", () => {
    const observed = frames({ count: 30, fps: 30, trueOffsetMs, latencyMs: () => 0 });
    const { frameTimestampsMs } = alignFrames(observed, captureStartMs);

    // First frame at recording start, then ~33.3ms apart — directly comparable
    // to ImuSample.t, which is also milliseconds from recording start.
    expect(frameTimestampsMs[0]).toBeCloseTo(0, 6);
    expect(frameTimestampsMs[1] - frameTimestampsMs[0]).toBeCloseTo(1000 / 30, 6);
  });

  it("measures fps from frames inside the recording window only", () => {
    // 175 raw frames spanning 6.13s gave a misleading 28.37 fps because
    // pre-roll stretched the span beyond the 5.74s recording.
    const observed = frames({
      count: 175,
      fps: 30,
      startUs: BOOT_OFFSET_US - 12 * (1_000_000 / 30),
      trueOffsetMs,
      latencyMs: () => 0,
    });

    expect(alignFrames(observed, captureStartMs).fpsObserved).toBeCloseTo(30, 4);
  });

  it("returns nulls rather than guesses when the sidecar produced nothing", () => {
    const result = alignFrames([], 0);
    expect(result).toMatchObject({
      frameCount: 0,
      fpsObserved: null,
      measuredSkewMs: null,
      clockOffsetMs: null,
      preRollFrames: 0,
    });
  });

  it("returns nulls when every frame predates the recording", () => {
    const observed = frames({
      count: 5,
      fps: 30,
      startUs: BOOT_OFFSET_US - 10_000_000,
      trueOffsetMs,
      latencyMs: () => 0,
    });

    const result = alignFrames(observed, captureStartMs);
    expect(result.frameCount).toBe(0);
    expect(result.fpsObserved).toBeNull();
    expect(result.preRollFrames).toBe(5);
  });

  it("handles a single in-window frame without inventing a frame rate", () => {
    const observed = frames({ count: 1, fps: 30, trueOffsetMs, latencyMs: () => 0 });
    const result = alignFrames(observed, captureStartMs);

    expect(result.frameCount).toBe(1);
    expect(result.fpsObserved).toBeNull();
  });
});
