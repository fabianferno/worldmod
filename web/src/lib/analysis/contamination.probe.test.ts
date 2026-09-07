import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as tf from "@tensorflow/tfjs";
import { beforeAll, describe, expect, it } from "vitest";
import { plausibility, type FlowSample } from "./correlate";
import { estimateFlow, toGrayscale } from "./flow";
import { decodeImuStream, type ImuSample } from "@/lib/capture/imu-codec";
import { resolveStreamPath } from "@/lib/market/blobs";

/**
 * Is the moving hand corrupting the flow estimate?
 *
 * The first episode where hands were genuinely in frame (89% visible) scored
 * 33% on motion, while three earlier takes of the same task — recorded while
 * hand detection was broken — scored 57%, 60% and 75%. The obvious difference
 * is a hand at arm's length filling much of a narrow field of view and moving
 * independently of the head.
 *
 * Flow is solved per block and combined with a median, which resists a
 * MINORITY of blocks moving on their own. If the hand covers enough of the
 * frame, the median becomes the hand.
 *
 * This measures it by computing flow twice: over the whole frame, and over the
 * upper region only, where hands seldom are — the guide region puts them below
 * 38% of frame height. If correlation rises sharply when the lower frame is
 * excluded, the hand is the contaminant and masking it is the fix.
 */

const EPISODES_DIR = join(process.cwd(), ".data", "episodes");
const SAMPLE_FPS = 6;
const MAX_FRAMES = 80;
const EDGE = 192;

function canRun(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    return false;
  }
  return existsSync(EPISODES_DIR) && readdirSync(EPISODES_DIR).length > 0;
}

interface Frame {
  t: number;
  full: ImageData;
  upper: ImageData;
}

/** Decode frames, plus a copy cropped to the top of the image. */
function extract(path: string, upperFraction: number): Frame[] {
  const probe = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
    { encoding: "utf8" },
  ).trim();
  const [width, height] = probe.split(",").map(Number);

  const scale = EDGE / Math.max(width, height);
  const w = Math.max(2, Math.round((width * scale) / 2) * 2);
  const h = Math.max(2, Math.round((height * scale) / 2) * 2);

  const raw = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-vf", `fps=${SAMPLE_FPS},scale=${w}:${h}`,
     "-frames:v", String(MAX_FRAMES), "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
    { maxBuffer: 1024 * 1024 * 256 },
  );

  const stride = w * h * 4;
  const count = Math.floor(raw.length / stride);
  const upperRows = Math.max(16, Math.floor(h * upperFraction));

  return Array.from({ length: count }, (_, i) => {
    const frame = raw.subarray(i * stride, (i + 1) * stride);
    return {
      t: (i / SAMPLE_FPS) * 1000,
      full: {
        data: new Uint8ClampedArray(frame),
        width: w,
        height: h,
        colorSpace: "srgb",
      } as ImageData,
      upper: {
        data: new Uint8ClampedArray(frame.subarray(0, upperRows * w * 4)),
        width: w,
        height: upperRows,
        colorSpace: "srgb",
      } as ImageData,
    };
  });
}

async function flowFrom(
  frames: Frame[],
  pick: (f: Frame) => ImageData,
): Promise<FlowSample[]> {
  const out: FlowSample[] = [];
  let prev = toGrayscale(pick(frames[0]));
  try {
    for (let i = 1; i < frames.length; i++) {
      const next = toGrayscale(pick(frames[i]));
      const dt = (frames[i].t - frames[i - 1].t) / 1000;
      const estimate = await estimateFlow(prev, next);
      if (estimate) {
        out.push({ t0: frames[i - 1].t, t1: frames[i].t, u: estimate.u / dt, v: estimate.v / dt });
      }
      prev.dispose();
      prev = next;
    }
  } finally {
    prev.dispose();
  }
  return out;
}

const runnable = canRun();

describe.skipIf(!runnable)("hand contamination of the flow estimate", () => {
  const results: string[] = [];

  beforeAll(async () => {
    await tf.setBackend("cpu");
    await tf.ready();

    const dirs = readdirSync(EPISODES_DIR)
      .map((n) => join(EPISODES_DIR, n))
      .filter((d) => resolveStreamPath(d, "rgb") !== null && existsSync(join(d, "imu.bin")));

    for (const dir of dirs) {
      const id = dir.split("/").pop()!.slice(3, 11);
      const frames = extract(resolveStreamPath(dir, "rgb")!, 0.38);
      const imu: ImuSample[] = decodeImuStream(
        new Uint8Array(readFileSync(join(dir, "imu.bin"))),
      ).samples;

      const full = plausibility(await flowFrom(frames, (f) => f.full), imu);
      const upper = plausibility(await flowFrom(frames, (f) => f.upper), imu);

      const show = (r: typeof full) =>
        r.percent === null ? `— (${r.verdict})`.padEnd(24) : `${r.percent.toFixed(1)}%`.padEnd(24);

      results.push(
        `  ${id}  whole frame ${show(full)} upper only ${show(upper)} ` +
          `motion=${full.motionRmsDegPerSec.toFixed(1)}deg/s`,
      );
    }
  }, 600_000);

  it("reports whether excluding the lower frame improves correlation", () => {
    console.log(`\n${results.join("\n")}\n`);
    expect(results.length).toBeGreaterThan(0);
  });
});
