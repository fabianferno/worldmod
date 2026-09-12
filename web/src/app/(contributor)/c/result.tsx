"use client";

import { useCallback, useEffect, useState } from "react";
import { ChainlinkMark } from "@/components/chainlink-mark";
import { explorerTx } from "@/lib/chain/config";
import { pendingWithdrawal, withdrawEarnings } from "@/lib/chain/withdraw-client";
import type { StoredEpisode } from "@/lib/market/types";
import { PredictionStrip } from "./prediction-strip";

/**
 * Collecting real USDC.
 *
 * §14 scene 4 ends with the money landing in the contributor's wallet, and the
 * transaction that moves it is signed by them — the escrow credits a balance
 * and the holder pulls it, so nobody else can redirect the payment. The relayer
 * only supplies the gas that makes the call possible.
 */
function Withdraw() {
  const [balance, setBalance] = useState(0);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    pendingWithdrawal()
      .then(setBalance)
      .catch(() => setBalance(0));
  }, []);

  useEffect(refresh, [refresh]);

  const collect = useCallback(async () => {
    setState("sending");
    setError(null);
    const result = await withdrawEarnings();
    if (result.ok) {
      setHash(result.hash ?? null);
      setState("done");
      refresh();
    } else {
      setError(result.error ?? "Could not withdraw.");
      setState("idle");
    }
  }, [refresh]);

  if (state === "done") {
    return (
      <div className="mt-4 rounded-card bg-mint px-4 py-4 text-center">
        <p className="text-sm font-semibold text-mint-ink">USDC is in your wallet</p>
        {hash ? (
          <a
            href={explorerTx(hash)}
            target="_blank"
            rel="noreferrer"
            className="interactive tabular mt-1 inline-block font-mono text-xs text-mint-ink underline decoration-dotted underline-offset-2"
          >
            {hash.slice(0, 14)}…
          </a>
        ) : null}
      </div>
    );
  }

  if (balance <= 0) return null;

  return (
    <div className="mt-4">
      <button
        onClick={() => void collect()}
        disabled={state === "sending"}
        className="interactive flex w-full items-center gap-3 rounded-full bg-mint p-1.5 text-mint-ink disabled:opacity-60"
      >
        <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-ink text-on-ink">
          <DownIcon />
        </span>
        <span className="flex-1 pr-[52px] text-center text-base font-semibold">
          {state === "sending" ? "Collecting…" : `Withdraw $${balance.toFixed(2)}`}
        </span>
      </button>
      {error ? <p className="mt-2 text-xs leading-relaxed text-caution">{error}</p> : null}
      <p className="mt-2 text-center text-xs text-subtle">
        Signed by your device, not by us. Gas is covered.
      </p>
    </div>
  );
}

function DownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
      <path
        d="M12 4.75v11.5m0 0l4.25-4.25M12 16.25L7.75 12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5 19.25h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * What the contributor sees when a take ends.
 *
 * Every number here came back from the server. The phone drew a skeleton while
 * recording and nothing more, so there is no local score to show and none to
 * contradict the one that decides payment.
 */

