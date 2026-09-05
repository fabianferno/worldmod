import { describe, expect, it } from "vitest";
import { classifyUserAgent, detectFrameTiming, negotiateMimeType } from "./detect";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) CriOS/125.0 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const MAC_SAFARI = IPAD_DESKTOP_UA;
const PIXEL_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/125.0.0.0 Mobile Safari/537.36";
const ANDROID_FIREFOX =
  "Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/125.0.0.0 Safari/537.36";

describe("classifyUserAgent", () => {
  it("classifies iPhone Safari", () => {
    expect(classifyUserAgent({ userAgent: IPHONE_SAFARI, maxTouchPoints: 5 })).toBe("ios_safari");
  });

  it("classifies Chrome on iOS as iOS Safari, since it is WebKit underneath", () => {
    // This matters: Chrome on iOS has Safari's capture constraints, not
    // Chromium's, so treating it as Chromium would pick the wrong backend.
    expect(classifyUserAgent({ userAgent: IPHONE_CHROME, maxTouchPoints: 5 })).toBe("ios_safari");
  });

  it("classifies iPadOS despite its desktop user agent", () => {
    expect(classifyUserAgent({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 5 })).toBe("ios_safari");
  });

  it("does not mistake desktop Safari for iPadOS", () => {
    expect(classifyUserAgent({ userAgent: MAC_SAFARI, maxTouchPoints: 0 })).toBe("other");
  });

  it("classifies Android Chrome", () => {
    expect(classifyUserAgent({ userAgent: PIXEL_CHROME, maxTouchPoints: 5 })).toBe("android_chrome");
  });

  it("does not classify Android Firefox as Android Chrome", () => {
    expect(classifyUserAgent({ userAgent: ANDROID_FIREFOX, maxTouchPoints: 5 })).toBe("other");
  });

  it("classifies desktop Chrome", () => {
    expect(classifyUserAgent({ userAgent: MAC_CHROME, maxTouchPoints: 0 })).toBe("desktop_chrome");
  });
});

describe("detectFrameTiming", () => {
  it("reports track_processor where MediaStreamTrackProcessor exists", () => {
    expect(detectFrameTiming({ MediaStreamTrackProcessor: class {} })).toBe("track_processor");
  });

  it("falls back to recorder_anchored where it does not", () => {
    expect(detectFrameTiming({})).toBe("recorder_anchored");
  });
});

describe("negotiateMimeType", () => {
  it("picks MP4 on a Safari-like platform", () => {
    const supported = (t: string) => t.startsWith("video/mp4");
    expect(negotiateMimeType(undefined, supported)).toBe("video/mp4;codecs=avc1");
  });

  it("picks WebM where MP4 recording is unavailable", () => {
    const supported = (t: string) => t.startsWith("video/webm");
    expect(negotiateMimeType(undefined, supported)).toBe("video/webm;codecs=vp9,opus");
  });

  it("returns null when nothing is supported, so the caller can refuse to record", () => {
    expect(negotiateMimeType(undefined, () => false)).toBeNull();
  });

  it("respects candidate order", () => {
    expect(negotiateMimeType(["video/webm", "video/mp4"], () => true)).toBe("video/webm");
  });
});
