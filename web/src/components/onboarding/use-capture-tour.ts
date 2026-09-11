"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useNextStep } from "nextstepjs";
import { CAPTURE_TOUR } from "@/lib/onboarding/tours";
import { hasOnboarded } from "@/lib/onboarding/storage";

/**
 * Starts the capture tour when it should run, and only then.
 *
 * Two triggers, one path:
 *   - first run: nothing seen yet, so run it automatically;
 *   - replay: the account screen sends the contributor here with ?tour=capture,
 *     which runs it again even after it's been seen.
 *
 * Gated on the idle phase because every anchor (#onb-earned, #onb-rate,
 * #onb-action) only exists on the idle screen — starting mid-recording would
 * highlight nothing. Fires at most once per mount (a ref, not the seen flag,
 * so it can't loop), after a short beat so the idle layout has painted, and
 * strips the query param afterward so a re-render doesn't relaunch it.
 *
 * Reading the param from `window.location` rather than `useSearchParams` keeps
 * this out of the route's prerender/Suspense requirements — it runs only in an
 * effect, which is client-only anyway.
 *
 * The `startedRef` guard is set INSIDE the timeout, not before scheduling it:
 * React Strict Mode (dev) mounts, cleans up, then mounts again on the same
 * instance, so a guard set up front would be tripped by the first run while
 * its cleanup cancelled the timeout — and the second run would then do
 * nothing. Guarding at fire time lets the re-run reschedule, and still fires
 * only once.
 */
export function useCaptureTour(phase: string): void {
  const router = useRouter();
  const { startNextStep, isNextStepVisible } = useNextStep();
  const startedRef = useRef(false);

  useEffect(() => {
    // `isNextStepVisible` lives in the provider (root layout), which outlives
    // this screen — so if a tour is already running, a /c re-mount (dev Fast
    // Refresh, or navigating back mid-tour) must not restart it from step one.
    if (startedRef.current || phase !== "idle" || isNextStepVisible) return;

    let replay = false;
    try {
      replay = new URLSearchParams(window.location.search).get("tour") === CAPTURE_TOUR;
    } catch {
      replay = false;
    }

    if (!replay && hasOnboarded()) return;

    const timer = setTimeout(() => {
      if (startedRef.current || isNextStepVisible) return;
      startedRef.current = true;
      startNextStep(CAPTURE_TOUR);
      if (replay) router.replace("/c");
    }, 500);
    return () => clearTimeout(timer);
  }, [phase, router, startNextStep, isNextStepVisible]);
}
