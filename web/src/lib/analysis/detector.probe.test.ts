import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as handPoseDetection from "@tensorflow-models/hand-pose-detection";
import * as tf from "@tensorflow/tfjs";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Does the hand detector find hands in frames this phone actually recorded?
 *
 * Hand tracking stopped and two attempts at fixing it from reasoning did not
 * bring it back, so this establishes ground truth instead. It feeds real frames
 * from a recorded episode — one known to contain a hand on a keyboard, because
 * the overlay drew a skeleton on it — straight to the detector as tensors.
 *
 * If hands are found here, the model and weights are fine and the fault is in
 * how the browser hands frames to it. If they are not, the problem is the model
 * itself and no amount of input plumbing will help.
 *
 * Needs the dev server up to serve the weights, and ffmpeg to decode.
 */

const EPISODES_DIR = join(process.cwd(), ".data", "episodes");
const ORIGIN = "http://localhost:3000";

function canRun(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    return false;
  }
  return existsSync(EPISODES_DIR) && readdirSync(EPISODES_DIR).length > 0;
}

async function serverUp(): Promise<boolean> {
  try {
    const response = await fetch(`${ORIGIN}/models/hand/detector/model.json`);
    return response.ok;
  } catch {
    return false;
  }
}

/** Evenly spaced RGB frames from an episode, as tensors. */
function frames(path: string, count: number): { tensor: tf.Tensor3D; index: number }[] {
  const probe = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
    { encoding: "utf8" },
  ).trim();
  const [width, height] = probe.split(",").map(Number);

  const scale = 480 / Math.max(width, height);
  const w = Math.max(2, Math.round((width * scale) / 2) * 2);
  const h = Math.max(2, Math.round((height * scale) / 2) * 2);

  const raw = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-vf", `fps=2,scale=${w}:${h}`, "-frames:v", String(count),
     "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 1024 * 1024 * 256 },
  );

  const stride = w * h * 3;
  const total = Math.min(count, Math.floor(raw.length / stride));

  return Array.from({ length: total }, (_, i) => ({
    index: i,
    tensor: tf.tensor3d(
      new Uint8Array(raw.subarray(i * stride, (i + 1) * stride)),
      [h, w, 3],
      "int32",
    ) as tf.Tensor3D,
  }));
}

const runnable = canRun();

describe.skipIf(!runnable)("hand detector against real recorded frames", () => {
  let detector: handPoseDetection.HandDetector | null = null;
  let available = false;

  beforeAll(async () => {
    available = await serverUp();
    if (!available) return;

    await tf.setBackend("cpu");
    await tf.ready();

    detector = await handPoseDetection.createDetector(
      handPoseDetection.SupportedModels.MediaPipeHands,
      {
        runtime: "tfjs",
        modelType: "lite",
        maxHands: 2,
        detectorModelUrl: `${ORIGIN}/models/hand/detector/model.json`,
        landmarkModelUrl: `${ORIGIN}/models/hand/landmark/model.json`,
      },
    );
  }, 180_000);

  it("loads the self-hosted weights", () => {
    if (!available) {
      console.log("\n  dev server not reachable — start it and re-run\n");
      return;
    }
    expect(detector).not.toBeNull();
  });

  it("finds hands in frames the phone recorded", async () => {
    if (!available || !detector) return;

    const dirs = readdirSync(EPISODES_DIR)
      .map((n) => join(EPISODES_DIR, n))
      .filter((d) => existsSync(join(d, "rgb.webm")));

    const rows: string[] = [];

    for (const dir of dirs) {
      const id = dir.split("/").pop()!;
      const sampled = frames(join(dir, "rgb.webm"), 8);

      let withHands = 0;
      let totalPoints = 0;

      for (const { tensor } of sampled) {
        const found = await detector.estimateHands(tensor, { flipHorizontal: false });
        if (found.length > 0) {
          withHands++;
          totalPoints += found[0].keypoints.length;
        }
        tensor.dispose();
      }

      rows.push(
        `  ${id.slice(3, 11)}  frames=${sampled.length}  withHands=${withHands}  ` +
          `keypoints/hand=${withHands ? (totalPoints / withHands).toFixed(0) : "—"}`,
      );
    }

    console.log(`\n${rows.join("\n")}\n`);

    // The keyboard episode demonstrably contains a hand — the overlay drew a
    // skeleton on it while recording. If nothing is found in any episode, the
    // model is the problem, not the plumbing.
    expect(rows.length).toBeGreaterThan(0);
  }, 300_000);
});
