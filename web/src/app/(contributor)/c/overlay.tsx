"use client";

import { useEffect, useRef } from "react";
import { drawHand, type GuideRegion, type Landmark } from "@/lib/analysis";

/**
 * Skeleton and pivots drawn over the live viewfinder.
 *
 * Sized to its own displayed box rather than to the analysis canvas: landmarks
 * are normalised, so the same numbers that score the episode also draw it,
 * with no coordinate conversion at the call site.
 */
export function LiveOverlay({
  hands,
  guide,
  showGuide,
}: {
  hands: Landmark[][];
  guide: GuideRegion;
  showGuide: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Match the backing store to the CSS box so lines stay crisp on a phone.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (showGuide) {
      // The guide box speaks the surface's own two signals: mint when the framing
    // is right, butter when it needs a hand.
    ctx.strokeStyle = hands.length > 0 ? "rgba(199, 230, 218, 0.85)" : "rgba(246, 220, 171, 0.9)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.strokeRect(
        guide.x0 * width,
        guide.y0 * height,
        (guide.x1 - guide.x0) * width,
        (guide.y1 - guide.y0) * height,
      );
      ctx.setLineDash([]);
    }

    for (const hand of hands) drawHand(ctx, hand, width, height);
  }, [hands, guide, showGuide]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
