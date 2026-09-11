import type { Tour } from "nextstepjs";

/**
 * The one onboarding tour: the capture screen's earn loop.
 *
 * Every anchor lives on /c's idle state, so the tour is robust — no
 * cross-route navigation, and it only auto-runs while /c is idle (see
 * use-capture-tour). `selectorRetryAttempts` covers the beat where the idle
 * layout is still mounting when the tour starts.
 *
 * Step 3 points at the whole action zone rather than the "Start recording"
 * button specifically: on a first run the contributor usually isn't verified
 * yet, so that slot holds the Selfie-Check gate instead of the button. The
 * zone is always there; the button may not be.
 *
 * `showControls`/`showSkip` are intentionally absent — with a custom card
 * (OnboardingCard) those built-in-card flags do nothing; the card owns Skip
 * and Next/Back itself.
 */
export const CAPTURE_TOUR = "capture";

export const TOURS: Tour[] = [
  {
    tour: CAPTURE_TOUR,
    steps: [
      {
        icon: null,
        title: "This is what you've earned",
        content:
          "Accepted episodes pay out in USDC and add up here. Tap it any time to open your account and withdraw.",
        selector: "#onb-earned",
        side: "bottom",
        pointerRadius: 12,
        pointerPadding: 8,
        selectorRetryAttempts: 5,
      },
      {
        icon: null,
        title: "What this take pays",
        content:
          "Each open bounty quotes a rate. This is what you'll be paid for one accepted 15-second episode of this task.",
        selector: "#onb-rate",
        side: "bottom",
        pointerRadius: 999,
        pointerPadding: 6,
        selectorRetryAttempts: 5,
      },
      {
        icon: null,
        title: "Record a real task",
        content:
          "Strap your phone on and record about 15 seconds. It's scored on your device before upload — nothing is recorded until you start.",
        selector: "#onb-action",
        side: "top",
        pointerRadius: 20,
        pointerPadding: 8,
        selectorRetryAttempts: 5,
      },
      {
        icon: null,
        title: "Your account lives here",
        content:
          "Sign in to keep earnings reachable from another phone, run the one-time Selfie Check, and see everything you've recorded.",
        selector: "#onb-account",
        side: "top",
        pointerRadius: 16,
        pointerPadding: 6,
        selectorRetryAttempts: 5,
      },
    ],
  },
];
