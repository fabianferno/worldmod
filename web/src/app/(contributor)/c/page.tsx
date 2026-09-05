import type { Metadata } from "next";
import CaptureClient from "./capture-client";

export const metadata: Metadata = {
  title: "Capture check — World Mod",
  description: "Record a head-mounted episode and read what the device actually delivered.",
};

/**
 * Server shell. All capture work is client-side by necessity — getUserMedia,
 * DeviceMotionEvent, MediaRecorder and WebCrypto are browser-only.
 */
export default function CapturePage() {
  return <CaptureClient />;
}
