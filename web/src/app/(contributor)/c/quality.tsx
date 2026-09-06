"use client";

import { useEffect, useRef } from "react";
import { drawHand, GUIDE_REGION, type QualityReport } from "@/lib/analysis";

/**
 * A meter reads 0-100 only when there is something to measure. A verdict of
 * "not enough motion" or "no hands seen" is information, not a zero, and
 * rendering it as an empty bar would tell the contributor the wrong thing.
 */
function Meter({
  label,
  percent,
  caption,
  good,
}: {
  label: string;
  percent: number | null;
  caption: string;
  /** Threshold above which the value reads as healthy. */
  good: number;
}) {
  const unavailable = percent === null;
  const tone = unavailable
    ? "bg-white/25"
    : percent >= good
      ? "bg-emerald-500"
      : percent >= good * 0.6
        ? "bg-amber-500"
        : "bg-red-500";

  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="font-mono text-lg tabular-nums">
          {unavailable ? "—" : `${percent.toFixed(0)}%`}
        </span>
      </div>

      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${tone}`}
          style={{ width: unavailable ? "100%" : `${Math.max(2, percent)}%` }}
        />
      </div>

      <p className="mt-1.5 text-xs text-white/45">{caption}</p>
    </div>
  );
}

/** The recorded frame with its pivot points drawn, plus the guide it was scored against. */
function PivotOverlay({ report }: { report: QualityReport }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const preview = report.preview;
    if (!canvas || !preview) return;

    const { image, hands } = preview;

    // The analysis frame is small; render it into a larger backing store so the
    // overlay has pixels to draw into rather than being scaled up by CSS.
    const scale = 3;
    const width = image.width * scale;
    const height = image.height * scale;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const source = document.createElement("canvas");
    source.width = image.width;
    source.height = image.height;
    source.getContext("2d")?.putImageData(image, 0, 0);
    ctx.drawImage(source, 0, 0, width, height);

    // The region the framing score was computed against.
    ctx.strokeStyle = "rgba(52, 211, 153, 0.65)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(
      GUIDE_REGION.x0 * width,
      GUIDE_REGION.y0 * height,
      (GUIDE_REGION.x1 - GUIDE_REGION.x0) * width,
      (GUIDE_REGION.y1 - GUIDE_REGION.y0) * height,
    );
    ctx.setLineDash([]);

    for (const hand of hands.hands) drawHand(ctx, hand, width, height);
  }, [report]);

  if (!report.preview) return null;

  return (
    <figure className="mt-4">
      <canvas
        ref={canvasRef}
        className="w-full rounded-lg border border-white/10 bg-black"
      />
      <figcaption className="mt-1.5 text-xs text-white/40">
        Pivot points on the frame used for scoring; dashed box is the region the
        framing score measures against.
      </figcaption>
    </figure>
  );
}

export function QualityPanel({ report }: { report: QualityReport }) {
  const { framing, plausibility: motion } = report;

  const framingCaption =
    framing.verdict === "no_frames"
      ? "No frames could be analysed."
      : framing.visibilityPercent === 0
        ? "Hands were never detected — the camera may be aimed too high."
        : `Hands visible in ${framing.visibilityPercent?.toFixed(0)}% of frames, ` +
          `well framed in ${framing.percent?.toFixed(0)}%.`;

  const motionCaption =
    motion.verdict === "insufficient_motion"
      ? `Too little head movement to judge (${motion.motionRmsDegPerSec.toFixed(1)} deg/s). ` +
        "Not a failure — there is simply nothing to correlate."
      : motion.verdict === "insufficient_frames"
        ? `Only ${motion.pairs} frame pairs had IMU coverage; too few to score.`
        : `Image motion tracks the gyroscope across ${motion.pairs} frame pairs.`;

  return (
    <section className="px-5 pb-6">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/40">
        Data quality
      </h2>

      <Meter
        label="Framing"
        percent={framing.percent}
        good={70}
        caption={framingCaption}
      />
      <Meter
        label="Plausibility"
        percent={motion.percent}
        good={70}
        caption={motionCaption}
      />

      <PivotOverlay report={report} />

      <p className="mt-3 text-xs text-white/30">
        {report.framesAnalyzed} frames sampled live, {report.stats.detections} hand
        detections at {report.stats.meanDetectMs.toFixed(0)}ms each on the {report.backend}
        backend
        {report.stats.droppedTicks > 0
          ? `, ${report.stats.droppedTicks} ticks dropped to keep up`
          : ""}
        . Scored on this device during the take, before upload.
      </p>
    </section>
  );
}
