"use client";

/**
 * Wraps the app in NextStep so any screen can start a tour, and remembers once
 * a tour is finished or skipped so it stops auto-running.
 *
 * Sits inside MiniKitClientProvider in the root layout and wraps both the main
 * content and the Nav, because the capture tour's last step points at the
 * Account tab inside the dock. NextStep's default navigation adapter is the
 * Next.js App Router one, so no adapter is passed.
 *
 * The overlay ground is tinted to the app's ink (#0d0d0f) rather than pure
 * black, and the caret to bone, so the spotlight reads as part of this world.
 */

import { NextStep, NextStepProvider } from "nextstepjs";
import { TOURS } from "@/lib/onboarding/tours";
import { markOnboarded } from "@/lib/onboarding/storage";
import { OnboardingCard } from "./onboarding-card";

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextStepProvider>
      <NextStep
        steps={TOURS}
        cardComponent={OnboardingCard}
        shadowRgb="13, 13, 15"
        shadowOpacity="0.6"
        arrowStyle={{ fill: "#f6f6f4" }}
        // Whether finished or skipped, don't auto-run again on this device.
        onComplete={() => markOnboarded()}
        onSkip={() => markOnboarded()}
      >
        {children}
      </NextStep>
    </NextStepProvider>
  );
}
