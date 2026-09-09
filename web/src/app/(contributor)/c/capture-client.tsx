"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  GUIDE_REGION,
  LiveAnalyzer,
  type Landmark,
  type OverlayStats,
} from "@/lib/analysis";
import { LivePredictor, type LivePrediction } from "@/lib/analysis/live-predictor";
import {
  CaptureError,
  createCaptureBackend,
  encodeImuStream,
  isSecureCaptureContext,
  requestMotionPermission,
  type CaptureBackend,
  type CaptureCapabilities,
  type MotionPermission,
  type RawCapture,
} from "@/lib/capture";
import { anchorEpisode } from "@/lib/chain/anchor-client";
import { useSigner } from "@/lib/chain/signer-context";
import { AccountBar } from "./account";
import { buildEpisodeManifest, toSubmission, type SelfReport } from "@/lib/episode/build";
import { enqueueEpisode, flushQueue, listPending, uploadEpisode } from "@/lib/episode/queue";
import type { Bounty, StoredEpisode } from "@/lib/market/types";
import { Details } from "./details";
import { LiveOverlay } from "./overlay";
import { PredictionPanel } from "./prediction-panel";
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
  // Stopped, and asking the contributor the one thing only they know.
  | "reviewing"
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

/**
 * An episode that has a verdict but is not yet on-chain.
 *
 * Anchoring is four transactions on a first submission and takes half a minute
 * or more; a page reload part-way through used to lose it, leaving an episode
 * scored and paid locally with no on-chain record — which is exactly what
 * happened to the second real take.
 *
 * Only written, never read: recovery asks the server which episodes are still
 * unanchored, because a note in storage cannot describe an episode recorded
 * before the note existed. The flag remains as the record of an attempt in
 * flight, and is cleared once the chain has it.
 */
const UNANCHORED_KEY = "worldmod.unanchored";

function rememberUnanchored(episodeId: string): void {
  try {
    localStorage.setItem(UNANCHORED_KEY, episodeId);
  } catch {
    // Anchoring still runs in this page; it just will not survive a reload.
  }
}

function forgetUnanchored(): void {
  try {
    localStorage.removeItem(UNANCHORED_KEY);
  } catch {
    // A stale key is harmless: anchoring is idempotent server-side.
  }
}

function forgetAwaiting(): void {
  try {
    localStorage.removeItem(AWAITING_KEY);
  } catch {
    // Nothing to do; a stale key is cleared on the next successful write.
  }
}

