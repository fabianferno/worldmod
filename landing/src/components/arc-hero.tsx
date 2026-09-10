"use client";

import { DataPixelArcCanvas } from "@/shaders/data-pixel-arc/DataPixelArcCanvas";

/* The same Data Pixel Arc the app opens on, same props. */
export function ArcHero() {
  return (
    <div className="shader-frame" aria-hidden>
      <DataPixelArcCanvas mode="light" speed={1.0} hue={0} saturation={1.0} brightness={1.35} />
    </div>
  );
}
