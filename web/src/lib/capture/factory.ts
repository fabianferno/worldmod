/**
 * Capability-detecting backend selection.
 *
 * Selection is by capability, never by user agent. The UA class is recorded in
 * the manifest for downstream segmentation, but a browser that grows
 * MediaStreamTrackProcessor support should get the better path the day it
 * ships, without a release here.
 */

import { MediaRecorderCapture } from "./backends/media-recorder";
import { MockCapture, type MockCaptureOptions } from "./backends/mock";
import { supportsTrackProcessor, TrackProcessorCapture } from "./backends/track-processor";
import type { CaptureBackend } from "./types";

export interface CaptureFactoryOptions {
  /** Force the mock backend — local development without a camera, and UI tests. */
  mock?: MockCaptureOptions | boolean;
  /** Scope to probe for capabilities. Injected in tests. */
  scope?: object;
}

export function createCaptureBackend(options: CaptureFactoryOptions = {}): CaptureBackend {
  if (options.mock) {
    return new MockCapture(typeof options.mock === "object" ? options.mock : {});
  }
  return supportsTrackProcessor(options.scope ?? globalThis)
    ? new TrackProcessorCapture()
    : new MediaRecorderCapture();
}

export function isSecureCaptureContext(scope: object = globalThis): boolean {
  // getUserMedia and DeviceMotionEvent both require a secure context. A LAN IP
  // is not one, which is what breaks the first on-device test.
  return (scope as { isSecureContext?: boolean }).isSecureContext === true;
}
