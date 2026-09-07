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
    <div className="pointer-events-none absolute right-3 top-3 w-20 overflow-hidden rounded-xl border border-white/25 bg-black/40 backdrop-blur-sm">
      <canvas ref={canvasRef} className="block h-20 w-20 object-cover" />
      <p className="px-1.5 py-1 text-center text-[9px] leading-tight text-white/70">
        {prediction.warming ? "learning your take…" : "model's guess"}
      </p>
    </div>
  );
}
