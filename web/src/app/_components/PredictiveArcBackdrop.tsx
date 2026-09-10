"use client";

import { DataPixelArcCanvas } from "../../shaders/data-pixel-arc/DataPixelArcCanvas";
import "../../shaders/threeui.css";

/**
 * The homepage's Data Pixel Arc, fitted to the capture viewfinder.
 *
 * Same registered renderer as `PredictiveArcHero`, but in its `dark` mode —
 * which paints the near-black (#030304) ground that reads as the ink card —
 * and sized to fill its parent rather than sitting in a 200px `.shader-frame`
 * band. It exists so the idle camera screen has the same living motion the
 * landing page does, while the viewfinder is still empty; the caller shows it
 * only before recording, so it never competes with live video or overlays.
 *
 * A light desaturation keeps the emerald from shouting over the on-ink copy
 * layered on top; the renderer pauses itself off-screen and when the tab is
 * hidden, so an idle screen left open is not burning a RAF loop.
 */
export function PredictiveArcBackdrop() {
  return (
    <div className="absolute inset-0">
      <DataPixelArcCanvas mode="dark" speed={1.0} hue={0} saturation={0.85} brightness={1.0} />
    </div>
  );
}
