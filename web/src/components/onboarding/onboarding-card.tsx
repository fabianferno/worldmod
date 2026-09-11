"use client";

import type { CardComponentProps } from "nextstepjs";

/**
 * The tour card, in the app's own materials: a lifted paper lozenge on the
 * bone world, 30px-family radius, one figure of attention at a time. Skip is
 * always offered (left, quiet); Back appears only once there's somewhere to go
 * back to; the primary control is an ink pill that reads "Next" until the last
 * step, then "Done".
 *
 * `arrow` is NextStep's caret pointing at the highlighted element — rendered
 * inside the card so it inherits the paper background.
 */
export function OnboardingCard({
  step,
  currentStep,
  totalSteps,
  nextStep,
  prevStep,
  skipTour,
  arrow,
}: CardComponentProps) {
  const isLast = currentStep >= totalSteps - 1;
  const isFirst = currentStep <= 0;

  return (
    <div className="relative w-[19rem] max-w-[calc(100vw-2rem)] rounded-panel bg-paper p-5 text-foreground shadow-lift-high">
      {arrow}

      {step.icon ? (
        <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-mint text-mint-ink">
          {step.icon}
        </div>
      ) : null}

      <h2 className="text-[15px] font-semibold leading-snug tracking-[-0.01em]">
        {step.title}
      </h2>
      <div className="mt-1.5 text-sm leading-relaxed text-muted">{step.content}</div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => skipTour?.()}
          className="interactive text-xs font-medium text-subtle"
        >
          Skip
        </button>

        {/* Progress: mint for done/current, sunk for what's ahead. */}
        <div className="flex items-center gap-1.5" aria-hidden>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === currentStep
                  ? "w-4 bg-mint-ink"
                  : i < currentStep
                    ? "w-1.5 bg-mint-ink/50"
                    : "w-1.5 bg-paper-sunk"
              }`}
            />
          ))}
        </div>

        <div className="flex items-center gap-2">
          {!isFirst ? (
            <button
              type="button"
              onClick={prevStep}
              className="interactive text-xs font-medium text-subtle"
            >
              Back
            </button>
          ) : null}
          <button
            type="button"
            onClick={nextStep}
            className="interactive rounded-full bg-ink px-4 py-2 text-xs font-semibold text-on-ink"
          >
            {isLast ? "Done" : "Next"}
          </button>
        </div>
      </div>

      <span className="sr-only">
        Step {currentStep + 1} of {totalSteps}
      </span>
    </div>
  );
}
