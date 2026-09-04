"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  GUIDE_REGION,
  LiveAnalyzer,
  type Landmark,
  type OverlayStats,
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
import { anchorEpisode } from "@/lib/chain/anchor-client";
import { deviceAddress } from "@/lib/chain/identity";
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

type Phase =
  | "idle"
  | "preparing"
  | "countdown"
  | "recording"
  // Bytes on their way; the wearer can put the phone down.
  | "uploading"
  // Uploaded and being scored on the server, which takes about a minute.
  | "scoring"
  | "done"
  | "error";

const noSubscribe = () => () => {};
const secureSnapshot = () => isSecureCaptureContext();
const secureServerSnapshot = () => true;

/**
 * The episode this device is waiting on a verdict for.
 *
 * Scoring takes about a minute, and a phone does not reliably stay on one page
 * for a minute — the screen locks, a notification steals focus, the browser
 * reclaims a backgrounded tab. The first real episode through this path was
 * scored correctly on the server and never shown, because the page reloaded
 * and the poll it depended on died with the component.
 *
 * The id outlives the page so the next mount can go and collect the result.
 */
const AWAITING_KEY = "worldmod.awaiting_verdict";

function rememberAwaiting(episodeId: string, startedAt: number): void {
  try {
    localStorage.setItem(AWAITING_KEY, JSON.stringify({ episodeId, startedAt }));
  } catch {
    // Private mode or a full quota: the in-page poll still works, and a
    // reload simply loses the verdict as it did before.
  }
}

