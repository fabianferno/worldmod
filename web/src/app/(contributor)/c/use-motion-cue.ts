"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Live "are you moving enough" cue.
 *
 * The flow-vs-gyro check needs head rotation to correlate against, and its
 * score tracks how much there was. Measured across real takes of the same
 * task: 12-15 deg/s scored 43-83%, while a 7.4 deg/s take scored 28-33% and
 * was rejected. Nothing was wrong with that recording — there simply was not
 * enough movement for the correlation to mean anything.
 *
 * Telling someone afterwards that their "motion match was 33%" is useless:
 * the take is already performed and the moment is gone. This watches the
 * gyroscope live so the app can ask for more movement while it still helps.
 *
 * Deliberately separate from ImuRecorder, which owns the recorded stream. This
 * is a UI cue and must never influence what is captured.
 */

/** Below this, correlation is too noisy to judge — evidence above. */
export const WEAK_MOTION_DEG_PER_SEC = 10;

interface MotionLike {
  rotationRate?: { alpha: number | null; beta: number | null; gamma: number | null } | null;
}

export function useMotionCue(active: boolean): { rms: number; weak: boolean } {
  // Readiness lives in state, not in the ref: a ref read during render is
  // invisible to React and would not re-render when the cue should appear.
  const [{ rms, ready }, setMotion] = useState({ rms: 0, ready: false });
  const windowRef = useRef<number[]>([]);

  useEffect(() => {
    if (!active) {
      windowRef.current = [];
      // Cleared asynchronously; setting state in the effect body cascades.
      const reset = setTimeout(() => setMotion({ rms: 0, ready: false }), 0);
      return () => clearTimeout(reset);
    }

    const onMotion = (event: Event) => {
      const rate = (event as unknown as MotionLike).rotationRate;
      if (!rate) return;

      const x = rate.beta ?? 0;
      const y = rate.gamma ?? 0;
      const magnitude = Math.sqrt(x * x + y * y);

      // A rolling window, so the cue reacts to the last second or so rather
      // than to the whole take — someone who has stopped moving needs telling
      // now, not averaged against a lively opening.
      const samples = windowRef.current;
      samples.push(magnitude);
      if (samples.length > 60) samples.shift();
    };

    window.addEventListener("devicemotion", onMotion);
    const timer = setInterval(() => {
      const samples = windowRef.current;
      if (samples.length === 0) return;
      const mean = samples.reduce((a, b) => a + b * b, 0) / samples.length;
      // Needs a few samples before it can claim anything about the wearer.
      setMotion({ rms: Math.sqrt(mean), ready: samples.length > 20 });
    }, 400);

    return () => {
      window.removeEventListener("devicemotion", onMotion);
      clearInterval(timer);
    };
  }, [active]);

  return { rms, weak: ready && rms < WEAK_MOTION_DEG_PER_SEC };
}
