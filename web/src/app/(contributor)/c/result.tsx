"use client";

import { explorerTx } from "@/lib/chain/config";
import type { StoredEpisode } from "@/lib/market/types";

/**
 * What the contributor sees when a take ends.
 *
 * Every number here came back from the server. The phone drew a skeleton while
 * recording and nothing more, so there is no local score to show and none to
 * contradict the one that decides payment.
 */

function Meter({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  const known = typeof value === "number";
  const tone = !known
    ? "bg-white/20"
    : value >= 0.7
      ? "bg-positive"
      : value >= 0.4
        ? "bg-caution"
        : "bg-negative";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm">{label}</span>
        <span className="tabular font-mono text-sm text-muted">
          {known ? `${Math.round(value * 100)}%` : "—"}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: known ? `${Math.max(3, value * 100)}%` : "100%" }}
        />
      </div>
      <p className="mt-1 text-xs leading-relaxed text-subtle">{hint}</p>
    </div>
  );
}

export function Result({
  submitted,
  error,
  onAgain,
}: {
  submitted: StoredEpisode | null;
  error: string | null;
  onAgain: () => void;
}) {
  const paid = submitted?.accepted === true;
  const motionRms = submitted?.validation?.checks.flow_gyro_corr;
  const visible = submitted?.hands_visible_percent ?? null;

  return (
    <div className="mx-auto w-full max-w-md pb-4">
      <div className="pt-6 text-center">
        {paid ? (
          <>
            <p className="tabular text-5xl font-semibold tracking-tight text-positive">
              +${submitted!.paid_usdc.toFixed(2)}
            </p>
            <p className="mt-2 text-base font-medium">Episode accepted</p>
            <p className="mt-1 text-sm text-muted">Your recording met the bar for this task.</p>
          </>
        ) : submitted?.status === "failed" ? (
          <>
            <p className="text-base font-medium">Could not be scored</p>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">
              Something went wrong on our side, not yours. Your recording is saved.
            </p>
          </>
        ) : submitted ? (
          <>
            <p className="text-base font-medium">Not accepted</p>
            {/* One clear reason beats a list of measurements. */}
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">
              {submitted.reasons[0] ?? "This one did not meet the task's bar."}
            </p>
            {submitted.reasons.length > 1 ? (
              <p className="mt-1 text-xs text-subtle">and {submitted.reasons.length - 1} more</p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-base font-medium">Saved on your phone</p>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">
              {error ?? "It will upload when you are back online. Nothing is lost."}
            </p>
          </>
        )}
      </div>

      {submitted && submitted.status === "scored" ? (
        <div className="mt-7 space-y-5">
          <Meter
            label="Hands in view"
            value={submitted.framing}
            hint={
              visible === 0
                ? "The camera never saw your hands. Tilt the phone down."
                : "How much of the take had your hands where the task needs them."
            }
          />
          <Meter
            label="Motion check"
            value={submitted.plausibility}
            hint={
              submitted.plausibility === null
                ? "You barely moved your head, so there was nothing to check against."
                : typeof motionRms === "number" && motionRms < 0.4
                  ? "Walking and looking around scores far higher than standing still."
                  : "Whether what the camera saw matches how the phone moved."
            }
          />
        </div>
      ) : null}

      {submitted?.anchor?.txs?.length ? (
        <div className="mt-6 rounded-2xl border border-line bg-surface p-4">
          <p className="text-sm font-medium">On the chain</p>
          <p className="mt-1 text-xs leading-relaxed text-subtle">
            Your phone signed it; the relayer paid the gas. The episode is attributed
            to your key, not to whoever paid.
          </p>
          <ul className="mt-3 space-y-1.5">
            {submitted.anchor.txs.map((tx) => (
              <li key={tx.hash} className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-muted">{tx.step}</span>
                <a
                  href={explorerTx(tx.hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="interactive tabular font-mono text-xs text-accent underline decoration-dotted"
                >
                  {tx.hash.slice(0, 10)}…
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {paid ? null : (
        <p className="mt-5 rounded-2xl border border-line bg-surface p-4 text-sm leading-relaxed text-muted">
          Nothing was charged to you. Most rejections are a framing problem — watch the
          skeleton while you record and keep your hands inside the box.
        </p>
      )}

      <button
        onClick={onAgain}
        className="interactive mt-6 w-full rounded-2xl bg-foreground py-4 text-base font-semibold text-background"
      >
        Record another
      </button>
    </div>
  );
}