function readAwaiting(): { episodeId: string; startedAt: number } | null {
  try {
    const raw = localStorage.getItem(AWAITING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { episodeId?: unknown; startedAt?: unknown };
    if (typeof parsed.episodeId !== "string" || typeof parsed.startedAt !== "number") return null;
    return { episodeId: parsed.episodeId, startedAt: parsed.startedAt };
  } catch {
    return null;
  }
}

function forgetAwaiting(): void {
  try {
    localStorage.removeItem(AWAITING_KEY);
  } catch {
    // Nothing to do; a stale key is cleared on the next successful write.
  }
}

/**
 * The contributor's address, from a key this device actually holds.
 *
 * This used to be twenty random bytes formatted to look like an address. It
 * read as an account and could never be one — nobody held the key, so nothing
 * could be signed with it and every relayed call would have failed signature
 * recovery. product-spec §11's contributor path is built on the phone signing.
 */
function entityId(): string {
  try {
    return deviceAddress();
  } catch {
    // Storage refused. Capture still works and still pays into the local
    // marketplace; only the on-chain commitment is unavailable.
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
  const [liveHands, setLiveHands] = useState<Landmark[][]>([]);
  const [remainingMs, setRemainingMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [submitted, setSubmitted] = useState<StoredEpisode | null>(null);
  const [overlay, setOverlay] = useState<OverlayStats | null>(null);
  const [pending, setPending] = useState(0);
  const [earned, setEarned] = useState(0);
  const [shareLocation, setShareLocation] = useState(false);

  const secure = useSyncExternalStore(noSubscribe, secureSnapshot, secureServerSnapshot);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    // Emptied in place rather than reassigned: the unmount cleanup captures
    // this array once, and swapping it for a new one leaves that cleanup
    // holding a reference to timers nobody will ever cancel.
    timersRef.current.length = 0;
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

  /**
   * Commit the episode's manifest hash on-chain.
   *
   * Deliberately after the verdict is already on screen and never awaited by
   * it. product-spec §6.1's claim is about what the chain proves once the hash
   * is there; putting an RPC between a contributor and their result would trade
   * the thing that works for the thing that might.
   */
  const anchor = useCallback(async (episode: StoredEpisode) => {
    if (episode.status !== "scored" || episode.anchor) return;

    const storage = episode.streams?.find((s) => s.kind === "rgb")?.uri ?? "";
    try {
      const result = await anchorEpisode(
        episode.episode_id,
        episode.manifest_hash,
        episode.bounty_id,
        storage,
      );
      if (result) setSubmitted((current) => (current ? { ...current, anchor: result } : current));
    } catch {
      // Anchoring is additive. The episode stands without it.
    }
  }, []);

  /**
   * Watch for the server's verdict.
   *
   * Scoring decodes every sampled frame, detects hands across the take and
   * solves flow between pairs — over a minute of work, so the upload does not
   * wait on it and this polls instead.
   */
  const watchScoring = useCallback(
    (episodeId: string, startedAt: number, resumed = false) => {
      // Anchored to the upload, not to this call: resuming after a reload
      // must not hand the episode another five minutes.
      const deadline = startedAt + 5 * 60_000;

      const poll = async () => {
        try {
          const response = await fetch(`/api/episodes/${episodeId}`);
          const data = (await response.json()) as { episode?: StoredEpisode };

          if (data.episode && data.episode.status !== "scoring") {
            forgetAwaiting();
            setSubmitted(data.episode);
            setPhase("done");
            refreshEarnings();
            void anchor(data.episode);
            return;
          }
        } catch {
          // Keep waiting; a dropped poll is not a failed episode.
        }

        if (Date.now() < deadline) {
          timersRef.current.push(setTimeout(() => void poll(), 3000));
        } else {
          forgetAwaiting();
          setError("Still scoring. It will appear on the bounty page when it finishes.");
          setPhase("done");
        }
      };

      // A resumed watch asks straight away — the verdict is often already
      // waiting, and making someone stare at a spinner for a result the server
      // finished minutes ago is the bug this whole path exists to avoid.
      timersRef.current.push(setTimeout(() => void poll(), resumed ? 0 : 2000));
    },
    [refreshEarnings, anchor],
  );

  /**
   * Collect a verdict this device is still owed.
   *
   * Runs once on mount, after watchScoring exists. The page may have reloaded,
   * been backgrounded and reclaimed, or been closed outright while the server
   * was scoring — none of which should cost the wearer a result they earned.
   */
  useEffect(() => {
    const awaiting = readAwaiting();
    if (!awaiting) return;

    if (Date.now() - awaiting.startedAt > 5 * 60_000) {
      // Older than the watch would ever have waited. It is not lost — it is on
      // the bounty page — but this screen should not sit on a stale spinner.
      forgetAwaiting();
      return;
    }

    // Deferred a tick rather than set synchronously: this is a subscription to
    // state held outside React, and nothing races it — the capture flow starts
    // on a tap, never on its own.
    const timer = setTimeout(() => {
      setPhase("scoring");
      watchScoring(awaiting.episodeId, awaiting.startedAt, true);
    }, 0);
    timersRef.current.push(timer);

    return () => clearTimeout(timer);
  }, [watchScoring]);

  const fail = useCallback((err: unknown) => {
    setError(err instanceof CaptureError || err instanceof Error ? err.message : String(err));
    setPhase("error");
  }, []);

  const finish = useCallback(async () => {
    clearTimers();
    setOverlay(analyzerRef.current?.stop() ?? null);

    try {
      const result = await backendRef.current!.stop();
      setCapture(result);
      setPhase("uploading");

      if (!bounty) return;

      const manifest = await buildEpisodeManifest({
        capture: result,
        bountyId: bounty.bounty_id,
        task: bounty.task,
        entityId: entityId(),
        assetId: "asset_phone",
        clientVersion: CLIENT_VERSION,
        uaClass: caps?.uaClass ?? "other",
      });

      const submission = toSubmission(manifest);
      const imuBlob = new Blob([encodeImuStream(result.imu.stream) as BlobPart], {
        type: "application/octet-stream",
      });
      const entry = {
        episode_id: submission.episode_id,
        manifest,
        submission,
        streams: { rgb: result.video.blob, imu: imuBlob },
      };

      // Saved before the network is involved: a dropped upload costs a retry,
      // never a take that has already been performed.
      await enqueueEpisode(entry);
      setPending((await listPending()).length);

      const outcome = await uploadEpisode({
        ...entry,
        queued_at: Date.now(),
        attempts: 0,
        last_error: null,
      });
      setPending((await listPending()).length);

      if (!outcome.ok) {
        setError(`${outcome.error ?? "Upload failed."} Saved — it will retry.`);
        setPhase("done");
        return;
      }

      setSubmitted(outcome.episode as StoredEpisode);
      setPhase("scoring");
      rememberAwaiting(submission.episode_id, Date.now());
      watchScoring(submission.episode_id, Date.now());
    } catch (err) {
      fail(err);
    } finally {
      releaseWakeLock();
    }
  }, [bounty, caps, clearTimers, fail, releaseWakeLock, watchScoring]);

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
    forgetAwaiting();
    analyzerRef.current?.dispose();
    analyzerRef.current = null;
    backendRef.current?.abort();
    backendRef.current = createCaptureBackend();
    setCapture(null);
    setSubmitted(null);
    setOverlay(null);
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

        {phase === "uploading" || phase === "scoring" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 p-6 text-center backdrop-blur">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-accent" />
            <p className="text-base font-medium">
              {phase === "uploading" ? "Sending your episode" : "Scoring on the server"}
            </p>
            <p className="max-w-xs text-sm leading-relaxed text-muted">
              {phase === "uploading"
                ? "Saved on your phone already — this can retry if it drops."
                : "Every frame is being checked, which takes about a minute. You can put the phone down."}
            </p>
          </div>
        ) : null}

        {phase === "done" || phase === "error" ? (
          <div className="absolute inset-0 overflow-y-auto bg-background/97 p-5 backdrop-blur">
            <Result submitted={submitted} error={error} onAgain={again} />
            {capture ? (
              <Details
                capture={capture}
                caps={caps}
                motion={motion}
                overlay={overlay}
                submitted={submitted}
              />
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

        {phase === "uploading" || phase === "scoring" ? (
          <p className="py-4 text-center text-sm text-subtle">
            {phase === "uploading" ? "Uploading" : "Waiting for the validator"}
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
