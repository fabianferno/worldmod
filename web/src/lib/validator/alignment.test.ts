import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as tf from "@tensorflow/tfjs";
import { beforeAll, describe, expect, it } from "vitest";
import { pearson, type FlowSample } from "@/lib/analysis/correlate";
import { estimateFlow, toGrayscale } from "@/lib/analysis/flow";
import { decodeImuStream, type ImuSample } from "@/lib/capture/imu-codec";
import { resolveStreamPath } from "@/lib/market/blobs";

/**
 * Diagnoses WHY the flow-vs-gyro check shows no separation on real episodes.
 *
 * The separation harness found a genuine pairing scoring 5.2% while a
 * mismatched one scored 17.5%. Two explanations fit: the check does not work,
 * or the two streams are not aligned in time and the correlation is being
 * computed between a frame and the wrong moment of motion.
 *
 * Sweeping a time offset separates those. If correlation peaks sharply at some
 * non-zero lag, the signal is there and the alignment is wrong — a fixable
 * bug. If it is flat and low at every offset, there is no signal to find and
 * the check itself needs rethinking.
 */

const EPISODES_DIR = join(process.cwd(), ".data", "episodes");
const SAMPLE_FPS = 6;
const MAX_FRAMES = 70;
const EDGE = 160;

/** Lags to try, milliseconds. Wide enough to cover a whole-second error. */
const OFFSETS_MS = [-2000, -1500, -1000, -750, -500, -250, 0, 250, 500, 750, 1000, 1500, 2000];

function hasFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function episodeDirs(): string[] {
  if (!existsSync(EPISODES_DIR)) return [];
  return readdirSync(EPISODES_DIR)
    .map((name) => join(EPISODES_DIR, name))
    .filter((dir) => resolveStreamPath(dir, "rgb") !== null && existsSync(join(dir, "imu.bin")));
}

function extractFrames(path: string): { t: number; image: ImageData }[] {
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
  return Array.from({ length: Math.floor(raw.length / stride) }, (_, i) => ({
    t: (i / SAMPLE_FPS) * 1000,
    image: {
      data: new Uint8ClampedArray(raw.subarray(i * stride, (i + 1) * stride)),
      width: w,
      height: h,
      colorSpace: "srgb",
    } as ImageData,
  }));
}

async function flowSeries(frames: { t: number; image: ImageData }[]): Promise<FlowSample[]> {
  const out: FlowSample[] = [];
  let prev = toGrayscale(frames[0].image);
  try {
    for (let i = 1; i < frames.length; i++) {
      const next = toGrayscale(frames[i].image);
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

/** Mean gyro over an interval, shifted by `offset`. Null when uncovered. */
function gyroOver(
  samples: readonly ImuSample[],
  t0: number,
  t1: number,
  offset: number,
): { wx: number; wy: number } | null {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (const s of samples) {
    const t = s.t + offset;
    if (t >= t0 && t < t1) {
      n++;
      sx += s.rx;
      sy += s.ry;
    }
  }
  return n === 0 ? null : { wx: sx / n, wy: sy / n };
}

/** Best absolute correlation across both axes at a given lag. */
function correlationAt(flow: FlowSample[], imu: readonly ImuSample[], offset: number): number {
  const us: number[] = [];
  const vs: number[] = [];
  const wxs: number[] = [];
  const wys: number[] = [];

  for (const f of flow) {
    const g = gyroOver(imu, f.t0, f.t1, offset);
    if (!g) continue;
    us.push(f.u);
    vs.push(f.v);
    wxs.push(g.wx);
    wys.push(g.wy);
  }
  if (us.length < 8) return 0;

  const yaw = pearson(us, wys) ?? 0;
  const pitch = pearson(vs, wxs) ?? 0;
  return Math.max(Math.abs(yaw), Math.abs(pitch));
}

const dirs = episodeDirs();
const runnable = dirs.length >= 1 && hasFfmpeg();

describe.skipIf(!runnable)("flow-vs-gyro alignment sweep", () => {
  const episodes: Array<{ id: string; flow: FlowSample[]; imu: ImuSample[] }> = [];

  beforeAll(async () => {
    await tf.setBackend("cpu");
    await tf.ready();

    for (const dir of dirs.slice(0, 2)) {
      const id = dir.split("/").pop()!;
      const frames = extractFrames(resolveStreamPath(dir, "rgb")!);
      const imu = decodeImuStream(new Uint8Array(readFileSync(join(dir, "imu.bin")))).samples;
      episodes.push({ id, flow: await flowSeries(frames), imu });
    }
  }, 240_000);

  it("reports correlation across time offsets", () => {
    for (const episode of episodes) {
      const rms = Math.sqrt(
        episode.imu.reduce((acc, s) => acc + s.rx * s.rx + s.ry * s.ry, 0) / episode.imu.length,
      );

      const scores = OFFSETS_MS.map((offset) => ({
        offset,
        r: correlationAt(episode.flow, episode.imu, offset),
      }));
      const best = scores.reduce((a, b) => (b.r > a.r ? b : a));
      const atZero = scores.find((s) => s.offset === 0)!.r;

      console.log(
        `\n${episode.id}  motion=${rms.toFixed(1)}deg/s  frames=${episode.flow.length}\n` +
          scores.map((s) => `  ${String(s.offset).padStart(6)}ms  ${s.r.toFixed(3)}`).join("\n") +
          `\n  best ${best.r.toFixed(3)} at ${best.offset}ms (zero-offset ${atZero.toFixed(3)})`,
      );

      expect(best.r).toBeGreaterThanOrEqual(0);
    }
  });
});
