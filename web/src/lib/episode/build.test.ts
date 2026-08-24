import { describe, expect, it } from "vitest";
import type { QualityReport } from "@/lib/analysis";
import type { RawCapture } from "@/lib/capture";
import { verifyManifestHash } from "@/lib/manifest";
import { evaluateEpisode } from "@/lib/market/acceptance";
import { KEYBOARD_BOUNTY } from "@/lib/market/seed";
import { buildEpisodeManifest, newEpisodeId, toSubmission } from "./build";

function capture(overrides: Partial<RawCapture> = {}): RawCapture {
  return {
    video: {
      blob: new Blob([new Uint8Array(2048)], { type: "video/webm" }),
      mimeType: "video/webm;codecs=vp9,opus",
      width: 720,
      height: 1280,
      fpsNominal: 30,
      fpsObserved: 28.4,
      frameCount: 420,
      deviceLabel: "camera 2, facing back",
      fovDeg: null,
      frameTiming: "track_processor",
      frameTimestampsMs: [0, 33, 66],
    },
    audio: null,
    imu: {
      stream: {
        startedAtEpochMs: 1_787_000_000_000,
        samples: Array.from({ length: 900 }, (_, i) => ({
          t: i * (1000 / 60),
          ax: 0,
          ay: 0,
          az: 9.8125,
          rx: 0.2,
          ry: 0.1,
          rz: 0,
        })),
      },
      rateHzObserved: 60,
      samples: 900,
      accelSource: "linear",
      screenOrientation: "portrait-primary",
      durationMs: 15_000,
    },
    orientation: { count: 120, absolute: false },
    location: null,
    startedAtEpochMs: 1_787_000_000_000,
    durationMs: 15_000,
    measuredSkewMs: 36.1,
    ...overrides,
  };
}

function quality(overrides: Partial<QualityReport> = {}): QualityReport {
  return {
    framing: {
      verdict: "ok",
      percent: 97,
      framesAnalyzed: 118,
      framesWithHands: 115,
      framesInGuide: 115,
      visibilityPercent: 97,
    },
    plausibility: {
      verdict: "insufficient_motion",
      percent: null,
      correlation: null,
      perAxis: { yaw: null, pitch: null },
      pairs: 110,
      motionRmsDegPerSec: 0.8,
      lagMs: null,
      peakProminence: null,
    },
    framesAnalyzed: 118,
    hands: [],
    preview: null,
    stats: { sampledFrames: 118, detections: 59, droppedTicks: 4, meanDetectMs: 42 },
    signature: ["1122334455667788", "99aabbccddeeff00"],
    backend: "webgl",
    ...overrides,
  };
}

const input = {
  bountyId: KEYBOARD_BOUNTY.bounty_id,
  task: KEYBOARD_BOUNTY.task,
  entityId: "0xA1b2C3d4",
  assetId: "asset_1",
  clientVersion: "0.1.0",
  uaClass: "android_chrome" as const,
};

describe("newEpisodeId", () => {
  it("is prefixed and unguessable", () => {
    const id = newEpisodeId();
    expect(id).toMatch(/^ep_[0-9a-f]{24}$/);
    expect(newEpisodeId()).not.toBe(id);
  });
});

