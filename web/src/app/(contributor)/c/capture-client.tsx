"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  finalizeQuality,
  GUIDE_REGION,
  LiveAnalyzer,
  type Landmark,
  type QualityReport,
} from "@/lib/analysis";
import {
  CaptureError,
  createCaptureBackend,
  encodeImuStream,
  isSecureCaptureContext,
  requestMotionPermission,
  type CaptureBackend,
  type CaptureCapabilities,
  type MotionPermission,
} from "@/lib/capture";
import { buildEpisodeManifest, toSubmission } from "@/lib/episode/build";
import { enqueueEpisode, flushQueue, listPending, uploadEpisode } from "@/lib/episode/queue";
import type { Bounty, StoredEpisode } from "@/lib/market/types";
import { LiveOverlay } from "./overlay";
import { QualityPanel } from "./quality";

/** Episode length. product-spec §3 puts useful episodes at 10–30s. */
const EPISODE_MS = 15_000;

/** Time to get the phone mounted after the one tap the browser requires. */
const COUNTDOWN_MS = 5_000;

const CLIENT_VERSION = "0.1.0";

/**
 * A pseudonymous contributor id, kept on the device.
 *
 * Stands in for the embedded wallet address until that lands. product-spec
 * §11 allows individuals to stay pseudonymous, and no PII goes on-chain.
 */
