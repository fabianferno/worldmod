import { describe, expect, it } from "vitest";
import { encodeImuStream } from "./imu-codec";
import { MockCapture } from "./backends/mock";
import { MediaRecorderCapture } from "./backends/media-recorder";
import { TrackProcessorCapture } from "./backends/track-processor";
import { createCaptureBackend, isSecureCaptureContext } from "./factory";
import { CaptureError } from "./types";

describe("createCaptureBackend", () => {
  it("selects the track-processor backend where the API exists", () => {
    const backend = createCaptureBackend({ scope: { MediaStreamTrackProcessor: class {} } });
    expect(backend).toBeInstanceOf(TrackProcessorCapture);
    expect(backend.frameTiming).toBe("track_processor");
  });

  it("falls back to the recorder backend where it does not", () => {
    const backend = createCaptureBackend({ scope: {} });
    expect(backend).toBeInstanceOf(MediaRecorderCapture);
    expect(backend.frameTiming).toBe("recorder_anchored");
  });

  it("selects by capability rather than user agent", () => {
    // A WebKit UA in a scope that has the API still gets the better path.
    const backend = createCaptureBackend({ scope: { MediaStreamTrackProcessor: class {} } });
    expect(backend.frameTiming).toBe("track_processor");
  });

  it("returns the mock backend when asked", () => {
    expect(createCaptureBackend({ mock: true })).toBeInstanceOf(MockCapture);
    expect(createCaptureBackend({ mock: { durationMs: 5_000 } })).toBeInstanceOf(MockCapture);
  });
});

describe("isSecureCaptureContext", () => {
  it("is true only in a secure context", () => {
    expect(isSecureCaptureContext({ isSecureContext: true })).toBe(true);
    expect(isSecureCaptureContext({ isSecureContext: false })).toBe(false);
    expect(isSecureCaptureContext({})).toBe(false);
  });
});

describe("capture backend contract (via MockCapture)", () => {
  it("produces a capture whose IMU stream encodes cleanly", async () => {
    const backend = new MockCapture({ durationMs: 15_000, imuRateHz: 60 });
    await backend.start({ maxDurationMs: 30_000, audio: false });
    const capture = await backend.stop();

    expect(capture.imu.samples).toBe(900);
    expect(capture.imu.rateHzObserved).toBeCloseTo(60, 6);
    // The codec is what the manifest hashes, so it must accept what capture emits.
    expect(() => encodeImuStream(capture.imu.stream)).not.toThrow();
  });

  it("reports frame timing consistent with its declared backend", async () => {
    const backend = new MockCapture({ durationMs: 2_000, fps: 30 });
    await backend.start({ maxDurationMs: 30_000, audio: false });
    const capture = await backend.stop();

    expect(capture.video.frameTiming).toBe(backend.frameTiming);
    expect(capture.video.frameCount).toBe(60);
    expect(capture.video.frameTimestampsMs).toHaveLength(60);
  });

  it("refuses to stop when no capture is in progress", async () => {
    const backend = new MockCapture();
    await expect(backend.stop()).rejects.toThrow(CaptureError);
  });

  it("refuses to start twice", async () => {
    const backend = new MockCapture();
    await backend.start({ maxDurationMs: 30_000, audio: false });
    await expect(backend.start({ maxDurationMs: 30_000, audio: false })).rejects.toThrow(
      /already running/i,
    );
  });

  it("surfaces a forced failure so the UI's error states can be exercised", async () => {
    const backend = new MockCapture({
      failWith: new CaptureError("permission_denied", "Camera permission was denied."),
    });
    await expect(backend.start({ maxDurationMs: 30_000, audio: false })).rejects.toMatchObject({
      code: "permission_denied",
    });
  });

  it("leaves no capture in progress after abort", async () => {
    const backend = new MockCapture();
    await backend.start({ maxDurationMs: 30_000, audio: false });
    backend.abort();
    await expect(backend.stop()).rejects.toThrow(/no capture in progress/i);
  });
});
