"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { analyzeCapture, type AnalysisStage, type QualityReport } from "@/lib/analysis";
import { QualityPanel } from "./quality";
import {
  CaptureError,
  createCaptureBackend,
  isSecureCaptureContext,
  encodeImuStream,
  requestMotionPermission,
  type CaptureBackend,
  type CaptureCapabilities,
  type MotionPermission,
  type RawCapture,
} from "@/lib/capture";

const MAX_DURATION_MS = 30_000;

/** Secure context never changes for a loaded document, so there is nothing to subscribe to. */
const noSubscribe = () => () => {};
const secureSnapshot = () => isSecureCaptureContext();
/** Assume secure while rendering on the server; the client corrects on hydration. */
const secureServerSnapshot = () => true;

type Phase = "idle" | "ready" | "recording" | "analyzing" | "done" | "error";

const STAGE_LABEL: Record<AnalysisStage, string> = {
  extracting: "Reading frames",
  framing: "Finding hands",
  motion: "Matching motion to gyroscope",
  done: "Done",
};

/** Numbers the strap test exists to produce. */
function Stat({
  label,
  value,
  warn,
  note,
}: {
  label: string;
  value: string;
  warn?: boolean;
  note?: string;
}) {
  return (
    <div className="border-b border-white/10 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-white/50">{label}</span>
        <span
          className={`font-mono text-sm tabular-nums ${warn ? "text-amber-400" : "text-white"}`}
        >
          {value}
        </span>
      </div>
      {note ? <p className="mt-1 text-xs text-white/40">{note}</p> : null}
    </div>
  );
}

