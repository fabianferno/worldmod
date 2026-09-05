/**
 * Frame extraction from a recorded episode.
 *
 * Analysis runs on the recorded blob rather than on the live stream. The
 * device already halves its frame rate under nothing worse than poor lighting;
 * putting inference on the capture path would degrade the very data being
 * scored.
 *
 * Extraction is seek-based rather than WebCodecs: it needs no demuxer, no
 * extra dependency, and behaves the same on both platforms. Frames are
 * downscaled hard — flow and hand landmarks both work fine at a fraction of
 * capture resolution, and the cost is quadratic in edge length.
 */

export interface SampledFrame {
  /** Milliseconds from the start of the recording. */
  t: number;
  image: ImageData;
}

export interface ExtractOptions {
  /** Frames sampled per second of video. */
  targetFps?: number;
  /** Longest edge after downscaling. */
  maxEdge?: number;
  /** Ceiling on total frames, so a long episode cannot stall the device. */
  maxFrames?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

const DEFAULTS = { targetFps: 8, maxEdge: 192, maxFrames: 120 } as const;

/** Some MediaRecorder output reports Infinity until it has been seeked once. */
async function resolveDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;

  return new Promise<number>((resolve) => {
    const settle = () => {
      video.removeEventListener("timeupdate", settle);
      video.currentTime = 0;
      resolve(Number.isFinite(video.duration) ? video.duration : 0);
    };
    video.addEventListener("timeupdate", settle);
    // Seeking past the end forces the duration to be computed.
    video.currentTime = 1e9;
  });
}

function seek(video: HTMLVideoElement, time: number, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", done);
      resolve();
    };
    const timer = setTimeout(() => {
      video.removeEventListener("seeked", done);
      reject(new Error(`Seek to ${time.toFixed(3)}s timed out.`));
    }, timeoutMs);

    video.addEventListener("seeked", done);
    video.currentTime = time;
  });
}

export async function extractFrames(
  blob: Blob,
  options: ExtractOptions = {},
): Promise<SampledFrame[]> {
  const { targetFps, maxEdge, maxFrames, onProgress, signal } = { ...DEFAULTS, ...options };

  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Recorded video could not be decoded."));
    });

    const duration = await resolveDuration(video);
    if (!duration) return [];

    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(2, Math.round(video.videoWidth * scale));
    const height = Math.max(2, Math.round(video.videoHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D canvas context unavailable.");

    const step = 1 / targetFps;
    const count = Math.min(maxFrames, Math.max(0, Math.floor(duration / step)));
    const frames: SampledFrame[] = [];

    for (let i = 0; i < count; i++) {
      if (signal?.aborted) break;

      const time = i * step;
      try {
        await seek(video, time);
      } catch {
        // A seek that never lands ends extraction with what we already have,
        // rather than failing the whole analysis.
        break;
      }

      ctx.drawImage(video, 0, 0, width, height);
      frames.push({ t: time * 1000, image: ctx.getImageData(0, 0, width, height) });
      onProgress?.(i + 1, count);
    }

    return frames;
  } finally {
    video.src = "";
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
