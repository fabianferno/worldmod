"use client";

import { useEffect, useRef } from "react";
import { drawHand, GUIDE_REGION, type QualityReport } from "@/lib/analysis";
import type { StoredEpisode } from "@/lib/market/types";

/**
 * What the contributor sees when a take ends.
 *
 * The old screen led with two meters labelled "Framing" and "Plausibility" —
 * the validator's vocabulary, not the wearer's. Someone who just performed a
 * task wants to know whether they were paid and, if not, what to do
 * differently. The measurements support that answer; they are not the answer.
 */

function Meter({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  const known = typeof value === "number";
  const tone = !known
    ? "bg-white/20"
    : value >= 0.7
      ? "bg-positive"
      : value >= 0.4
        ? "bg-caution"
        : "bg-negative";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm">{label}</span>
        <span className="tabular font-mono text-sm text-muted">
          {known ? `${Math.round(value * 100)}%` : "—"}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: known ? `${Math.max(3, value * 100)}%` : "100%" }}
        />
      </div>
      <p className="mt-1 text-xs leading-relaxed text-subtle">{hint}</p>
    </div>
  );
}

/** The frame that was scored, with the tracked hand drawn on it. */
function Preview({ report }: { report: QualityReport }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const preview = report.preview;
    if (!canvas || !preview) return;

    const { image, hands } = preview;
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

    ctx.strokeStyle = "rgba(52, 211, 153, 0.6)";
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
    <figure className="mt-5">
      <canvas ref={canvasRef} className="w-full rounded-2xl border border-line bg-black" />
      <figcaption className="mt-1.5 text-xs text-subtle">
        A frame from your take. The box is where hands need to be.
      </figcaption>
    </figure>
  );
}

export function Result({
  submitted,
  quality,
  error,
  onAgain,
}: {
  submitted: StoredEpisode | null;
  quality: QualityReport | null;
  error: string | null;
  onAgain: () => void;
}) {
  const paid = submitted?.accepted === true;

  return (
    <div className="mx-auto w-full max-w-md pb-4">
      <div className="pt-6 text-center">
        {paid ? (
          <>
            <p className="tabular text-5xl font-semibold tracking-tight text-positive">
              +${submitted!.paid_usdc.toFixed(2)}
            </p>
            <p className="mt-2 text-base font-medium">Episode accepted</p>
            <p className="mt-1 text-sm text-muted">Your recording met the bar for this task.</p>
          </>
        ) : submitted ? (
          <>
            <p className="text-base font-medium">Not accepted</p>
            {/* One clear reason beats a list of measurements. */}
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">
              {submitted.reasons[0] ?? "This one did not meet the task's bar."}
            </p>
            {submitted.reasons.length > 1 ? (
              <p className="mt-1 text-xs text-subtle">
                and {submitted.reasons.length - 1} more
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-base font-medium">Saved on your phone</p>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">
              {error ?? "It will upload when you are back online. Nothing is lost."}
            </p>
          </>
        )}
      </div>

      {quality ? (
        <div className="mt-7 space-y-5">
          <Meter
            label="Hands in view"
            value={quality.framing.percent === null ? null : quality.framing.percent / 100}
            hint={
              quality.framing.visibilityPercent === 0
                ? "The camera never saw your hands. Tilt the phone down."
                : "How much of the take had your hands where the task needs them."
            }
          />
          <Meter
            label="Motion check"
            value={
              quality.plausibility.percent === null ? null : quality.plausibility.percent / 100
            }
            hint={
              quality.plausibility.verdict === "insufficient_motion"
                ? "You barely moved your head, so there was nothing to check against. Not a problem for this task."
                : quality.plausibility.motionRmsDegPerSec < 10
                  ? `Only ${quality.plausibility.motionRmsDegPerSec.toFixed(0)} deg/s of head movement — too little to confirm much. Walking and looking around scores far higher.`
                  : "Whether what the camera saw matches how the phone moved."
            }
          />
        </div>
      ) : null}

      {quality ? <Preview report={quality} /> : null}

      {paid ? null : (
        <p className="mt-5 rounded-2xl border border-line bg-surface p-4 text-sm leading-relaxed text-muted">
          Nothing was charged to you. Try again — most rejections are a framing
          problem, and the box on the preview shows where hands need to be.
        </p>
      )}

      <button
        onClick={onAgain}
        className="interactive mt-6 w-full rounded-2xl bg-foreground py-4 text-base font-semibold text-background"
      >
        Record another
      </button>
    </div>
  );
}
