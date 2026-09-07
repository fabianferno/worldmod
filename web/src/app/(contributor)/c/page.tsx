import type { Metadata } from "next";
import CaptureClient from "./capture-client";

export const metadata: Metadata = {
  title: "Capture — World Mod",
  description: "Record a short episode, get it scored on your device, get paid.",
};

/**
 * Server shell. All capture work is client-side by necessity — getUserMedia,
 * DeviceMotionEvent, MediaRecorder and WebCrypto are browser-only.
 */
export default function CapturePage() {
  return <CaptureClient />;
}