export default function CaptureClient() {
  const backendRef = useRef<CaptureBackend | null>(null);
  const analyzerRef = useRef<LiveAnalyzer | null>(null);
  const predictorRef = useRef<LivePredictor | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [caps, setCaps] = useState<CaptureCapabilities | null>(null);
  const [motion, setMotion] = useState<MotionPermission | null>(null);
  const [capture, setCapture] = useState<Awaited<ReturnType<CaptureBackend["stop"]>> | null>(null);
  const [liveHands, setLiveHands] = useState<Landmark[][]>([]);
  const [livePrediction, setLivePrediction] = useState<LivePrediction | null>(null);
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

  /**
   * The identity this episode is attributed to — the World App wallet where
   * someone has connected, the device key otherwise. Both sign; only one
   * survives a lost phone.
   */
  const signer = useSigner();
  // Null until the client mounts. Every caller runs from an event handler or a
  // post-verdict effect, by which point it is set.
  const entityId = useCallback(
    () => (signer ? (signer.address as string) : `0x${"0".repeat(40)}`),
    [signer],
  );

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
  }, [entityId]);

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
      predictorRef.current?.dispose();
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
    if (!signer) return;

    // Recorded before the first transaction, cleared only once the chain has
    // it. A reload half way through no longer abandons the episode.
    rememberUnanchored(episode.episode_id);

    // The content address in preference to the file path: what goes on-chain
    // should be resolvable by whoever reads it, and `file:///Users/...` is a
    // commitment to a location only this machine has.
    const rgb = episode.streams?.find((s) => s.kind === "rgb");
    const storage = rgb?.cid
      ? `${window.location.origin}/ipfs/${rgb.cid}`
      : (rgb?.uri ?? "");
    try {
      const result = await anchorEpisode(
        episode.episode_id,
        episode.manifest_hash,
        episode.bounty_id,
        storage,
        signer,
      );
      if (result?.onchain_episode_id) forgetUnanchored();
      if (result) setSubmitted((current) => (current ? { ...current, anchor: result } : current));
    } catch {
      // Anchoring is additive. The episode stands without it, and the id stays
      // in storage so the next mount can try again.
    }
  }, [signer]);

  /**
   * Finish anchoring anything a previous page gave up on.
   *
   * Asks the server which of this contributor's episodes are scored and still
   * have no on-chain record, rather than trusting a note left in storage. The
   * note is a hint; the server is the answer — and an episode recorded before
   * that note existed, or on a page that never got to write it, is exactly the
   * one that needs recovering.
   *
   * Re-anchoring one already committed is refused server-side, so a stale
   * entry costs a request rather than a duplicate episode.
   */
  useEffect(() => {
    if (!signer) return;
    const me = signer.address.toLowerCase();

    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/episodes");
        const data = (await response.json()) as { episodes: StoredEpisode[] };

        const stranded = data.episodes.filter(
          (e) =>
            e.entity_id.toLowerCase() === me &&
            e.status === "scored" &&
            !e.anchor?.onchain_episode_id,
        );

        if (stranded.length === 0) {
          forgetUnanchored();
          return;
        }

        // Oldest first, and one at a time: each needs its own nonce, and the
        // next signature is only valid once the previous transaction lands.
        for (const episode of stranded.sort((a, b) => a.recorded_at - b.recorded_at)) {
          await anchor(episode);
        }
      } catch {
        // Try again next mount.
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [signer, anchor]);

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

  /**
   * Stop, then ask the one question the device cannot answer.
   *
   * §5's manifest carries `outcome` and `self_report`, and they are inside the
   * signed commitment — so the answer has to exist before the manifest is
   * sealed, which is why this sits between the take and the upload rather than
   * next to the result. It is one tap, and skipping it records "unknown"
   * rather than inventing a success.
   */
  const finish = useCallback(async () => {
    clearTimers();
    setOverlay(analyzerRef.current?.stop() ?? null);
    predictorRef.current?.stop();
    releaseWakeLock();

    try {
      const result = await backendRef.current!.stop();
      setCapture(result);
      setPhase("reviewing");
    } catch (err) {
      fail(err);
    }
  }, [clearTimers, fail, releaseWakeLock]);

  const submitEpisode = useCallback(
    async (result: RawCapture, selfReport: SelfReport | undefined) => {
    setPhase("uploading");

    try {
      if (!bounty) return;

      const manifest = await buildEpisodeManifest({
        capture: result,
        selfReport,
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
        streams: {
          rgb: result.video.blob,
          imu: imuBlob,
          // Uploaded only when the device produced one; the manifest declares
          // an audio stream on exactly the same condition.
          ...(result.audio ? { audio: result.audio.blob } : {}),
        },
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
    }
    },
    [bounty, caps, entityId, fail, watchScoring],
  );

  const beginRecording = useCallback(async () => {
    try {
      await backendRef.current!.start({
        maxDurationMs: EPISODE_MS,
        audio: true,
        location: shareLocation,
      });
      analyzerRef.current?.start();
      predictorRef.current?.start();
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

      // A random per-take key for the server's in-memory session — not the
      // episode id, which does not exist yet at this point in the flow (it is
      // minted when the manifest is built, after recording stops). Purely a
      // scratch handle the live prediction endpoint uses to carry the GRU's
      // hidden state and frame bank between requests.
      const predictor = new LivePredictor(videoRef.current!, crypto.randomUUID(), {
        onPrediction: setLivePrediction,
        onUnavailable: () => setLivePrediction(null),
      });
      predictorRef.current = predictor;

      await Promise.all([analyzer.warmUp(), predictor.warmUp()]);

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
    predictorRef.current?.dispose();
    predictorRef.current = null;
    setLivePrediction(null);
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
    <main className="relative flex flex-1 flex-col overflow-hidden px-4 pt-3">
      {/*
        Money leads. Someone opened this to earn, and the two figures that
        decide whether they bother — what they have, and what this take adds —
        face each other across the top before anything else loads.
      */}
      <header className="settle settle-1 flex items-start justify-between gap-3 pb-3">
        <Link
          href="/c/account"
          className="interactive -m-1.5 block rounded-inner p-1.5"
          aria-label="Your account and earnings"
        >
          <p className="tag">Earned</p>
          <p className="figure mt-1 text-[34px]">
            ${earned.toFixed(2).split(".")[0]}
            <span className="cents">.{earned.toFixed(2).split(".")[1]}</span>
          </p>
        </Link>

        {bounty ? (
          <div className="rounded-full bg-mint px-4 py-2.5 text-right">
            <p className="text-[11px] font-medium leading-none text-mint-ink">
              This take pays
            </p>
            <p className="figure mt-1.5 text-[19px] text-mint-ink">
              ${bounty.per_episode_usdc.toFixed(2)}
              <span className="unit">USDC</span>
            </p>
          </div>
        ) : null}
      </header>

      {!secure ? (
        <p className="mb-3 rounded-card bg-butter px-4 py-3 text-sm leading-relaxed text-butter-ink">
          Camera and motion need a secure connection. Open this over https.
        </p>
      ) : null}

      {/*
        The viewfinder is the ink card of this world, not a video element with
        a border around it. Everything the take needs to say is said inside it.
      */}
      <section className="relative flex-1 overflow-hidden rounded-panel bg-ink shadow-lift settle settle-2">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        <LiveOverlay hands={liveHands} guide={GUIDE_REGION} showGuide={live} />
        {phase === "recording" ? <PredictionPanel prediction={livePrediction} /> : null}

        {phase === "idle" ? (
          <div className="on-ink absolute inset-x-0 top-0 flex flex-col items-center gap-3 px-8 pt-[28%] text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/8 text-on-ink-muted">
              <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7" aria-hidden>
                <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </span>
            <p className="text-sm leading-relaxed text-on-ink-muted">
              Your camera opens when you start. Nothing is recorded until then.
            </p>
          </div>
        ) : null}

        {phase === "idle" && bounty ? (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink/80 to-transparent px-5 pb-5 pt-24">
            <h1 className="text-[19px] font-semibold text-on-ink">{bounty.title}</h1>
            <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-on-ink-muted">
              {bounty.task_spec}
            </p>
          </div>
        ) : null}

        {phase === "preparing" ? (
          <div className="on-ink absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/75">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-mint" />
            <p className="text-sm text-on-ink-muted">Getting the tracker ready</p>
          </div>
        ) : null}

        {phase === "countdown" ? (
          <div className="on-ink absolute inset-0 flex flex-col items-center justify-center bg-ink/60">
            <p className="tag text-on-ink-muted">Starting in</p>
            <p className="figure mt-2 text-[76px] text-on-ink">{seconds}</p>
            <p className="mt-3 text-sm text-on-ink-muted">Get the phone on</p>
          </div>
        ) : null}

        {phase === "recording" ? (
          <>
            {/* The take's clock, quoted the way every other figure here is. */}
            <div className="absolute left-4 top-4 flex items-center gap-2.5 rounded-full bg-paper/95 py-2 pl-3 pr-4 backdrop-blur">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-negative" />
              <span className="figure text-[17px] text-foreground">
                {seconds}
                <span className="unit">sec left</span>
              </span>
            </div>
            {liveHands.length === 0 ? (
              <p className="absolute inset-x-4 bottom-5 mx-auto w-fit rounded-full bg-butter px-4 py-2.5 text-center text-sm font-medium text-butter-ink">
                Tilt down — hands out of view
              </p>
            ) : weakMotion ? (
              <p className="absolute inset-x-4 bottom-5 mx-auto w-fit rounded-full bg-butter px-4 py-2.5 text-center text-sm font-medium text-butter-ink">
                Move around more — look where you are going
              </p>
            ) : null}
          </>
        ) : null}

        {phase === "reviewing" && capture ? (
          <div className="on-ink absolute inset-0 flex flex-col justify-end bg-ink/95 p-5 backdrop-blur">
            <div className="mx-auto w-full max-w-md">
              <p className="text-center text-lg font-semibold text-on-ink">
                Did you finish the task?
              </p>
              <p className="mx-auto mt-2 max-w-xs text-center text-sm leading-relaxed text-on-ink-muted">
                Only you know this, so we ask rather than assume. Either answer is
                worth uploading — a failed attempt is still data.
              </p>

              <div className="mt-7 grid grid-cols-2 gap-3">
                <button
                  onClick={() => void submitEpisode(capture, { taskCompleted: false, notes: "" })}
                  className="interactive rounded-full border-2 border-white/45 py-4 text-base font-semibold text-on-ink"
                >
                  No
                </button>
                <button
                  onClick={() => void submitEpisode(capture, { taskCompleted: true, notes: "" })}
                  className="interactive rounded-full bg-mint py-4 text-base font-semibold text-mint-ink"
                >
                  Yes
                </button>
              </div>

              <button
                onClick={() => void submitEpisode(capture, undefined)}
                className="interactive mt-3 w-full rounded-full py-3 text-sm text-on-ink-muted"
              >
                Skip — record it as unknown
              </button>
            </div>
          </div>
        ) : null}

        {phase === "uploading" || phase === "scoring" ? (
          <div className="on-ink absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/95 p-6 text-center backdrop-blur">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-lilac" />
            <p className="text-base font-semibold text-on-ink">
              {phase === "uploading" ? "Sending your episode" : "Scoring on the server"}
            </p>
            <p className="max-w-xs text-sm leading-relaxed text-on-ink-muted">
              {phase === "uploading"
                ? "Saved on your phone already — this can retry if it drops."
                : "Every frame is being checked, which takes about a minute. You can put the phone down."}
            </p>
          </div>
        ) : null}

        {/* The verdict leaves the ink card and returns to the bone ground:
            the take is over, and this is the ledger talking, not the camera. */}
        {phase === "done" || phase === "error" ? (
          <div className="absolute inset-0 overflow-y-auto bg-bone px-4 pb-4">
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

      {/* Primary action sits in the thumb zone, above the dock. */}
      <div className="settle settle-3 pb-3 pt-3">
        {phase === "idle" ? (
          <>
            {bounties.length > 1 ? (
              <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
                {bounties.map((option) => (
                  <button
                    key={option.bounty_id}
                    onClick={() => setBounty(option)}
                    aria-pressed={option.bounty_id === bounty?.bounty_id}
                    className={`interactive shrink-0 rounded-full px-4 py-2.5 text-sm font-semibold ${
                      option.bounty_id === bounty?.bounty_id
                        ? "bg-lilac text-lilac-ink"
                        : "bg-paper text-muted"
                    }`}
                  >
                    {option.title}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mb-3">
              <AccountBar />
            </div>

            {/* Held until the identity is settled. Recording first and
                resolving the signer afterwards is how three takes from one
                Google account ended up on three different addresses. */}
            <button
              onClick={begin}
              disabled={!secure || !signer}
              className="interactive on-ink flex w-full items-center gap-3 rounded-full bg-ink p-1.5 text-on-ink disabled:opacity-40"
            >
              <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-mint text-mint-ink">
                <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
                  <circle cx="12" cy="12" r="6.5" fill="currentColor" />
                </svg>
              </span>
              <span className="flex-1 pr-[52px] text-center text-base font-semibold">
                {signer ? `Start recording · ${EPISODE_MS / 1000}s` : "Getting your account…"}
              </span>
            </button>

            {signer ? (
              <p className="mt-2.5 text-center text-xs text-subtle">
                Paid to{" "}
                <span className="tabular font-mono">
                  {signer.address.slice(0, 6)}…{signer.address.slice(-4)}
                </span>
                {signer.recoverable ? "" : " · this phone only"}
              </p>
            ) : null}

            <label
              className={`interactive mt-2.5 flex cursor-pointer items-center justify-center gap-2.5 rounded-full py-2.5 text-xs font-medium ${
                shareLocation ? "bg-lilac text-lilac-ink" : "text-subtle"
              }`}
            >
              <input
                type="checkbox"
                checked={shareLocation}
                onChange={(e) => setShareLocation(e.target.checked)}
                className="sr-only"
              />
              <span
                aria-hidden
                className={`flex h-[18px] w-[18px] items-center justify-center rounded-full ${
                  shareLocation ? "bg-lilac-ink text-lilac" : "bg-paper-sunk"
                }`}
              >
                {shareLocation ? (
                  <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3">
                    <path
                      d="M5.5 12.5l4 4 9-9"
                      stroke="currentColor"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : null}
              </span>
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
            className="interactive mt-3 w-full rounded-full bg-butter py-3.5 text-sm font-semibold text-butter-ink"
          >
            {pending} waiting to upload — retry
          </button>
        ) : null}
      </div>
    </main>
  );
}
