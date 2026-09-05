/**
 * Chromium capture backend.
 *
 * Extends the MediaRecorder path with a MediaStreamTrackProcessor sidecar that
 * yields real per-frame capture timestamps from VideoFrame.timestamp. That is
 * what turns "sync is best-effort" into a measured number instead of an
 * asserted one.
 *
 * Two details are easy to get wrong and expensive when you do:
 *
 *  - Reading a track through a processor CONSUMES its frames, so the track is
 *    cloned and each consumer gets its own copy. Feeding the same track to
 *    both the recorder and the processor starves the recorder.
 *  - Every VideoFrame must be close()d immediately. They hold GPU-backed
 *    buffers from a small pool, and leaking even a few stalls the pipeline
 *    within seconds.
 *
 * See docs/superpowers/specs/2026-08-23-contributor-pwa-design.md §5.1.
 */

import type { FrameTiming } from "@/lib/manifest";
import { MediaRecorderCapture } from "./media-recorder";

interface VideoFrameLike {
  /** Capture time in MICROseconds on the same clock family as performance.now. */
  timestamp: number;
  close(): void;
}

interface TrackProcessorLike {
  readable: ReadableStream<VideoFrameLike>;
}

type TrackProcessorCtor = new (init: { track: MediaStreamTrack }) => TrackProcessorLike;

export function supportsTrackProcessor(scope: object = globalThis): boolean {
  return "MediaStreamTrackProcessor" in scope;
}

export class TrackProcessorCapture extends MediaRecorderCapture {
  private frameTimestampsUs: number[] = [];
  private sidecarTrack: MediaStreamTrack | null = null;
  private reader: ReadableStreamDefaultReader<VideoFrameLike> | null = null;
  private draining: Promise<void> | null = null;

  override get frameTiming(): FrameTiming {
    return "track_processor";
  }

  protected override async onStreamAcquired(stream: MediaStream): Promise<void> {
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    const Ctor = (globalThis as unknown as { MediaStreamTrackProcessor?: TrackProcessorCtor })
      .MediaStreamTrackProcessor;
    if (!Ctor) return;

    // The clone is what the processor consumes; the original stays with the
    // recorder untouched.
    this.sidecarTrack = track.clone();
    this.frameTimestampsUs = [];

    const processor = new Ctor({ track: this.sidecarTrack });
    this.reader = processor.readable.getReader();
    this.draining = this.drain();
  }

  private async drain(): Promise<void> {
    const reader = this.reader;
    if (!reader) return;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.frameTimestampsUs.push(value.timestamp);
        // Close before the next read, always.
        value.close();
      }
    } catch {
      // The track ending mid-read is the normal way this loop terminates.
      // Losing the sidecar degrades timing to unknown; it never fails capture.
    }
  }

  protected override async collectVideoDetail(): Promise<{
    frameCount: number;
    fpsObserved: number | null;
    frameTimestampsMs: number[] | null;
    measuredSkewMs: number | null;
  }> {
    this.sidecarTrack?.stop();
    try {
      await this.reader?.cancel();
    } catch {
      // Already closed.
    }
    await this.draining;

    const us = this.frameTimestampsUs;
    if (us.length === 0) {
      return { frameCount: 0, fpsObserved: null, frameTimestampsMs: null, measuredSkewMs: null };
    }

    const firstUs = us[0];
    const frameTimestampsMs = us.map((t) => (t - firstUs) / 1000);
    const spanMs = frameTimestampsMs[frameTimestampsMs.length - 1];

    return {
      frameCount: us.length,
      fpsObserved: us.length > 1 && spanMs > 0 ? ((us.length - 1) / spanMs) * 1000 : null,
      frameTimestampsMs,
      // Offset between the first captured frame and the IMU clock's origin.
      // This is the measured sync figure that replaces a hardcoded constant.
      measuredSkewMs: firstUs / 1000 - this.captureStartMs,
    };
  }

  override abort(): void {
    this.sidecarTrack?.stop();
    this.reader?.cancel().catch(() => {});
    this.sidecarTrack = null;
    this.reader = null;
    this.frameTimestampsUs = [];
    super.abort();
  }
}