function entityId(): string {
  const key = "worldmod.entity_id";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    const id = `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    localStorage.setItem(key, id);
    return id;
  } catch {
    // Private mode or blocked storage: a session-scoped id still works.
    return "0x" + "0".repeat(40);
  }
}

type Phase = "idle" | "preparing" | "countdown" | "recording" | "done" | "error";

const noSubscribe = () => () => {};
const secureSnapshot = () => isSecureCaptureContext();
const secureServerSnapshot = () => true;

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
    <div className="border-b border-line py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
        <span
          className={`font-mono text-sm tabular-nums ${warn ? "text-amber-400" : "text-white"}`}
        >
          {value}
        </span>
      </div>
      {note ? <p className="mt-1 text-xs text-subtle">{note}</p> : null}
    </div>
  );
}

export default function CaptureClient() {
  const backendRef = useRef<CaptureBackend | null>(null);
  const analyzerRef = useRef<LiveAnalyzer | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [caps, setCaps] = useState<CaptureCapabilities | null>(null);
  const [motion, setMotion] = useState<MotionPermission | null>(null);
  const [capture, setCapture] = useState<Awaited<ReturnType<CaptureBackend["stop"]>> | null>(null);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [imuBytes, setImuBytes] = useState<number | null>(null);
  const [liveHands, setLiveHands] = useState<Landmark[][]>([]);
  const [remainingMs, setRemainingMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [submitted, setSubmitted] = useState<StoredEpisode | null>(null);
  const [pending, setPending] = useState(0);
  // Off by default. product-spec §3.1 makes location opt-in, and a
  // head-mounted camera plus a position is more sensitive than either alone.
  const [shareLocation, setShareLocation] = useState(false);

  const secure = useSyncExternalStore(noSubscribe, secureSnapshot, secureServerSnapshot);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  const acquireWakeLock = useCallback(async () => {
    try {
      wakeLockRef.current = await navigator.wakeLock?.request("screen");
    } catch {
      // Unsupported or refused; capture still works, the screen may sleep.
    }
  }, []);

  useEffect(() => {
    const backend = createCaptureBackend();
    backendRef.current = backend;
    backend.probe().then(setCaps).catch(() => setCaps(null));

    listPending()
      .then((queued) => setPending(queued.length))
      .catch(() => setPending(0));

    fetch("/api/bounties")
      .then((r) => r.json())
      .then((data: { bounties: Bounty[] }) => {
        const open = data.bounties.filter((b) => b.status === "open");
        setBounties(open);
        setBounty(open[0] ?? null);
      })
      .catch(() => {
        setBounties([]);
        setBounty(null);
      });

    const timers = timersRef.current;
    return () => {
      backend.abort();
      analyzerRef.current?.dispose();
      timers.forEach(clearTimeout);
      wakeLockRef.current?.release().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        (phase === "recording" || phase === "countdown")
      ) {
        void acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [acquireWakeLock, phase]);

  const fail = useCallback((err: unknown) => {
    setError(err instanceof CaptureError || err instanceof Error ? err.message : String(err));
    setPhase("error");
  }, []);

  /** Ends the episode and scores it from what was gathered live. */
  const finish = useCallback(async () => {
    clearTimers();
    const live = analyzerRef.current?.stop() ?? null;

    try {
      const result = await backendRef.current!.stop();
      setCapture(result);
      setImuBytes(encodeImuStream(result.imu.stream).byteLength);

      // Everything was measured during the take; this is pure assembly.
      const report = live
        ? finalizeQuality({
            flow: live.flow,
            hands: live.hands,
            imu: result.imu.stream.samples,
            stats: live.stats,
            preview: live.preview,
            frameHashes: live.frameHashes,
          })
        : null;
      if (report) setQuality(report);
      setPhase("done");

      // Seal and submit. The commitment covers the streams and the scores
      // together, so a contributor cannot report one number here and another
      // to the validator.
      if (bounty) {
        try {
          const manifest = await buildEpisodeManifest({
            capture: result,
            quality: report,
            bountyId: bounty.bounty_id,
            task: bounty.task,
            entityId: entityId(),
            assetId: "asset_phone",
            clientVersion: CLIENT_VERSION,
            uaClass: caps?.uaClass ?? "other",
          });

          const submission = toSubmission(manifest, report);
          const imuBlob = new Blob([encodeImuStream(result.imu.stream) as BlobPart], {
            type: "application/octet-stream",
          });

          // Persisted before any network call: a dropped upload must cost a
          // retry, not a take the wearer has already performed.
          const entry = {
            episode_id: submission.episode_id,
            manifest,
            submission,
            streams: { rgb: result.video.blob, imu: imuBlob },
          };
          await enqueueEpisode(entry);
          setPending((await listPending()).length);

          const outcome = await uploadEpisode({
            ...entry,
            queued_at: Date.now(),
            attempts: 0,
            last_error: null,
          });

          if (outcome.ok) setSubmitted(outcome.episode as StoredEpisode);
          else setError(`${outcome.error ?? "Upload failed."} Saved for retry.`);

          setPending((await listPending()).length);
        } catch (err) {
          // A failed submission must not lose a good recording.
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    } catch (err) {
      fail(err);
    } finally {
      releaseWakeLock();
    }
  }, [bounty, caps, clearTimers, fail, releaseWakeLock]);

  /** Starts the recording itself. Never triggered by a button. */
  const beginRecording = useCallback(async () => {
    try {
      await backendRef.current!.start({
        maxDurationMs: EPISODE_MS,
        audio: true,
        location: shareLocation,
      });
      analyzerRef.current?.start();
      setPhase("recording");
      setRemainingMs(EPISODE_MS);

      const started = performance.now();
      const tick = () => {
        const left = EPISODE_MS - (performance.now() - started);
        setRemainingMs(Math.max(0, left));
        if (left > 0) timersRef.current.push(setTimeout(tick, 100));
      };
      tick();

      // The wearer cannot reach the screen, so the episode ends itself.
      timersRef.current.push(setTimeout(() => void finish(), EPISODE_MS));
    } catch (err) {
      fail(err);
    }
  }, [fail, finish, shareLocation]);

  /**
   * The only tap in the flow. It exists because iOS refuses a motion
   * permission request outside a user gesture — not because someone wearing
   * the phone could press anything afterwards.
   */
  const begin = useCallback(async () => {
    setError(null);
    setQuality(null);
    setCapture(null);
    setSubmitted(null);
    setPhase("preparing");

    try {
      setMotion(await requestMotionPermission());

      const backend = backendRef.current!;
      const stream = await backend.preview({ maxDurationMs: EPISODE_MS, audio: true });
      if (stream && videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCaps(await backend.probe());
      await acquireWakeLock();

      const analyzer = new LiveAnalyzer(videoRef.current!, { onHands: setLiveHands });
      analyzerRef.current = analyzer;
      // Loading the model here keeps it out of the first seconds of the take.
      await analyzer.warmUp();

      setPhase("countdown");
      setRemainingMs(COUNTDOWN_MS);

      const started = performance.now();
      const tick = () => {
        const left = COUNTDOWN_MS - (performance.now() - started);
        setRemainingMs(Math.max(0, left));
        if (left > 0) timersRef.current.push(setTimeout(tick, 100));
      };
      tick();
      timersRef.current.push(setTimeout(() => void beginRecording(), COUNTDOWN_MS));
    } catch (err) {
      fail(err);
    }
  }, [acquireWakeLock, beginRecording, fail]);

  const retry = useCallback(async () => {
    setError(null);
    const { failed } = await flushQueue();
    setPending((await listPending()).length);
    if (failed > 0) setError(`${failed} episode(s) still queued.`);
  }, []);

  const again = useCallback(() => {
    clearTimers();
    analyzerRef.current?.dispose();
    analyzerRef.current = null;
    backendRef.current?.abort();
    backendRef.current = createCaptureBackend();
    setCapture(null);
    setQuality(null);
    setSubmitted(null);
    setLiveHands([]);
    setError(null);
    setPhase("idle");
  }, [clearTimers]);

  const imuRate = capture?.imu.rateHzObserved ?? 0;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background text-foreground">
      <header className="px-5 pb-3 pt-6">
        <h1 className="text-lg font-semibold tracking-tight">Capture check</h1>
        <p className="mt-1 text-sm text-muted">
          Tap once, mount the phone, and it records and scores a {EPISODE_MS / 1000}-second
          episode on its own.
        </p>
      </header>

      {bounty ? (
        <section className="mx-5 mb-4">
          {/* Before recording the wearer chooses the task; afterwards the choice
              is fixed, because the episode was scored against that bounty. */}
          {phase === "idle" && bounties.length > 1 ? (
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
              {bounties.map((option) => (
                <button
                  key={option.bounty_id}
                  onClick={() => setBounty(option)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${
                    option.bounty_id === bounty.bounty_id
                      ? "border-white/40 bg-white/10"
                      : "border-white/15 text-muted"
                  }`}
                >
                  {option.title}
                </button>
              ))}
            </div>
          ) : null}

          <div className="rounded-xl border border-line p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-medium">{bounty.title}</h2>
              <span className="font-mono text-sm tabular-nums text-emerald-400">
                ${bounty.per_episode_usdc.toFixed(2)}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted">{bounty.task_spec}</p>

            {bounty.motion_policy === "require" ? (
              <p className="mt-2 text-xs text-amber-300/80">
                Needs real head movement — a still capture cannot be verified against
                the gyroscope and will be rejected.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {!secure ? (
        <p className="mx-5 mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          Not a secure context. Camera and motion sensors are unavailable — reach this page
          over https, or over localhost.
        </p>
      ) : null}

      <section className="relative mx-5 aspect-[3/4] overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />

        <LiveOverlay hands={liveHands} guide={GUIDE_REGION} showGuide={phase !== "idle"} />

        {phase === "countdown" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/45">
            <span className="font-mono text-6xl font-semibold tabular-nums">
              {Math.ceil(remainingMs / 1000)}
            </span>
            <span className="mt-2 text-sm text-white/70">Mount the phone</span>
          </div>
        ) : null}

        {phase === "recording" ? (
          <div className="interactive absolute left-3 top-3 flex items-center gap-2 rounded-full bg-red-600/90 px-3 py-1">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            <span className="font-mono text-xs tabular-nums">
              {(remainingMs / 1000).toFixed(1)}s
            </span>
          </div>
        ) : null}

        {phase === "recording" && liveHands.length === 0 ? (
          <span className="absolute inset-x-0 bottom-3 text-center text-xs font-medium text-amber-300">
            no hands detected — tilt down
          </span>
        ) : null}
      </section>

      <div className="px-5 py-4">
        {phase === "idle" ? (
          <label className="mb-3 flex items-start gap-2.5 text-sm text-muted">
            <input
              type="checkbox"
              checked={shareLocation}
              onChange={(e) => setShareLocation(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Include a coarse location
              <span className="block text-xs text-subtle">
                Rounded to about 10km before it is recorded. Full precision never leaves
                the phone.
              </span>
            </span>
          </label>
        ) : null}

        {phase === "idle" ? (
          <button
            onClick={begin}
            disabled={!secure}
            className="interactive w-full rounded-xl bg-white px-4 py-3.5 font-semibold text-neutral-950 disabled:opacity-40"
          >
            Start capture
          </button>
        ) : null}

        {phase === "preparing" ? (
          <div className="interactive rounded-xl border border-white/15 px-4 py-3.5 text-center text-sm font-medium">
            Loading tracker…
          </div>
        ) : null}

        {phase === "countdown" || phase === "recording" ? (
          <div className="interactive rounded-xl border border-white/15 px-4 py-3.5 text-center text-sm text-muted">
            {phase === "countdown" ? "Starting automatically" : "Recording — stops on its own"}
          </div>
        ) : null}

        {phase === "done" || phase === "error" ? (
          <button
            onClick={again}
            className="interactive w-full rounded-xl border border-white/20 px-4 py-3.5 font-semibold"
          >
            Record another
          </button>
        ) : null}

        {pending > 0 ? (
          <button
            onClick={retry}
            className="interactive mt-3 w-full rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-200"
          >
            {pending} episode{pending === 1 ? "" : "s"} waiting to upload — retry
          </button>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </p>
        ) : null}
      </div>

      {submitted ? (
        <section className="mx-5 mb-2">
          <div
            className={`rounded-xl border p-4 ${
              submitted.accepted
                ? "border-emerald-500/30 bg-emerald-500/10"
                : "border-red-500/30 bg-red-500/10"
            }`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">
                {submitted.accepted ? "Episode accepted" : "Episode rejected"}
              </span>
              {submitted.accepted ? (
                <span className="font-mono text-lg tabular-nums text-emerald-300">
                  +${submitted.paid_usdc.toFixed(2)}
                </span>
              ) : null}
            </div>

            {submitted.reasons.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm text-red-200/90">
                {submitted.reasons.map((reason) => (
                  <li key={reason}>· {reason}</li>
                ))}
              </ul>
            ) : null}

            <p className="mt-2 truncate font-mono text-[10px] text-subtle">
              {submitted.manifest_hash}
            </p>
          </div>
        </section>
      ) : null}

      {quality ? <QualityPanel report={quality} /> : null}

      <section className="px-5 pb-10">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">
          Device
        </h2>
        <Stat label="Platform" value={caps?.uaClass ?? "—"} />
        <Stat label="Frame timing" value={caps?.frameTiming ?? "—"} />
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
            <h2 className="mb-1 mt-6 text-xs font-semibold uppercase tracking-wide text-subtle">
              Last episode
            </h2>
            <Stat label="Duration" value={`${(capture.durationMs / 1000).toFixed(2)} s`} />
            <Stat label="Resolution" value={`${capture.video.width}×${capture.video.height}`} />
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
              note="Live tracking competes with the encoder; this is where that shows."
            />
            <Stat label="Frames" value={String(capture.video.frameCount)} />
            <Stat
              label="IMU rate"
              value={`${imuRate.toFixed(1)} Hz`}
              warn={imuRate > 0 && imuRate < 40}
            />
            <Stat label="IMU samples" value={String(capture.imu.samples)} />
            <Stat label="Acceleration" value={capture.imu.accelSource} />
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
