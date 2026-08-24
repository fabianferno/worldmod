"use client";

import type { QualityReport } from "@/lib/analysis";
import type { CaptureCapabilities, MotionPermission, RawCapture } from "@/lib/capture";

/**
 * Capture diagnostics, collapsed.
 *
 * These numbers used to be half the screen — platform, frame timing, container,
 * observed rates, measured skew, stream sizes. They are genuinely useful, and
 * they are why several real bugs were found on device. They are also not what
 * a contributor opened the app for, and leading with them made an earning app
 * read as a test harness.
 *
 * Kept, one tap away, for whoever wants them.
 */

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-0">
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className={`tabular font-mono text-xs ${warn ? "text-caution" : "text-muted"}`}>
        {value}
      </dd>
    </div>
  );
}

export function Details({
  capture,
  caps,
  motion,
  quality,
}: {
  capture: RawCapture;
  caps: CaptureCapabilities | null;
  motion: MotionPermission | null;
  quality: QualityReport | null;
}) {
  const { video, imu } = capture;
  const throttled = video.fpsObserved !== null && video.fpsObserved < video.fpsNominal * 0.8;

  return (
    <details className="mx-auto mt-6 w-full max-w-md">
      <summary className="interactive cursor-pointer list-none rounded-2xl border border-line px-4 py-3 text-sm font-medium text-muted">
        Technical details
      </summary>

      <dl className="mt-2 rounded-2xl border border-line bg-surface px-4 py-1">
        <Row label="Duration" value={`${(capture.durationMs / 1000).toFixed(2)}s`} />
        <Row label="Resolution" value={`${video.width}×${video.height}`} />
        <Row label="Frame rate" value={`${video.fpsNominal.toFixed(0)} nominal`} />
        <Row
          label="Frame rate observed"
          value={video.fpsObserved === null ? "unknown" : video.fpsObserved.toFixed(2)}
          warn={throttled}
        />
        <Row label="Frames" value={String(video.frameCount)} />
        <Row label="Container" value={video.mimeType} />
        <Row label="Lens" value={video.deviceLabel ?? "unknown"} />
        <Row
          label="IMU rate"
          value={`${imu.rateHzObserved.toFixed(1)} Hz`}
          warn={imu.rateHzObserved > 0 && imu.rateHzObserved < 40}
        />
        <Row label="IMU samples" value={String(imu.samples)} />
        <Row label="Acceleration" value={imu.accelSource} />
        <Row label="Orientation samples" value={String(capture.orientation?.count ?? 0)} />
        <Row
          label="Location"
          value={
            capture.location
              ? `~${capture.location.grid_km}km grid`
              : "not shared"
          }
        />
        <Row
          label="Measured skew"
          value={
            capture.measuredSkewMs === null ? "unknown" : `${capture.measuredSkewMs.toFixed(1)} ms`
          }
        />
        <Row label="Video size" value={`${(video.blob.size / 1_000_000).toFixed(2)} MB`} />
        <Row label="Platform" value={caps?.uaClass ?? "unknown"} />
        <Row label="Frame timing" value={caps?.frameTiming ?? "unknown"} />
        <Row label="Motion permission" value={motion ?? "unknown"} />

        {quality ? (
          <>
            <Row label="Frames analysed" value={String(quality.framesAnalyzed)} />
            <Row label="Hand detections" value={String(quality.stats.detections)} />
            <Row
              label="Detection cost"
              value={`${quality.stats.meanDetectMs.toFixed(0)} ms`}
            />
            <Row
              label="Ticks dropped"
              value={String(quality.stats.droppedTicks)}
              warn={quality.stats.droppedTicks > quality.stats.sampledFrames / 2}
            />
            <Row label="Backend" value={quality.backend} />
            <Row label="Trust level" value="heuristic" />
          </>
        ) : null}
      </dl>

      <p className="mt-2 px-1 text-xs leading-relaxed text-subtle">
        Scored on this device before upload. Heuristic means these checks measure
        whether a capture is plausible, not whether it is genuine — nothing here is
        attested by the hardware.
      </p>
    </details>
  );
}
