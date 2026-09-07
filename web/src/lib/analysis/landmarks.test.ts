import { describe, expect, it } from "vitest";
import { framingScore, GUIDE_REGION } from "./framing";
import { normalizeKeypoints } from "./landmarks";

describe("normalizeKeypoints", () => {
  it("converts pixel keypoints to normalised coordinates", () => {
    const points = normalizeKeypoints([{ x: 96, y: 72 }], 192, 144);
    expect(points[0]).toEqual({ x: 0.5, y: 0.5 });
  });

  it("keeps a hand in the lower frame inside the guide", () => {
    // Regression guard for the runtime swap: the MediaPipe Tasks runtime
    // reported normalised keypoints, the tfjs runtime reports pixels. Feeding
    // raw pixels to the scorer would put every landmark far outside the guide
    // and silently score every capture at 0% framing.
    const pixels = Array.from({ length: 21 }, (_, i) => ({
      x: 90 + (i % 5) * 3,
      y: 100 + Math.floor(i / 5) * 3,
    }));

    const normalised = normalizeKeypoints(pixels, 192, 144);
    const report = framingScore([{ t: 0, hands: [normalised] }]);

    expect(normalised.every((p) => p.x <= 1 && p.y <= 1)).toBe(true);
    expect(report.percent).toBe(100);
  });

  it("scores raw pixel coordinates as outside the guide, as the bug would have", () => {
    const pixels = Array.from({ length: 21 }, () => ({ x: 90, y: 100 }));
    const report = framingScore([{ t: 0, hands: [pixels] }]);

    // Documents why the conversion exists rather than asserting it is fine.
    expect(report.percent).toBe(0);
    expect(GUIDE_REGION.x1).toBeLessThan(2);
  });

  it("returns an empty list for a degenerate frame size rather than dividing by zero", () => {
    expect(normalizeKeypoints([{ x: 1, y: 1 }], 0, 144)).toEqual([]);
    expect(normalizeKeypoints([{ x: 1, y: 1 }], 192, 0)).toEqual([]);
  });

  it("handles an empty keypoint list", () => {
    expect(normalizeKeypoints([], 192, 144)).toEqual([]);
  });
});
