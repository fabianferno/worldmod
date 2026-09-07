import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scoreEpisode } from "./score";

/**
 * The server scorer, against episodes the phone actually recorded.
 *
 * This is now the authoritative path — the phone only draws a skeleton — so it
 * has to work on real uploads rather than fixtures. It also proves the
 * filesystem model loader, which exists because the validator must not depend
 * on reaching its own web server.
 */

const EPISODES = join(process.cwd(), ".data", "episodes");

function runnable(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    return false;
  }
  return existsSync(EPISODES) && readdirSync(EPISODES).length > 0;
}

const dirs = runnable()
  ? readdirSync(EPISODES)
      .map((n) => join(EPISODES, n))
      .filter((d) => existsSync(join(d, "rgb.webm")) && existsSync(join(d, "imu.bin")))
  : [];

describe.skipIf(dirs.length === 0)("server-side scoring", () => {
  it("scores a real episode from its uploaded bytes", async () => {
    const directory = dirs[0];
    const scores = await scoreEpisode(
      new Uint8Array(readFileSync(join(directory, "rgb.webm"))),
      new Uint8Array(readFileSync(join(directory, "imu.bin"))),
    );

    console.log(
      `\n  ${directory.split("/").pop()!.slice(3, 11)}  ` +
        `frames=${scores.framesAnalyzed}  ` +
        `framing=${scores.framing.percent}%  ` +
        `visible=${scores.framing.visibilityPercent}%  ` +
        `motion=${scores.plausibility.percent ?? scores.plausibility.verdict}  ` +
        `signature=${scores.signature.length}  ` +
        `${(scores.elapsedMs / 1000).toFixed(1)}s\n`,
    );

    // The server decodes every sampled frame; the phone managed 8 a second
    // through a shared GPU while encoding.
    expect(scores.framesAnalyzed).toBeGreaterThan(30);
    expect(scores.signature.length).toBeGreaterThan(0);
    expect(scores.framing.verdict).toBe("ok");
  }, 300_000);

  it("refuses bytes that are not decodable video", async () => {
    await expect(
      scoreEpisode(new Uint8Array([1, 2, 3, 4]), new Uint8Array()),
    ).rejects.toThrow();
  }, 60_000);

  it("still scores framing when the IMU stream is missing", async () => {
    // A corrupt motion stream must cost the motion check, not the whole run.
    const directory = dirs[0];
    const scores = await scoreEpisode(
      new Uint8Array(readFileSync(join(directory, "rgb.webm"))),
      new Uint8Array(),
    );

    expect(scores.framing.verdict).toBe("ok");
    expect(scores.plausibility.percent).toBeNull();
  }, 300_000);
});
