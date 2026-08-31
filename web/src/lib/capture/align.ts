/**
 * Frame/IMU clock alignment.
 *
 * VideoFrame.timestamp is NOT on performance.now()'s origin. On Android Chrome
 * it reads as microseconds since boot, so subtracting one from the other
 * yields the device's uptime rather than a sync figure — measured on an S24
 * Ultra as 8,659,680 ms of "skew".
 *
 * The two clocks are related by an unknown constant offset, so we estimate it.
 * Each frame is tagged with performance.now() at the moment it is read, giving
 * pairs of (capture-clock timestamp, arrival time). For every pair:
 *
 *     arrival = frameTs + offset + latency_i        (latency_i >= 0)
 *
 * Latency is additive and non-negative, so the MINIMUM of (arrival - frameTs)
 * is the tightest available estimate of the true offset — the frame that
 * happened to reach JS fastest. Using the mean or median would bake average
 * pipeline latency into every timestamp instead.
 *
 * The estimate still carries the minimum observed latency as bias, so the
 * resulting skew is an upper bound, not an exact figure. That is a real limit
 * of doing this from a browser and is reported rather than hidden.
 */

/** One frame as observed by the sidecar reader. */
export interface FrameObservation {
  /** VideoFrame.timestamp, microseconds on the capture clock. */
  tsUs: number;
  /** performance.now() when the frame was read. */
  arrivalMs: number;
}

export interface FrameAlignment {
  /** Frames that fall inside the recording window. */
  frameCount: number;
  /** Frame times in milliseconds from recording start, sharing the IMU origin. */
  frameTimestampsMs: number[];
  fpsObserved: number | null;
  /**
   * Offset between recording start and the first frame captured after it.
   * Upper bound: includes minimum pipeline latency.
   */
  measuredSkewMs: number | null;
  /** Estimated capture-clock to performance.now offset, milliseconds. */
  clockOffsetMs: number | null;
  /** Frames captured before recording began, excluded from the counts above. */
  preRollFrames: number;
}

export function alignFrames(
  observations: readonly FrameObservation[],
  captureStartMs: number,
): FrameAlignment {
  if (observations.length === 0) {
    return {
      frameCount: 0,
      frameTimestampsMs: [],
      fpsObserved: null,
      measuredSkewMs: null,
      clockOffsetMs: null,
      preRollFrames: 0,
    };
  }

  let clockOffsetMs = Infinity;
  for (const { tsUs, arrivalMs } of observations) {
    const delta = arrivalMs - tsUs / 1000;
    if (delta < clockOffsetMs) clockOffsetMs = delta;
  }

  // Map every frame into the recording's own timeline, which is also the IMU's.
  const relative = observations.map(({ tsUs }) => tsUs / 1000 + clockOffsetMs - captureStartMs);

  // The sidecar taps the track before the recorder starts, so early frames are
  // not in the encoded video and must not inflate the frame count.
  const withinRecording = relative.filter((t) => t >= 0);
  const preRollFrames = relative.length - withinRecording.length;

  if (withinRecording.length === 0) {
    return {
      frameCount: 0,
      frameTimestampsMs: [],
      fpsObserved: null,
      measuredSkewMs: null,
      clockOffsetMs,
      preRollFrames,
    };
  }

  const span = withinRecording[withinRecording.length - 1] - withinRecording[0];

  return {
    frameCount: withinRecording.length,
    frameTimestampsMs: withinRecording,
    fpsObserved:
      withinRecording.length > 1 && span > 0
        ? ((withinRecording.length - 1) / span) * 1000
        : null,
    measuredSkewMs: withinRecording[0],
    clockOffsetMs,
    preRollFrames,
  };
}
