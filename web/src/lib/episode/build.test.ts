import { describe, expect, it } from "vitest";
import type { RawCapture } from "@/lib/capture";
import { verifyManifestHash } from "@/lib/manifest";
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
    const manifest = await buildEpisodeManifest({ capture: capture(), ...input });

    expect(manifest.manifest_hash).toMatch(/^0x[0-9a-f]{64}$/);
    await expect(verifyManifestHash(manifest)).resolves.toBe(true);
  });

  it("records what the device delivered, not what was requested", async () => {
    const manifest = await buildEpisodeManifest({ capture: capture(), ...input });
    const cap = manifest.capture as {
      video: { fps_nominal: number; fps_observed: number | null };
      imu: { rate_hz_observed: number };
    };

    expect(cap.video.fps_nominal).toBe(30);
    expect(cap.video.fps_observed).toBeCloseTo(28.4, 5);
    expect(cap.imu.rate_hz_observed).toBeCloseTo(60, 5);
  });

  it("hashes both streams as bytes", async () => {
    const manifest = await buildEpisodeManifest({ capture: capture(), ...input });
    const streams = manifest.streams as Record<string, { sha256: string; bytes: number }>;

    expect(streams.rgb.sha256).toMatch(/^0x[0-9a-f]{64}$/);
    expect(streams.imu.sha256).toMatch(/^0x[0-9a-f]{64}$/);
    // 900 samples x 28 bytes + 20 byte header.
    expect(streams.imu.bytes).toBe(900 * 28 + 20);
  });

});

describe("client platform", () => {
  it("records the detected platform rather than a placeholder", async () => {
    // Shipped once with a hardcoded "other": every episode misreported its
    // platform, poisoning exactly the per-platform analysis the field exists
    // for. Caught on a real submission from an S24 Ultra.
    const manifest = await buildEpisodeManifest({ capture: capture(), ...input });
    expect((manifest.client as { ua_class: string }).ua_class).toBe("android_chrome");
    expect(toSubmission(manifest).ua_class).toBe("android_chrome");
  });
});

describe("toSubmission", () => {
  it("carries no scores — the server measures them", async () => {
    // A contributor owns their phone, so a self-reported score is a claim.
    // The submission deliberately leaves both null for the server to fill.
    const manifest = await buildEpisodeManifest({ capture: capture(), ...input });
    const submission = toSubmission(manifest);

    expect(submission.framing).toBeNull();
    expect(submission.plausibility).toBeNull();
    expect(submission.manifest_hash).toBe(manifest.manifest_hash);
  });
});
