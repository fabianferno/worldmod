/**
 * Chromium capture backend.
 *
 * Extends the MediaRecorder path with a MediaStreamTrackProcessor sidecar that
 * yields real per-frame capture timestamps from VideoFrame.timestamp. That is
 * what turns "sync is best-effort" into a measured number instead of an
 * asserted one.
 *
 * VideoFrame.timestamp does NOT share performance.now()'s origin — on Android
 * Chrome it is microseconds since boot. Each frame is therefore tagged with its
 * arrival time and the offset between the two clocks is estimated; see align.ts.
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
import { alignFrames, type FrameObservation } from "../align";
import { MediaRecorderCapture } from "./media-recorder";

interface VideoFrameLike {
  /** Capture time in MICROseconds, on the capture clock — not performance.now's. */
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
  private observations: FrameObservation[] = [];
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
    this.observations = [];

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
        this.observations.push({ tsUs: value.timestamp, arrivalMs: performance.now() });
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

    const aligned = alignFrames(this.observations, this.captureStartMs);

    return {
      frameCount: aligned.frameCount,
      fpsObserved: aligned.fpsObserved,
      frameTimestampsMs: aligned.frameCount > 0 ? aligned.frameTimestampsMs : null,
      measuredSkewMs: aligned.measuredSkewMs,
    };
  }

  override abort(): void {
    this.sidecarTrack?.stop();
    this.reader?.cancel().catch(() => {});
    this.sidecarTrack = null;
    this.reader = null;
    this.observations = [];
    super.abort();
  }
}
