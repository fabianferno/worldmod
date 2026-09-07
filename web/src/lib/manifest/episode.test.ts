import { describe, expect, it } from "vitest";
import { manifestHash, sealManifest, verifyManifestHash } from "./hash";
import { SCHEMA_VERSION, type EpisodeManifest, type StreamResolution } from "./types";

/** A realistic episode as the capture client would assemble it. */
function fixture(): EpisodeManifest {
  return {
    episode_id: "ep_0f3a91c2",
    schema_version: SCHEMA_VERSION,
    asset_id: "asset_9281",
    entity_id: "0xA1b2C3d4E5f60718293a4b5c6d7e8f9012345678",
    bounty_id: "bounty_004",
    task: "cup_pick_and_place",
    duration_s: 17.2,
    recorded_at: 1786550400,
    client: { type: "pwa", version: "0.1.0", ua_class: "ios_safari" },
    capture: {
      video: {
        codec: "video/mp4;codecs=avc1",
        width: 1280,
        height: 720,
        fps_nominal: 30,
        fps_observed: 27.4,
        frame_timing: "recorder_anchored",
        device_label: "Back Camera",
        fov_deg: null,
      },
      imu: {
        rate_hz_observed: 58.7,
        samples: 1010,
        imu_frame: "device_motion_event",
        rotation_convention: "alpha_z_beta_x_gamma_y_degrees",
        screen_orientation: "portrait-primary",
      },
    },
    streams: {
      rgb: { sha256: "0x" + "11".repeat(32), bytes: 24_117_248, content_type: "video/mp4" },
      imu: { sha256: "0x" + "22".repeat(32), bytes: 40_400, content_type: "application/octet-stream" },
      audio: { sha256: "0x" + "33".repeat(32), bytes: 271_360, content_type: "audio/mp4" },
    },
    sync: { method: "recorder_anchored", measured_skew_ms: null },
    outcome: "success",
    self_report: { task_completed: true, notes: "" },
  };
}

describe("episode manifest", () => {
  it("seals and verifies", async () => {
    const sealed = await sealManifest(fixture());
    expect(sealed.manifest_hash).toMatch(/^0x[0-9a-f]{64}$/);
    await expect(verifyManifestHash(sealed)).resolves.toBe(true);
  });

  it("produces a stable hash across independently constructed copies", async () => {
    expect(await manifestHash(fixture())).toBe(await manifestHash(fixture()));
  });

  it("detects tampering with a stream digest", async () => {
    const sealed = await sealManifest(fixture());
    const tampered = {
      ...sealed,
      streams: { ...sealed.streams, rgb: { ...sealed.streams.rgb!, sha256: "0x" + "ff".repeat(32) } },
    };
    await expect(verifyManifestHash(tampered)).resolves.toBe(false);
  });

  it("detects tampering with observed capture conditions", async () => {
    // Overstating the IMU rate is the cheapest way to make data look better
    // than it is, so the commitment has to cover it.
    const sealed = await sealManifest(fixture());
    const inflated = {
      ...sealed,
      capture: { ...sealed.capture, imu: { ...sealed.capture.imu, rate_hz_observed: 200 } },
    };
    await expect(verifyManifestHash(inflated)).resolves.toBe(false);
  });

  it("does not cover storage addressing, so pinning cannot invalidate the signature", async () => {
    const sealed = await sealManifest(fixture());

    const resolution: StreamResolution = {
      episode_id: sealed.episode_id,
      manifest_hash: sealed.manifest_hash,
      pinned_at: 1786550460,
      streams: { rgb: { uri: "s3://episodes/ep_0f3a91c2/rgb.mp4", cid: null } },
    };

    // The resolution references the commitment; the commitment never changes.
    expect(resolution.manifest_hash).toBe(sealed.manifest_hash);
    await expect(verifyManifestHash(sealed)).resolves.toBe(true);
  });
});