export default function CaptureClient() {
  const backendRef = useRef<CaptureBackend | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [caps, setCaps] = useState<CaptureCapabilities | null>(null);
  const [motion, setMotion] = useState<MotionPermission | null>(null);
  const [capture, setCapture] = useState<RawCapture | null>(null);
  const [imuBytes, setImuBytes] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [progress, setProgress] = useState<{ stage: AnalysisStage; done: number; total: number } | null>(
    null,
  );
  const secure = useSyncExternalStore(noSubscribe, secureSnapshot, secureServerSnapshot);

  useEffect(() => {
    const backend = createCaptureBackend();
    backendRef.current = backend;
    backend.probe().then(setCaps).catch(() => setCaps(null));

    return () => {
      backend.abort();
      wakeLockRef.current?.release().catch(() => {});
    };
  }, []);

  // Wake Lock, re-acquired on visibility change — a strapped-on phone that
  // sleeps mid-episode is the most common way a take is lost.
  const acquireWakeLock = useCallback(async () => {
    try {
      wakeLockRef.current = await navigator.wakeLock?.request("screen");
    } catch {
      // Unsupported or refused; capture still works, the screen may just sleep.
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        (phase === "recording" || phase === "analyzing")
      ) {
        void acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [acquireWakeLock, phase]);

  useEffect(() => {
    if (phase !== "recording") return;
    const started = performance.now();
    const id = setInterval(() => setElapsedMs(performance.now() - started), 100);
    return () => clearInterval(id);
  }, [phase]);

  const fail = useCallback((err: unknown) => {
    const message =
      err instanceof CaptureError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    setError(message);
    setPhase("error");
  }, []);

  /** Must be a real tap: iOS rejects the motion request outside a user gesture. */
  const enable = useCallback(async () => {
    setError(null);
    try {
      const permission = await requestMotionPermission();
      setMotion(permission);

      const backend = backendRef.current!;
      const stream = await backend.preview({ maxDurationMs: MAX_DURATION_MS, audio: true });
      if (stream && videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      setCaps(await backend.probe());
      await acquireWakeLock();
      setPhase("ready");
    } catch (err) {
      fail(err);
    }
  }, [acquireWakeLock, fail]);

  const record = useCallback(async () => {
    setError(null);
    setCapture(null);
    setImuBytes(null);
    try {
      await backendRef.current!.start({ maxDurationMs: MAX_DURATION_MS, audio: true });
      setPhase("recording");
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  const finish = useCallback(async () => {
    let result: RawCapture;
    try {
      result = await backendRef.current!.stop();
      setCapture(result);
      setImuBytes(encodeImuStream(result.imu.stream).byteLength);
      setPhase("analyzing");
    } catch (err) {
      fail(err);
      releaseWakeLock();
      return;
    }

    // Scoring runs on the recorded blob, never during capture — the device
    // already sheds frame rate under load, and analysing live would degrade
    // the data being scored.
    try {
      setQuality(
        await analyzeCapture(result, {
          onProgress: (stage, done, total) => setProgress({ stage, done, total }),
        }),
      );
    } catch (err) {
      // A failed analysis must not discard a good recording.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
      setPhase("done");
      releaseWakeLock();
    }
  }, [fail, releaseWakeLock]);

  const again = useCallback(() => {
    setCapture(null);
    setQuality(null);
    setError(null);
    backendRef.current = createCaptureBackend();
    setPhase("idle");
  }, []);

  const imuRate = capture?.imu.rateHzObserved ?? 0;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-neutral-950 text-white">
      <header className="px-5 pb-3 pt-6">
        <h1 className="text-lg font-semibold tracking-tight">Capture check</h1>
        <p className="mt-1 text-sm text-white/50">
          Strap the phone on, frame a cup pick-and-place, and read what the device
          actually delivered.
        </p>
      </header>

      {!secure ? (
        <p className="mx-5 mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          Not a secure context. Camera and motion sensors are unavailable — reach
          this page over https, not a bare LAN IP.
        </p>
      ) : null}

      <section className="relative mx-5 aspect-[3/4] overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full object-cover"
        />

        {/* Framing guide. The real mitigation for a phone's narrow field of
            view is telling the wearer where their hands have to stay. */}
        {phase === "ready" || phase === "recording" ? (
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-x-[12%] bottom-[8%] top-[38%] rounded-lg border-2 border-dashed border-emerald-400/70" />
            <span className="absolute inset-x-0 bottom-[3%] text-center text-xs font-medium text-emerald-300">
              keep hands and object inside this box
            </span>
          </div>
        ) : null}

        {phase === "recording" ? (
          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-red-600/90 px-3 py-1">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            <span className="font-mono text-xs tabular-nums">
              {(elapsedMs / 1000).toFixed(1)}s
            </span>
          </div>
        ) : null}
      </section>

      <div className="px-5 py-4">
        {phase === "idle" ? (
          <button
            onClick={enable}
            disabled={!secure}
            className="w-full rounded-xl bg-white px-4 py-3.5 font-semibold text-neutral-950 disabled:opacity-40"
          >
            Enable camera and motion
          </button>
        ) : null}

        {phase === "ready" ? (
          <button
            onClick={record}
            className="w-full rounded-xl bg-red-600 px-4 py-3.5 font-semibold"
          >
            Record episode
          </button>
        ) : null}

        {phase === "recording" ? (
          <button
            onClick={finish}
            className="w-full rounded-xl border border-white/20 px-4 py-3.5 font-semibold"
          >
            Stop
          </button>
        ) : null}

        {phase === "analyzing" ? (
          <div className="rounded-xl border border-white/15 px-4 py-3.5 text-center">
            <span className="text-sm font-medium">
              {progress ? STAGE_LABEL[progress.stage] : "Analysing"}
            </span>
            {progress && progress.total > 1 ? (
              <span className="ml-2 font-mono text-xs tabular-nums text-white/50">
                {progress.done}/{progress.total}
              </span>
            ) : null}
          </div>
        ) : null}

        {phase === "done" || phase === "error" ? (
          <button
            onClick={again}
            className="w-full rounded-xl border border-white/20 px-4 py-3.5 font-semibold"
          >
            Record another
          </button>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </p>
        ) : null}
      </div>

      {quality ? <QualityPanel report={quality} /> : null}

      <section className="px-5 pb-10">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/40">
          Device
        </h2>
        <Stat label="Platform" value={caps?.uaClass ?? "—"} />
        <Stat
          label="Frame timing"
          value={caps?.frameTiming ?? "—"}
          note={
            caps?.frameTiming === "recorder_anchored"
              ? "No per-frame capture times on this platform; observed fps is derived server-side."
              : undefined
          }
        />
        <Stat label="Recording format" value={caps?.mimeType ?? "unsupported"} />
        <Stat label="Motion permission" value={motion ?? "not requested"} />
        <Stat
          label="Cameras"
          value={caps ? String(caps.videoDevices.length) : "—"}
          note={
            caps && !caps.canSelectLens
              ? "Lens selection unavailable — cannot opt into a wider field of view."
              : undefined
          }
        />

        {capture ? (
          <>
            <h2 className="mb-1 mt-6 text-xs font-semibold uppercase tracking-wide text-white/40">
              Last episode
            </h2>
            <Stat label="Duration" value={`${(capture.durationMs / 1000).toFixed(2)} s`} />
            <Stat
              label="Resolution"
              value={`${capture.video.width}×${capture.video.height}`}
            />
            <Stat label="Lens" value={capture.video.deviceLabel ?? "unknown"} />
            <Stat label="fps nominal" value={capture.video.fpsNominal.toFixed(1)} />
            <Stat
              label="fps observed"
              value={
                capture.video.fpsObserved === null
                  ? "unknown"
                  : capture.video.fpsObserved.toFixed(2)
              }
              warn={
                capture.video.fpsObserved !== null &&
                capture.video.fpsObserved < capture.video.fpsNominal * 0.8
              }
              note={
                capture.video.fpsObserved === null
                  ? "Safari cannot report this at capture time."
                  : undefined
              }
            />
            <Stat label="Frames" value={String(capture.video.frameCount)} />
            <Stat
              label="IMU rate"
              value={`${imuRate.toFixed(1)} Hz`}
              warn={imuRate > 0 && imuRate < 40}
              note={
                imuRate > 0 && imuRate < 40
                  ? "Well below the ~60Hz ceiling — check Low Power Mode."
                  : undefined
              }
            />
            <Stat label="IMU samples" value={String(capture.imu.samples)} />
            <Stat
              label="Acceleration"
              value={capture.imu.accelSource}
              warn={capture.imu.accelSource === "absent"}
            />
            <Stat label="Orientation" value={capture.imu.screenOrientation} />
            <Stat
              label="Measured skew"
              value={
                capture.measuredSkewMs === null
                  ? "unknown"
                  : `${capture.measuredSkewMs.toFixed(1)} ms`
              }
            />
            <Stat
              label="Video size"
              value={`${(capture.video.blob.size / 1_000_000).toFixed(2)} MB`}
            />
            <Stat
              label="IMU stream size"
              value={imuBytes === null ? "—" : `${(imuBytes / 1000).toFixed(1)} kB`}
            />
          </>
        ) : null}
      </section>
    </main>
  );
}
