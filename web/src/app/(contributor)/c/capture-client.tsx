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
import { Details } from "./details";
import { LiveOverlay } from "./overlay";
import { Result } from "./result";
import { useMotionCue } from "./use-motion-cue";

const EPISODE_MS = 15_000;
const COUNTDOWN_MS = 5_000;
const CLIENT_VERSION = "0.1.0";

type Phase = "idle" | "preparing" | "countdown" | "recording" | "done" | "error";

const noSubscribe = () => () => {};
const secureSnapshot = () => isSecureCaptureContext();
const secureServerSnapshot = () => true;

/** Pseudonymous, device-held. Stands in for the embedded wallet address. */
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
    return `0x${"0".repeat(40)}`;
  }
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
  const [liveHands, setLiveHands] = useState<Landmark[][]>([]);
  const [remainingMs, setRemainingMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [submitted, setSubmitted] = useState<StoredEpisode | null>(null);
  const [pending, setPending] = useState(0);
  const [earned, setEarned] = useState(0);
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
      // Unsupported or refused; capture works, the screen may just sleep.
    }
  }, []);

  /** Everything this device has been paid, across bounties. */
  const readEarnings = useCallback(async (): Promise<number> => {
    const me = entityId();
    const response = await fetch("/api/episodes");
    const data = (await response.json()) as { episodes: StoredEpisode[] };
    return data.episodes
      .filter((e) => e.entity_id === me && e.accepted)
      .reduce((sum, e) => sum + e.paid_usdc, 0);
  }, []);

  const refreshEarnings = useCallback(() => {
    // Informational; failing to read a balance must never block a capture.
    readEarnings()
      .then(setEarned)
      .catch(() => {});
  }, [readEarnings]);

  useEffect(() => {
    const backend = createCaptureBackend();
    backendRef.current = backend;
    backend.probe().then(setCaps).catch(() => setCaps(null));

    listPending()
      .then((q) => setPending(q.length))
      .catch(() => setPending(0));
    refreshEarnings();

    fetch("/api/bounties")
      .then((r) => r.json())
      .then((data: { bounties: Bounty[] }) => {
        const open = data.bounties.filter((b) => b.status === "open");
        setBounties(open);
        setBounty(open[0] ?? null);
      })
      .catch(() => setBounties([]));

    const timers = timersRef.current;
    return () => {
      backend.abort();
      analyzerRef.current?.dispose();
      timers.forEach(clearTimeout);
      wakeLockRef.current?.release().catch(() => {});
    };
  }, [refreshEarnings]);

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

  const finish = useCallback(async () => {
    clearTimers();
    const live = analyzerRef.current?.stop() ?? null;

    try {
      const result = await backendRef.current!.stop();
      setCapture(result);

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
          const entry = {
            episode_id: submission.episode_id,
            manifest,
            submission,
            streams: { rgb: result.video.blob, imu: imuBlob },
          };

          // Saved before the network is involved: a dropped upload costs a
          // retry, never a take that has already been performed.
          await enqueueEpisode(entry);
          setPending((await listPending()).length);

          const outcome = await uploadEpisode({
            ...entry,
            queued_at: Date.now(),
            attempts: 0,
            last_error: null,
          });

          if (outcome.ok) {
            setSubmitted(outcome.episode as StoredEpisode);
            refreshEarnings();
          } else {
            setError(`${outcome.error ?? "Upload failed."} Saved — it will retry.`);
          }
          setPending((await listPending()).length);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    } catch (err) {
      fail(err);
    } finally {
      releaseWakeLock();
    }
  }, [bounty, caps, clearTimers, fail, refreshEarnings, releaseWakeLock]);

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
      timersRef.current.push(setTimeout(() => void finish(), EPISODE_MS));
    } catch (err) {
      fail(err);
    }
  }, [fail, finish, shareLocation]);

  /** The only tap in the flow — iOS refuses motion permission without a gesture. */
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

  const retry = useCallback(async () => {
    setError(null);
    await flushQueue();
    setPending((await listPending()).length);
    refreshEarnings();
  }, [refreshEarnings]);

  // Only meaningful for bounties that require motion evidence.
  const { weak: weakMotion } = useMotionCue(
    phase === "recording" && bounty?.motion_policy === "require",
  );

  const live = phase === "countdown" || phase === "recording";
  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <main className="relative flex flex-1 flex-col">
      {/* Balance leads. This is an earning app, not an instrument. */}
      <header className="flex items-center justify-between px-5 pt-4">
        <div>
          <p className="text-xs text-subtle">Earned</p>
          <p className="tabular text-2xl font-semibold tracking-tight">${earned.toFixed(2)}</p>
        </div>

        {bounty ? (
          <div className="text-right">
            <p className="text-xs text-subtle">This task pays</p>
            <p className="tabular text-2xl font-semibold tracking-tight text-positive">
              ${bounty.per_episode_usdc.toFixed(2)}
            </p>
          </div>
        ) : null}
      </header>

      {!secure ? (
        <p className="mx-5 mt-4 rounded-2xl border border-caution/25 bg-caution/10 p-3 text-sm text-caution">
          Camera and motion need a secure connection. Open this over https.
        </p>
      ) : null}

      {/* The viewfinder is the screen, not a card sitting on a page. */}
      <section className="relative mt-4 flex-1 overflow-hidden bg-black">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        <LiveOverlay hands={liveHands} guide={GUIDE_REGION} showGuide={live} />

        {phase === "idle" && bounty ? (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-5 pt-20">
            <h1 className="text-xl font-semibold">{bounty.title}</h1>
            <p className="mt-1 max-w-prose text-sm leading-relaxed text-white/70">
              {bounty.task_spec}
            </p>
          </div>
        ) : null}

        {phase === "preparing" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
            <p className="text-sm text-white/70">Getting the tracker ready</p>
          </div>
        ) : null}

        {phase === "countdown" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55">
            <span className="tabular text-7xl font-semibold">{seconds}</span>
            <p className="mt-2 text-sm text-white/75">Get the phone on</p>
          </div>
        ) : null}

        {phase === "recording" ? (
          <>
            <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 backdrop-blur">
              <span className="h-2 w-2 animate-pulse rounded-full bg-negative" />
              <span className="tabular font-mono text-sm">{seconds}s</span>
            </div>
            {liveHands.length === 0 ? (
              <p className="absolute inset-x-0 bottom-5 text-center text-sm font-medium text-caution">
                Tilt down — hands out of view
              </p>
            ) : weakMotion ? (
              <p className="absolute inset-x-0 bottom-5 text-center text-sm font-medium text-caution">
                Move around more — look where you are going
              </p>
            ) : null}
          </>
        ) : null}

        {phase === "done" || phase === "error" ? (
          <div className="absolute inset-0 overflow-y-auto bg-background/97 p-5 backdrop-blur">
            <Result submitted={submitted} quality={quality} error={error} onAgain={again} />
            {capture ? (
              <Details capture={capture} caps={caps} motion={motion} quality={quality} />
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Primary action sits in the thumb zone, above the tab bar. */}
      <div className="px-5 pb-4 pt-4">
        {phase === "idle" ? (
          <>
            {bounties.length > 1 ? (
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                {bounties.map((option) => (
                  <button
                    key={option.bounty_id}
                    onClick={() => setBounty(option)}
                    className={`interactive shrink-0 rounded-full border px-3.5 py-2 text-sm font-medium ${
                      option.bounty_id === bounty?.bounty_id
                        ? "border-white/35 bg-white/10"
                        : "border-line text-muted"
                    }`}
                  >
                    {option.title}
                  </button>
                ))}
              </div>
            ) : null}

            <button
              onClick={begin}
              disabled={!secure}
              className="interactive w-full rounded-2xl bg-foreground py-4 text-base font-semibold text-background disabled:opacity-40"
            >
              Start · {EPISODE_MS / 1000}s
            </button>

            <label className="mt-3 flex items-center justify-center gap-2 text-xs text-subtle">
              <input
                type="checkbox"
                checked={shareLocation}
                onChange={(e) => setShareLocation(e.target.checked)}
              />
              Include a coarse location, rounded to ~10km
            </label>
          </>
        ) : null}

        {live || phase === "preparing" ? (
          <p className="py-4 text-center text-sm text-subtle">
            {phase === "recording" ? "Stops on its own" : "Starting automatically"}
          </p>
        ) : null}

        {pending > 0 ? (
          <button
            onClick={retry}
            className="interactive mt-3 w-full rounded-2xl border border-caution/40 bg-caution/10 py-3 text-sm font-medium text-caution"
          >
            {pending} waiting to upload — retry
          </button>
        ) : null}
      </div>
    </main>
  );
}