function Meter({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  const known = typeof value === "number";
  const pct = known ? Math.round(value * 100) : null;
  const tone = !known
    ? "bg-paper-sunk"
    : value >= 0.7
      ? "bg-mint-ink"
      : value >= 0.4
        ? "bg-butter-ink"
        : "bg-negative";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="figure text-[15px] text-muted">
          {pct === null ? "—" : `${pct}%`}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-paper-sunk">
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: known ? `${Math.max(4, value * 100)}%` : "100%" }}
        />
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-subtle">{hint}</p>
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
      {/*
        The verdict is the one thing on this screen, and it gets the treatment
        the amount deserves: an accepted take is quoted on mint, everything
        else on paper. No badge, no icon — the figure is the news.
      */}
      <div
        className={`settle settle-1 mt-5 rounded-panel px-5 py-7 text-center ${
          paid ? "bg-mint" : "bg-paper shadow-lift"
        }`}
      >
        {paid ? (
          <>
            <p className="text-[11px] font-medium text-mint-ink">Episode accepted</p>
            <p className="figure mt-2.5 text-[52px] text-mint-ink">
              +${submitted!.paid_usdc.toFixed(2)}
              <span className="unit">USDC</span>
            </p>
            <p className="mt-3 text-sm leading-relaxed text-mint-ink">
              Your recording met the bar for this task.
            </p>
          </>
        ) : submitted?.status === "failed" ? (
          <>
            <p className="text-lg font-semibold">Could not be scored</p>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">
              Something went wrong on our side, not yours. Your recording is saved.
            </p>
          </>
        ) : submitted ? (
          <>
            <p className="text-lg font-semibold">Not accepted</p>
            {/* One clear reason beats a list of measurements. */}
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">
              {submitted.reasons[0] ?? "This one did not meet the task's bar."}
            </p>
            {submitted.reasons.length > 1 ? (
              <p className="mt-1.5 text-xs text-subtle">
                and {submitted.reasons.length - 1} more
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-lg font-semibold">Saved on your phone</p>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">
              {error ?? "It will upload when you are back online. Nothing is lost."}
            </p>
          </>
        )}
      </div>

      {submitted && submitted.status === "scored" ? (
        <div className="settle settle-2 mt-3 space-y-5 rounded-panel bg-paper px-5 py-5 shadow-lift">
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

      {/* How the verdict was reached: the bar itself is secret, so the check
          runs in a Chainlink CRE enclave and the result is what lands on-chain.
          Lilac is this world's compute/model colour. No tx link — the DON's
          report is written separately from the anchor txs listed below, so
          pointing at one of those would misname it. */}
      {submitted?.status === "scored" ? (
        <div className="settle settle-2 mt-3 rounded-card bg-lilac px-5 py-4 text-lilac-ink">
          <div className="flex items-center gap-2">
            <ChainlinkMark className="h-4 w-4 shrink-0" />
            <span className="text-sm font-semibold">Confidentially validated · Chainlink CRE</span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-lilac-ink/80">
            Whether this met the bar was decided against the bounty&rsquo;s private threshold inside a
            Chainlink CRE enclave — the threshold is never exposed — and the verdict is written
            on-chain by a DON-signed report.
          </p>
        </div>
      ) : null}

      {submitted ? <PredictionStrip episodeId={submitted.episode_id} /> : null}

      {submitted?.payment?.tx ? (
        <div className="on-ink settle settle-3 mt-3 rounded-card bg-ink px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold text-on-ink">Paid on-chain</span>
            <a
              href={explorerTx(submitted.payment.tx)}
              target="_blank"
              rel="noreferrer"
              className="interactive tabular font-mono text-xs text-on-ink-muted underline decoration-dotted underline-offset-2 hover:text-on-ink"
            >
              {submitted.payment.tx.slice(0, 10)}…
            </a>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-on-ink-muted">
            Real USDC, credited to your key. Collect it whenever you like.
          </p>
        </div>
      ) : submitted?.payment?.error ? (
        <p className="mt-3 rounded-card bg-butter px-5 py-4 text-xs leading-relaxed text-butter-ink">
          Accepted, but the on-chain release did not go through: {submitted.payment.error}
        </p>
      ) : null}

      <Withdraw />

      {submitted?.anchor?.txs?.length ? (
        <div className="on-ink mt-3 rounded-card bg-ink px-5 py-4">
          <p className="text-sm font-semibold text-on-ink">On the chain</p>
          <p className="mt-1.5 text-xs leading-relaxed text-on-ink-muted">
            Your phone signed it; the relayer paid the gas. The episode is attributed
            to your key, not to whoever paid.
          </p>
          <ul className="mt-3 space-y-2">
            {submitted.anchor.txs.map((tx) => (
              <li key={tx.hash} className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-on-ink-muted">{tx.step}</span>
                <a
                  href={explorerTx(tx.hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="interactive tabular font-mono text-xs text-on-ink-muted underline decoration-dotted underline-offset-2 hover:text-on-ink"
                >
                  {tx.hash.slice(0, 10)}…
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {paid ? null : (
        <p className="mt-3 rounded-card bg-paper px-5 py-4 text-sm leading-relaxed text-muted shadow-lift">
          Nothing was charged to you. Most rejections are a framing problem — watch the
          skeleton while you record and keep your hands inside the box.
        </p>
      )}

      <button
        onClick={onAgain}
        className="interactive mt-4 w-full rounded-full bg-ink py-4 text-base font-semibold text-on-ink"
      >
        Record another
      </button>
    </div>
  );
}
