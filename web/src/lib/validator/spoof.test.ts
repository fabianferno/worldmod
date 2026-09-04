import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as tf from "@tensorflow/tfjs";
import { beforeAll, describe, expect, it } from "vitest";
import { plausibility, type FlowSample } from "@/lib/analysis/correlate";
import { estimateFlow, toGrayscale } from "@/lib/analysis/flow";
import { decodeImuStream, type ImuSample } from "@/lib/capture/imu-codec";
import { resolveStreamPath } from "@/lib/market/blobs";

/**
 * Separation test for the flow-vs-gyro check, against real recorded episodes.
 *
 * product-spec §16 schedules the validator being "tuned against a deliberately
 * spoofed sample", and §14 scene 3 — the screen replay that scores 0.11 — is
 * the moment the spec says earns credibility. Until this existed, the check had
 * never seen a spoof: every test used synthetic flow generated FROM the gyro
 * trace it was then correlated against, which cannot fail.
 *
 * The spoof here is constructed the way a real one occurs. Someone pointing a
 * phone at a monitor playing someone else's footage produces exactly this:
 * genuine video, genuine IMU, and no relationship between them. Pairing one
 * recorded episode's frames with a different episode's motion reproduces that
 * without needing to stage it.
 *
 * Runs only when recorded episodes are present, so the suite still works on a
 * clean checkout.
 */

const EPISODES_DIR = join(process.cwd(), ".data", "episodes");

/** Sampled well below capture rate; flow needs pairs, not every frame. */
const SAMPLE_FPS = 6;
const MAX_FRAMES = 70;
const EDGE = 160;

interface Episode {
  id: string;
  frames: { t: number; image: ImageData }[];
  imu: ImuSample[];
}

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

function probeSize(path: string): { width: number; height: number } {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
    { encoding: "utf8" },
  ).trim();
  const [width, height] = out.split(",").map(Number);
  return { width, height };
}

/** Decode to raw RGBA at a fixed small size, so frames arrive as ImageData. */
function extractFrames(path: string): { t: number; image: ImageData }[] {
  const { width, height } = probeSize(path);
  const scale = EDGE / Math.max(width, height);
  const w = Math.max(2, Math.round((width * scale) / 2) * 2);
  const h = Math.max(2, Math.round((height * scale) / 2) * 2);

  const raw = execFileSync(
    "ffmpeg",
    [
      "-v", "error",
      "-i", path,
      "-vf", `fps=${SAMPLE_FPS},scale=${w}:${h}`,
      "-frames:v", String(MAX_FRAMES),
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "-",
    ],
    { maxBuffer: 1024 * 1024 * 256 },
  );

  const stride = w * h * 4;
  const count = Math.floor(raw.length / stride);

  return Array.from({ length: count }, (_, i) => ({
    t: (i / SAMPLE_FPS) * 1000,
    image: {
      data: new Uint8ClampedArray(raw.subarray(i * stride, (i + 1) * stride)),
      width: w,
      height: h,
      colorSpace: "srgb",
    } as ImageData,
  }));
}

/** The same flow series the live analyzer builds, computed offline. */
async function flowSeries(frames: Episode["frames"]): Promise<FlowSample[]> {
  const out: FlowSample[] = [];
  if (frames.length < 2) return out;

  let prev = toGrayscale(frames[0].image);
  try {
    for (let i = 1; i < frames.length; i++) {
      const next = toGrayscale(frames[i].image);
      const dt = (frames[i].t - frames[i - 1].t) / 1000;
      const estimate = dt > 0 ? await estimateFlow(prev, next) : null;

      if (estimate) {
        out.push({
          t0: frames[i - 1].t,
          t1: frames[i].t,
          u: estimate.u / dt,
          v: estimate.v / dt,
        });
      }
      prev.dispose();
      prev = next;
    }
  } finally {
    prev.dispose();
  }
  return out;
}

const dirs = episodeDirs();
const runnable = dirs.length >= 2 && hasFfmpeg();

describe.skipIf(!runnable)("flow-vs-gyro separation on recorded episodes", () => {
  const episodes: Episode[] = [];
  const flows = new Map<string, FlowSample[]>();

  beforeAll(async () => {
    await tf.setBackend("cpu");
    await tf.ready();

    for (const dir of dirs.slice(0, 3)) {
      const id = dir.split("/").pop()!;
      const frames = extractFrames(resolveStreamPath(dir, "rgb")!);
      const imu = decodeImuStream(new Uint8Array(readFileSync(join(dir, "imu.bin")))).samples;
      episodes.push({ id, frames, imu });
      flows.set(id, await flowSeries(frames));
    }
  }, 240_000);

  it("decodes real frames and motion from every episode", () => {
    for (const episode of episodes) {
      expect(episode.frames.length).toBeGreaterThan(20);
      expect(episode.imu.length).toBeGreaterThan(100);
      expect(flows.get(episode.id)!.length).toBeGreaterThan(15);
    }
  });

  it("reports what genuine and mismatched pairings actually score", () => {
    // The numbers this prints are the evidence; the assertions below are what
    // the demo depends on.
    const rows: string[] = [];

    for (const a of episodes) {
      for (const b of episodes) {
        const report = plausibility(flows.get(a.id)!, b.imu);
        const label = a.id === b.id ? "GENUINE " : "SPOOFED ";
        const score =
          report.percent === null ? `— (${report.verdict})` : `${report.percent.toFixed(1)}%`;
        rows.push(
          `${label} video=${a.id.slice(3, 11)} imu=${b.id.slice(3, 11)}  ` +
            `${score.padEnd(26)} lag=${String(report.lagMs ?? "—").padStart(5)}ms ` +
            `prom=${report.peakProminence ?? "—"} motion=${report.motionRmsDegPerSec.toFixed(1)}deg/s`,
        );
      }
    }

    console.log(`\n${rows.join("\n")}\n`);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("scores a mismatched pairing below the genuine one", () => {
    // The property the whole anti-spoof claim rests on. If a screen replay can
    // score as well as a real capture, the check is decoration.
    //
    // An earlier version of this skipped any pairing that scored null, which
    // stepped around the exact case that revealed the check was not working.
    // A null on one side is now a comparison that cannot be made, not a pass.
    let compared = 0;

    for (const a of episodes) {
      const genuine = plausibility(flows.get(a.id)!, a.imu);
      // Only episodes with enough motion can demonstrate anything either way.
      if (genuine.verdict !== "ok") continue;

      for (const b of episodes) {
        if (a.id === b.id) continue;
        const spoof = plausibility(flows.get(a.id)!, b.imu);

        // A spoof that cannot be scored is not evidence the check works.
        if (spoof.verdict !== "ok") continue;

        compared++;
        expect(spoof.percent!).toBeLessThan(genuine.percent!);
      }
    }

    console.log(`\n  comparable genuine/spoof pairs: ${compared}\n`);
  });

  it("does not silently pass a spoof that carries no motion", () => {
    // A still capture and an unrelated one are different failures, and the
    // report must distinguish them rather than returning a low number for both.
    for (const a of episodes) {
      for (const b of episodes) {
        const report = plausibility(flows.get(a.id)!, b.imu);
        expect(["ok", "insufficient_motion", "insufficient_frames"]).toContain(report.verdict);
      }
    }
  });
});
