import { describe, expect, it } from "vitest";
import {
  drawHand,
  HAND_CONNECTIONS,
  HAND_LANDMARK_COUNT,
  PIVOT_INDICES,
} from "./skeleton";
import type { Landmark } from "./framing";

function hand(): Landmark[] {
  return Array.from({ length: HAND_LANDMARK_COUNT }, (_, i) => ({
    x: 0.3 + (i % 5) * 0.05,
    y: 0.4 + Math.floor(i / 5) * 0.05,
  }));
}

/** Records calls instead of rendering, so drawing logic is testable in Node. */
function recordingContext() {
  const calls: Array<{ op: string; args: number[] }> = [];
  const ctx = {
    lineWidth: 0,
    strokeStyle: "",
    fillStyle: "",
    lineCap: "" as CanvasLineCap,
    beginPath: () => calls.push({ op: "beginPath", args: [] }),
    moveTo: (x: number, y: number) => calls.push({ op: "moveTo", args: [x, y] }),
    lineTo: (x: number, y: number) => calls.push({ op: "lineTo", args: [x, y] }),
    stroke: () => calls.push({ op: "stroke", args: [] }),
    arc: (x: number, y: number, r: number) => calls.push({ op: "arc", args: [x, y, r] }),
    fill: () => calls.push({ op: "fill", args: [] }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe("HAND_CONNECTIONS", () => {
  it("references only valid landmark indices", () => {
    for (const [a, b] of HAND_CONNECTIONS) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(HAND_LANDMARK_COUNT);
      expect(b).toBeLessThan(HAND_LANDMARK_COUNT);
    }
  });

  it("connects every landmark to the skeleton", () => {
    // An unreferenced landmark would render as a floating dot with no bone.
    const referenced = new Set(HAND_CONNECTIONS.flat());
    for (let i = 0; i < HAND_LANDMARK_COUNT; i++) {
      expect(referenced.has(i)).toBe(true);
    }
  });

  it("forms a tree: one fewer bone than landmarks", () => {
    expect(HAND_CONNECTIONS.length).toBe(HAND_LANDMARK_COUNT);
  });

  it("lists no duplicate or self bones", () => {
    const seen = new Set<string>();
    for (const [a, b] of HAND_CONNECTIONS) {
      expect(a).not.toBe(b);
      const key = [a, b].sort((p, q) => p - q).join("-");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("roots the thumb and index chains at the wrist", () => {
    const fromWrist = HAND_CONNECTIONS.filter(([a, b]) => a === 0 || b === 0);
    expect(fromWrist.length).toBeGreaterThanOrEqual(3);
  });
});

describe("PIVOT_INDICES", () => {
  it("addresses valid landmarks, without duplicates", () => {
    expect(PIVOT_INDICES.every((i) => i >= 0 && i < HAND_LANDMARK_COUNT)).toBe(true);
    expect(new Set(PIVOT_INDICES).size).toBe(PIVOT_INDICES.length);
  });

  it("includes the wrist", () => {
    expect(PIVOT_INDICES).toContain(0);
  });
});

describe("drawHand", () => {
  it("scales normalised landmarks to the target surface", () => {
    const { ctx, calls } = recordingContext();
    drawHand(ctx, [{ x: 0.5, y: 0.25 }], 200, 400);

    const arc = calls.find((c) => c.op === "arc");
    expect(arc?.args[0]).toBeCloseTo(100, 6);
    expect(arc?.args[1]).toBeCloseTo(100, 6);
  });

  it("draws a bone for every connection", () => {
    const { ctx, calls } = recordingContext();
    drawHand(ctx, hand(), 100, 100);

    expect(calls.filter((c) => c.op === "moveTo")).toHaveLength(HAND_CONNECTIONS.length);
    expect(calls.filter((c) => c.op === "lineTo")).toHaveLength(HAND_CONNECTIONS.length);
  });

  it("draws every joint plus the emphasised pivots", () => {
    const { ctx, calls } = recordingContext();
    drawHand(ctx, hand(), 100, 100);

    expect(calls.filter((c) => c.op === "arc")).toHaveLength(
      HAND_LANDMARK_COUNT + PIVOT_INDICES.length,
    );
  });

  it("draws pivots larger than ordinary joints", () => {
    const { ctx, calls } = recordingContext();
    drawHand(ctx, hand(), 100, 100);

    const radii = calls.filter((c) => c.op === "arc").map((c) => c.args[2]);
    expect(Math.max(...radii)).toBeGreaterThan(Math.min(...radii));
  });

  it("does nothing for an empty hand", () => {
    const { ctx, calls } = recordingContext();
    drawHand(ctx, [], 100, 100);
    expect(calls).toHaveLength(0);
  });

  it("skips bones whose endpoints are missing rather than throwing", () => {
    const { ctx } = recordingContext();
    // A truncated detection must not take down the overlay mid-recording.
    expect(() => drawHand(ctx, hand().slice(0, 6), 100, 100)).not.toThrow();
  });
});
