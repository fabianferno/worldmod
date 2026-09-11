"use client";

import { DataPixelArcCanvas } from "../../shaders/data-pixel-arc/DataPixelArcCanvas";
import "../../shaders/threeui.css";

/**
 * The registered ThreeUI PredictiveArcCanvas, configured as the Data Pixel Arc
 * variant (`data-pixel`) with its documented props. For this variant the
 * package's `PredictiveArcCanvas` simply strips `variant` and renders
 * `DataPixelArcCanvas` — a self-contained Canvas 2D renderer with no Three.js
 * or `?raw` HTML dependencies — so we mount that exact registered component
 * directly. The `"use client"` boundary lives here rather than in the vendored
 * source, which is preserved byte-for-byte.
 */
export function PredictiveArcHero() {
  return (
    <div className="shader-frame">
      <DataPixelArcCanvas
        mode="dark"
        speed={1.0}
        hue={0}
        saturation={1.0}
        brightness={1.0}
      />
    </div>
  );
}
