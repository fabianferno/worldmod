/**
 * Platform detection.
 *
 * Capability is probed wherever possible; user-agent classification exists
 * only to label the episode (`client.ua_class`) so downstream analysis can
 * segment by platform, never to decide what the client is allowed to do.
 */

import type { FrameTiming, UaClass } from "@/lib/manifest";

export interface PlatformProbe {
  userAgent: string;
  /** iPadOS 13+ reports a desktop UA; touch points are what disambiguate it. */
  maxTouchPoints: number;
}

export function classifyUserAgent({ userAgent, maxTouchPoints }: PlatformProbe): UaClass {
  const ua = userAgent;

  // Every iOS browser is WebKit under the hood, so they share one class.
  const isIosDevice = /iPad|iPhone|iPod/.test(ua);
  const isIpadDesktopUa = /Macintosh/.test(ua) && maxTouchPoints > 1;
  if (isIosDevice || isIpadDesktopUa) return "ios_safari";

  const isChromium = /Chrome|Chromium|CriOS/.test(ua);
  if (/Android/.test(ua)) return isChromium ? "android_chrome" : "other";
  if (isChromium) return "desktop_chrome";

  return "other";
}

/**
 * Whether the platform exposes real per-frame capture timestamps.
 *
 * MediaStreamTrackProcessor is Chromium-only. Where it is missing, timestamps
 * are anchored at MediaRecorder.onstart and per-frame times are recovered from
 * decoded container PTS server-side.
 */
export function detectFrameTiming(scope: object = globalThis): FrameTiming {
  return "MediaStreamTrackProcessor" in scope ? "track_processor" : "recorder_anchored";
}

/**
 * Pick the recording mime type the platform will actually honour.
 *
 * **WebM is preferred over MP4, and the order matters.** Chromium reports
 * video/mp4 as a supported recording type, but what it writes is a fragmented
 * MP4 whose moov declares a duration of roughly zero. Verified on an S24
 * Ultra: a 1MB, 8-second recording reported a sub-0.125s duration, seeking
 * landed nowhere, and playback fired `ended` immediately without presenting a
 * single frame — so on-device analysis got nothing to work with.
 *
 * Chromium's WebM output has none of those problems. Safari cannot record WebM
 * at all, and its MP4 output is well-formed, so MP4 stays in the list below
 * WebM as the path Safari will take.
 *
 * The negotiated result goes into the manifest rather than being assumed, per
 * product-spec §3.1.
 */
export const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4;codecs=avc1",
  "video/mp4",
] as const;

export function negotiateMimeType(
  candidates: readonly string[] = MIME_CANDIDATES,
  isSupported?: (type: string) => boolean,
): string | null {
  const supported =
    isSupported ??
    ((type: string) => {
      const R = (globalThis as { MediaRecorder?: { isTypeSupported?: (t: string) => boolean } })
        .MediaRecorder;
      return typeof R?.isTypeSupported === "function" ? R.isTypeSupported(type) : false;
    });

  return candidates.find((type) => supported(type)) ?? null;
}

/** Horizontal field of view in degrees, where the platform reports it. */
export function fovFromSettings(settings: {
  width?: number;
  height?: number;
  aspectRatio?: number;
}): number | null {
  // getUserMedia exposes no FOV. Nothing derivable from resolution alone gives
  // it either — a 1280x720 ultra-wide and a 1280x720 main camera differ by
  // roughly a factor of two. Reporting null is the honest answer; the framing
  // guide in the UI is the real mitigation.
  void settings;
  return null;
}
