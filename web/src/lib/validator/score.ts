/**
 * Server-side scoring — the authoritative one.
 *
 * The phone draws a skeleton while recording so the wearer can fix their
 * framing mid-take, and that is all it does. Every number that decides
 * acceptance or payment is computed here, from the bytes that actually
 * arrived.
 *
 * Two reasons the work moved off the device, both measured rather than assumed:
 *
 *   The phone was damaging the footage in order to grade it. Running inference
 *   beside the encoder cost frames — 26.9fps against a nominal 30, 49 gaps
 *   longer than 1.5x the frame interval, the worst 818ms — and those gaps land
 *   during movement, which is exactly what the motion check needs to see.
 *
 *   The server scores better anyway. It decodes every frame at full rate with
 *   no readback budget and no encoder to compete with, where the phone sampled
 *   8 frames a second through a shared GPU.
 *
 * A client-reported score is a claim in any case: the contributor owns the
 * device. Recomputing here turns it into evidence.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import * as tf from "@tensorflow/tfjs";
import { plausibility, type FlowSample, type PlausibilityReport } from "@/lib/analysis/correlate";
import { estimateFlow, toGrayscale } from "@/lib/analysis/flow";
import { framingScore, type FrameHands, type FramingReport } from "@/lib/analysis/framing";
import { decodeImuStream, type ImuSample } from "@/lib/capture/imu-codec";
import { detectHandsServerSide } from "./detector";
import { dHash, episodeSignature } from "./phash";

const run = promisify(execFile);

/**
 * Sampling rate for analysis.
 *
 * Higher than the phone managed, and deliberately: flow needs frame pairs close
 * enough together that the motion between them stays inside the pyramid's
 * range, and the device could not afford this while also encoding.
 */
const SAMPLE_FPS = 8;
const MAX_FRAMES = 160;
const EDGE = 192;

/**
 * Hand detection runs on one sampled frame in this many.
 *
 * Detection dominates the cost — 121 frames took 164 seconds — while flow
 * needs consecutive pairs and framing does not need every frame. Scoring
 * every third frame still gives ~40 measurements across a 15s take, which
 * is more than the phone managed, at a third of the time.
 */
const DETECT_EVERY = 3;

export interface Scores {
  framing: FramingReport;
  plausibility: PlausibilityReport;
  signature: string[];
  framesAnalyzed: number;
  elapsedMs: number;
}

interface SampledFrame {
  t: number;
  image: ImageData;
}

async function probeSize(path: string): Promise<{ width: number; height: number }> {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-of", "csv=p=0", path,
  ]);
  const [width, height] = stdout.trim().split(",").map(Number);
  return { width, height };
}

async function extractFrames(path: string): Promise<SampledFrame[]> {
  const { width, height } = await probeSize(path);
  if (!width || !height) return [];

  const scale = EDGE / Math.max(width, height);
  const w = Math.max(2, Math.round((width * scale) / 2) * 2);
  const h = Math.max(2, Math.round((height * scale) / 2) * 2);

  const { stdout } = await run(
    "ffmpeg",
    ["-v", "error", "-i", path, "-vf", `fps=${SAMPLE_FPS},scale=${w}:${h}`,
     "-frames:v", String(MAX_FRAMES), "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
    { maxBuffer: 512 * 1024 * 1024, encoding: "buffer" },
  );

  const raw = stdout as unknown as Buffer;
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

async function flowSeries(frames: SampledFrame[]): Promise<FlowSample[]> {
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

/**
 * Score an episode from its uploaded bytes.
 *
 * Writes the video to a temp file because ffmpeg needs to seek, which it cannot
 * do on a pipe — the container's index lives at the end.
 */
export async function scoreEpisode(video: Uint8Array, imuBytes: Uint8Array): Promise<Scores> {
  const started = Date.now();
  const directory = await mkdtemp(join(tmpdir(), "worldmod-"));
  const videoPath = join(directory, "episode.webm");

  try {
    await writeFile(videoPath, video);
    await tf.setBackend("cpu");
    await tf.ready();

    const frames = await extractFrames(videoPath);
    if (frames.length === 0) {
      throw new Error("No frames could be decoded from the uploaded video.");
    }

    let imu: ImuSample[] = [];
    try {
      imu = decodeImuStream(imuBytes).samples;
    } catch {
      // A missing or corrupt IMU stream is a scoring failure, not a crash;
      // plausibility will report insufficient_frames and say so.
    }

    const hands: FrameHands[] = await detectHandsServerSide(
      frames.filter((_, index) => index % DETECT_EVERY === 0),
    );
    const flow = await flowSeries(frames);

    const signature = episodeSignature(
      frames.map((frame) => {
        try {
          return dHash(frame.image);
        } catch {
          return "";
        }
      }).filter(Boolean),
    );

    return {
      framing: framingScore(hands),
      plausibility: plausibility(flow, imu),
      signature,
      framesAnalyzed: frames.length,
      elapsedMs: Date.now() - started,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
