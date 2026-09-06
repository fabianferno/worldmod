/**
 * Assembles an episode manifest from a capture and its on-device scores.
 *
 * This is where the capture layer, the quality layer and the marketplace meet.
 * The manifest records what the device actually delivered — measured rates,
 * observed frame rate, the acceleration source it really had — rather than
 * what was hoped for, and it is sealed with its own hash before anything is
 * sent anywhere.
 *
 * See docs/superpowers/specs/2026-08-23-contributor-pwa-design.md §4.
 */

import type { QualityReport } from "@/lib/analysis";
import type { RawCapture } from "@/lib/capture";
import { encodeImuStream } from "@/lib/capture";
import type { UaClass } from "@/lib/manifest";
import {
  SCHEMA_VERSION,
  sealManifest,
  sha256Blob,
  sha256Hex,
  type EpisodeManifest,
  type SealedEpisodeManifest,
} from "@/lib/manifest";
import type { EpisodeSubmission } from "@/lib/market/types";

export interface BuildEpisodeInput {
  capture: RawCapture;
  quality: QualityReport | null;
  bountyId: string;
  task: string;
  entityId: string;
  assetId: string;
  clientVersion: string;
  /**
   * Detected platform. Recorded so downstream analysis can segment by it —
   * a hardcoded value made every episode claim "other" regardless of the
   * device, which is worse than omitting the field.
   */
  uaClass: UaClass;
}

/** Random, unguessable, and stable for one episode. */
export function newEpisodeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `ep_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function buildEpisodeManifest(
  input: BuildEpisodeInput,
): Promise<SealedEpisodeManifest> {
  const { capture, quality, bountyId, task, entityId, assetId, clientVersion, uaClass } = input;

  const imuBytes = encodeImuStream(capture.imu.stream);

  const manifest: EpisodeManifest = {
    episode_id: newEpisodeId(),
    schema_version: SCHEMA_VERSION,
    asset_id: assetId,
    entity_id: entityId,
    bounty_id: bountyId,
    task,
    duration_s: Number((capture.durationMs / 1000).toFixed(3)),
    recorded_at: Math.floor(capture.startedAtEpochMs / 1000),
    client: { type: "pwa", version: clientVersion, ua_class: uaClass },
    capture: {
      video: {
        codec: capture.video.mimeType,
        width: capture.video.width,
        height: capture.video.height,
        fps_nominal: capture.video.fpsNominal,
        fps_observed: capture.video.fpsObserved,
        frame_timing: capture.video.frameTiming,
        device_label: capture.video.deviceLabel,
        fov_deg: capture.video.fovDeg,
      },
      imu: {
        rate_hz_observed: Number(capture.imu.rateHzObserved.toFixed(3)),
        samples: capture.imu.samples,
        imu_frame: "device_motion_event",
        rotation_convention: "alpha_z_beta_x_gamma_y_degrees",
        screen_orientation: capture.imu.screenOrientation,
      },
    },
    streams: {
      rgb: {
        sha256: await sha256Blob(capture.video.blob),
        bytes: capture.video.blob.size,
        content_type: capture.video.mimeType,
      },
      imu: {
        sha256: await sha256Hex(imuBytes),
        bytes: imuBytes.byteLength,
        content_type: "application/octet-stream",
      },
    },
    sync: { method: capture.video.frameTiming, measured_skew_ms: capture.measuredSkewMs },
    orientation: capture.orientation
      ? { samples: capture.orientation.count, absolute: capture.orientation.absolute }
      : null,
    // Coarse by construction — see lib/capture/geo. Null when not opted in.
    location: capture.location
      ? {
          lat: Number(capture.location.lat.toFixed(4)),
          lon: Number(capture.location.lon.toFixed(4)),
          grid_km: capture.location.grid_km,
        }
      : null,
    outcome: "success",
    self_report: { task_completed: true, notes: "" },
  };

  // Quality is measured on this device and travels with the manifest, so the
  // scores are covered by the same commitment as the streams they describe.
  if (quality) {
    manifest.quality = {
      framing_percent: quality.framing.percent,
      framing_verdict: quality.framing.verdict,
      plausibility_percent: quality.plausibility.percent,
      plausibility_verdict: quality.plausibility.verdict,
      motion_rms_deg_per_sec: Number(quality.plausibility.motionRmsDegPerSec.toFixed(3)),
      frames_analyzed: quality.framesAnalyzed,
      // Perceptual signature is sealed with everything else, so a
      // near-duplicate cannot be disguised by rewriting it in transit.
      signature: [...quality.signature],
      // The MVP produces heuristic data and says so on every record, per
      // product-spec §6.4. Nothing here is device-attested.
      trust_level: "heuristic",
    };
  }

  return sealManifest(manifest);
}

/** The marketplace record derived from a sealed manifest. */
export function toSubmission(
  manifest: SealedEpisodeManifest,
  quality: QualityReport | null,
): EpisodeSubmission {
  const asFraction = (percent: number | null | undefined) =>
    typeof percent === "number" ? percent / 100 : null;

  return {
    episode_id: String(manifest.episode_id),
    bounty_id: String(manifest.bounty_id),
    entity_id: String(manifest.entity_id),
    manifest_hash: manifest.manifest_hash,
    duration_s: Number(manifest.duration_s),
    plausibility: asFraction(quality?.plausibility.percent),
    framing: asFraction(quality?.framing.percent),
    trust_level: "heuristic",
    ua_class: String((manifest.client as { ua_class?: string }).ua_class ?? "other"),
    recorded_at: Number(manifest.recorded_at),
  };
}
