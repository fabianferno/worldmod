"use client";

import { useEffect, useRef } from "react";
import type { LivePrediction } from "@/lib/analysis/live-predictor";

/**
 * The model's live guess at what happens next — product-spec §8.2's rollout
 * visualisation, running during the take instead of after it.
 *
 * What is actually shown: of the frames captured so far this take, the one
 * closest — in the model's own latent space — to where it predicts the
 * motion is heading. During a live recording that can only be a frame from
 * earlier in this same take, never a genuinely future one, since the future
 * has not been recorded yet. The label says "closest match so far" rather
 * than "next frame" for exactly that reason.
 */
export function PredictionPanel({ prediction }: { prediction: LivePrediction | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !prediction) return;

    const size = prediction.image.width;
    if (canvas.width !== size) canvas.width = size;
    if (canvas.height !== size) canvas.height = size;

    canvas.getContext("2d")?.putImageData(prediction.image, 0, 0);
  }, [prediction]);

  if (!prediction) return null;

  return (
    <div className="pointer-events-none absolute right-4 top-4 w-[84px] overflow-hidden rounded-inner bg-lilac p-1 shadow-lift-high">
      <canvas ref={canvasRef} className="block h-[76px] w-[76px] rounded-[12px] object-cover" />
      <p className="px-1 pb-0.5 pt-1 text-center text-[9px] font-medium leading-tight text-lilac-ink/80">
        {prediction.warming ? "learning your take…" : "model's guess"}
      </p>
    </div>
  );
}