describe("buildEpisodeManifest", () => {
  it("seals a manifest that verifies against its own hash", async () => {
    const manifest = await buildEpisodeManifest({ capture: capture(), quality: quality(), ...input });

    expect(manifest.manifest_hash).toMatch(/^0x[0-9a-f]{64}$/);
    await expect(verifyManifestHash(manifest)).resolves.toBe(true);
  });

  it("records what the device delivered, not what was requested", async () => {
    const manifest = await buildEpisodeManifest({ capture: capture(), quality: quality(), ...input });
    const cap = manifest.capture as {
      video: { fps_nominal: number; fps_observed: number | null };
      imu: { rate_hz_observed: number };
    };

    expect(cap.video.fps_nominal).toBe(30);
    expect(cap.video.fps_observed).toBeCloseTo(28.4, 5);
    expect(cap.imu.rate_hz_observed).toBeCloseTo(60, 5);
  });

  it("hashes both streams as bytes", async () => {
    const manifest = await buildEpisodeManifest({ capture: capture(), quality: quality(), ...input });
    const streams = manifest.streams as Record<string, { sha256: string; bytes: number }>;

    expect(streams.rgb.sha256).toMatch(/^0x[0-9a-f]{64}$/);
    expect(streams.imu.sha256).toMatch(/^0x[0-9a-f]{64}$/);
    // 900 samples x 28 bytes + 20 byte header.
    expect(streams.imu.bytes).toBe(900 * 28 + 20);
  });

  it("covers the quality scores with the same commitment as the streams", async () => {
    // Scores travel inside the sealed manifest, so a contributor cannot report
    // one number to the marketplace and a different one to the validator.
    const manifest = await buildEpisodeManifest({ capture: capture(), quality: quality(), ...input });
    const tampered = {
      ...manifest,
      quality: { ...(manifest.quality as object), framing_percent: 100 },
    };

    await expect(verifyManifestHash(tampered)).resolves.toBe(false);
  });

  it("keeps a null plausibility rather than inventing a score", async () => {
    const manifest = await buildEpisodeManifest({ capture: capture(), quality: quality(), ...input });
    const q = manifest.quality as { plausibility_percent: number | null; plausibility_verdict: string };

    expect(q.plausibility_percent).toBeNull();
    expect(q.plausibility_verdict).toBe("insufficient_motion");
  });

  it("builds without quality when scoring failed", async () => {
    const manifest = await buildEpisodeManifest({ capture: capture(), quality: null, ...input });
    expect(manifest.quality).toBeUndefined();
    await expect(verifyManifestHash(manifest)).resolves.toBe(true);
  });
});

describe("client platform", () => {
  it("records the detected platform rather than a placeholder", async () => {
    // Shipped once with a hardcoded "other": every episode misreported its
    // platform, poisoning exactly the per-platform analysis the field exists
    // for. Caught on a real submission from an S24 Ultra.
    const manifest = await buildEpisodeManifest({ capture: capture(), quality: quality(), ...input });
    expect((manifest.client as { ua_class: string }).ua_class).toBe("android_chrome");
    expect(toSubmission(manifest, quality()).ua_class).toBe("android_chrome");
  });
});

describe("toSubmission", () => {
  it("converts percentages to the fractions the marketplace compares against", async () => {
    const manifest = await buildEpisodeManifest({ capture: capture(), quality: quality(), ...input });
    const submission = toSubmission(manifest, quality());

    expect(submission.framing).toBeCloseTo(0.97, 6);
    expect(submission.plausibility).toBeNull();
    expect(submission.manifest_hash).toBe(manifest.manifest_hash);
  });

  it("produces a submission the keyboard bounty accepts", async () => {
    // The end-to-end case: typing scores well on framing, has no motion
    // evidence, and the bounty's allow_static policy takes it anyway.
    const manifest = await buildEpisodeManifest({ capture: capture(), quality: quality(), ...input });
    const decision = evaluateEpisode(KEYBOARD_BOUNTY, toSubmission(manifest, quality()));

    expect(decision.accepted).toBe(true);
    expect(decision.paid_usdc).toBeCloseTo(0.6, 6);
  });

  it("produces a submission the bounty rejects when hands were never framed", async () => {
    const bad = quality({
      framing: {
        verdict: "ok",
        percent: 12,
        framesAnalyzed: 118,
        framesWithHands: 20,
        framesInGuide: 14,
        visibilityPercent: 17,
      },
    });
    const manifest = await buildEpisodeManifest({ capture: capture(), quality: bad, ...input });
    const decision = evaluateEpisode(KEYBOARD_BOUNTY, toSubmission(manifest, bad));

    expect(decision.accepted).toBe(false);
    expect(decision.reasons.join(" ")).toMatch(/12% of frames/);
  });
});
