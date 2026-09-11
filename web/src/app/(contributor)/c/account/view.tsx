"use client";

/**
 * What a contributor has done, what it scored, and what they are owed.
 *
 * Deliberately readable by someone who has just taken a phone off their head:
 * the balance first, then the takes, then the identity. Reputation is shown
 * with its own caveat rather than as a bare number — §12 says compute and
 * display it, and does not gate on it, so presenting it as a verdict would
 * overstate what it is.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { explorerAddress, explorerTx } from "@/lib/chain/config";
import { useSigner } from "@/lib/chain/signer-context";
import { pendingWithdrawal, withdrawEarnings } from "@/lib/chain/withdraw-client";
import { reputationFor, type Reputation } from "@/lib/market/reputation";
import type { StoredEpisode } from "@/lib/market/types";
import { Identity } from "./identity";
import { SelfieCheck } from "./selfie-check";

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
      <path
        d="M14 6.5L8.5 12l5.5 5.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card bg-paper px-4 py-3.5 shadow-lift">
      <p className="tag">{label}</p>
      <p className="figure mt-1.5 text-[24px]">{value}</p>
      {hint ? <p className="mt-1 text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

/**
 * One take, as a line in a ledger.
 *
 * Ink for the ones that paid, paper for the ones that did not: a contributor
 * scanning this list is counting money, and the takes that made some should be
 * the ones that carry weight.
 */
function Episode({ episode }: { episode: StoredEpisode }) {
  const paid = episode.accepted;
  const when = new Date(episode.recorded_at * 1000);

  return (
    <li
      className={
        paid
          ? "on-ink rounded-card bg-ink px-4 py-3.5"
          : "rounded-card bg-paper px-4 py-3.5 shadow-lift"
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className={`text-sm font-semibold ${paid ? "text-on-ink" : ""}`}>
          {when.toLocaleDateString(undefined, { month: "short", day: "numeric" })}{" "}
          <span className={paid ? "font-medium text-on-ink-muted" : "font-medium text-subtle"}>
            {when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </span>
        </span>
        <span
          className={`figure shrink-0 text-[19px] ${paid ? "text-mint" : "text-subtle"}`}
        >
          {paid ? `+$${episode.paid_usdc.toFixed(2)}` : "—"}
        </span>
      </div>

      <div
        className={`mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${
          paid ? "text-on-ink-muted" : "text-subtle"
        }`}
      >
        <span className="tabular">{episode.duration_s.toFixed(1)}s</span>
        <span aria-hidden>·</span>
        <span className="tabular">
          hands {episode.framing === null ? "—" : `${Math.round(episode.framing * 100)}%`}
        </span>
        <span aria-hidden>·</span>
        <span className="tabular">
          motion{" "}
          {episode.plausibility === null ? "—" : `${Math.round(episode.plausibility * 100)}%`}
        </span>
        {episode.anchor?.onchain_episode_id ? (
          <>
            <span aria-hidden>·</span>
            <a
              href={explorerTx(episode.anchor.txs[episode.anchor.txs.length - 1].hash)}
              target="_blank"
              rel="noreferrer"
              className={`interactive underline decoration-dotted underline-offset-2 ${
                paid ? "hover:text-on-ink" : "hover:text-foreground"
              }`}
            >
              on-chain
            </a>
          </>
        ) : null}
      </div>

      {!paid && episode.reasons.length > 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-muted">{episode.reasons[0]}</p>
      ) : null}
    </li>
  );
}

export function AccountView() {
  const signer = useSigner();
  const [episodes, setEpisodes] = useState<StoredEpisode[] | null>(null);
  const [reputation, setReputation] = useState<Reputation | null>(null);
  const [balance, setBalance] = useState(0);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const address = signer?.address ?? null;

  const refresh = useCallback(async () => {
    if (!address) return;

    try {
      const data = (await (await fetch("/api/episodes")).json()) as { episodes: StoredEpisode[] };
      const mine = data.episodes
        .filter((e) => e.entity_id.toLowerCase() === address.toLowerCase())
        .sort((a, b) => b.recorded_at - a.recorded_at);

      setEpisodes(mine);
      setReputation(reputationFor(address, data.episodes));
    } catch {
      setEpisodes([]);
    }

    pendingWithdrawal()
      .then(setBalance)
      .catch(() => setBalance(0));
  }, [address]);

  useEffect(() => {
    // Deferred a tick: this synchronises with the server and the chain, both
    // external, and setting state straight from an effect body cascades.
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const collect = useCallback(async () => {
    setState("sending");
    setError(null);
    const result = await withdrawEarnings();
    if (result.ok) {
      setHash(result.hash ?? null);
      setState("done");
      void refresh();
    } else {
      setError(result.error ?? "Could not withdraw.");
      setState("idle");
    }
  }, [refresh]);

  const earned = (episodes ?? []).reduce((sum, e) => sum + e.paid_usdc, 0);
  const accepted = (episodes ?? []).filter((e) => e.accepted).length;
  const total = episodes?.length ?? 0;
  const acceptedShare = total > 0 ? Math.round((accepted / total) * 100) : 0;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-10">
      <header className="settle settle-1 flex items-center justify-between gap-3 py-4">
        <Link
          href="/c"
          aria-label="Back to recording"
          className="interactive flex h-11 w-11 items-center justify-center rounded-full bg-paper text-foreground shadow-lift"
        >
          <BackIcon />
        </Link>
        <h1 className="text-[17px] font-semibold">Your account</h1>
        {/* Balances the back control so the title sits true centre. */}
        <div className="h-11 w-11" aria-hidden />
      </header>

      {/*
        Money first: it is why someone strapped a phone to their head. The
        figure is quoted on mint and the action that moves it sits directly
        beneath, so there is never a screen where you can see the balance and
        not reach it.
      */}
      <div className="settle settle-2 rounded-panel bg-mint px-5 py-7 text-center">
        <p className="text-[11px] font-medium text-mint-ink">Ready to withdraw</p>
        <p className="figure mt-2.5 text-[52px] text-mint-ink">
          ${balance.toFixed(2)}
          <span className="unit">USDC</span>
        </p>

        {state === "done" ? (
          <p className="mt-4 text-sm font-medium text-mint-ink">
            Sent.{" "}
            {hash ? (
              <a
                href={explorerTx(hash)}
                target="_blank"
                rel="noreferrer"
                className="interactive underline decoration-dotted underline-offset-2"
              >
                View
              </a>
            ) : null}
          </p>
        ) : balance > 0 ? (
          <button
            onClick={() => void collect()}
            disabled={state === "sending"}
            className="interactive on-ink mt-5 flex w-full items-center gap-3 rounded-full bg-ink p-1.5 text-on-ink disabled:opacity-60"
          >
            <span className="flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-full bg-mint text-mint-ink">
              <DownIcon />
            </span>
            <span className="flex-1 pr-[48px] text-center text-base font-semibold">
              {state === "sending" ? "Collecting…" : "Withdraw"}
            </span>
          </button>
        ) : (
          <p className="mx-auto mt-3 max-w-[16rem] text-xs leading-relaxed text-mint-ink">
            Accepted episodes credit here. Gas is covered — you sign, we pay for it.
          </p>
        )}

        {error ? (
          <p className="mt-3 rounded-inner bg-butter px-3 py-2 text-xs leading-relaxed text-butter-ink">
            {error}
          </p>
        ) : null}
      </div>

      <div className="settle settle-3 mt-3 grid grid-cols-2 gap-3">
        <Stat label="Episodes" value={String(total)} hint={`${accepted} accepted`} />
        <Stat label="Earned so far" value={`$${earned.toFixed(2)}`} hint="across all bounties" />
      </div>

      {/* The share of takes that paid, drawn rather than asserted — it is the
          one thing a contributor can actually change by recording better. */}
      {total > 0 ? (
        <div className="settle settle-4 mt-3 rounded-card bg-paper px-5 py-4 shadow-lift">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold">Takes that paid</span>
            <span className="figure text-[17px] text-muted">
              {accepted}
              <span className="unit">of {total}</span>
            </span>
          </div>
          <div
            className="mt-3 flex h-8 gap-1.5 overflow-hidden rounded-full"
            role="img"
            aria-label={`${acceptedShare}% of your takes were accepted`}
          >
            <div
              className="flex items-center justify-center rounded-full bg-lilac text-[11px] font-semibold text-lilac-ink"
              style={{ width: `${Math.max(acceptedShare, 14)}%` }}
            >
              {acceptedShare}%
            </div>
            <div className="flex-1 rounded-full bg-paper-sunk" />
          </div>
        </div>
      ) : null}

      {reputation && reputation.episodes > 0 ? (
        <div className="mt-3 rounded-card bg-paper px-5 py-4 shadow-lift">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold">Reputation</span>
            <span className="figure text-[17px]">
              {Math.round(reputation.score)}
              <span className="unit">of 100</span>
            </span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-subtle">
            From acceptance rate, framing, motion match and duplicates.
          </p>
        </div>
      ) : null}

      <h2 className="mb-2.5 mt-7 text-sm font-semibold">Your episodes</h2>

      {episodes === null ? (
        <ul className="space-y-2" aria-label="Loading your episodes">
          {[0, 1, 2].map((i) => (
            <li key={i} className="skeleton h-[84px] rounded-card" />
          ))}
        </ul>
      ) : episodes.length === 0 ? (
        <p className="rounded-card bg-paper px-5 py-7 text-center text-sm leading-relaxed text-muted shadow-lift">
          Nothing yet.{" "}
          <Link
            href="/c"
            className="interactive font-semibold text-foreground underline decoration-dotted underline-offset-2"
          >
            Record your first
          </Link>
          .
        </p>
      ) : (
        <ul className="space-y-2">
          {episodes.map((episode) => (
            <Episode key={episode.episode_id} episode={episode} />
          ))}
        </ul>
      )}

      {/* Who this account is comes after what it earned: the balance is the
          question, the key is the footnote that explains where it goes. */}
      <h2 className="mb-2.5 mt-7 text-sm font-semibold">Your identity</h2>
      <div className="space-y-2.5">
        <Identity />
        <SelfieCheck />
      </div>

      {/* Anytime re-entry to the onboarding tour. It runs on the capture
          screen, where its anchors live, so this routes there with a flag the
          capture screen reads to start the tour. */}
      <Link
        href="/c?tour=capture"
        className="interactive mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-paper py-3.5 text-sm font-semibold text-foreground shadow-lift"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
          <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.7" />
          <path
            d="M9.5 9.6a2.5 2.5 0 114.2 1.9c-.9.7-1.7 1.1-1.7 2.2"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <circle cx="12" cy="16.6" r="0.5" fill="currentColor" stroke="currentColor" />
        </svg>
        How it works
      </Link>

      {address ? (
        <p className="mt-6 text-center text-xs text-subtle">
          Paid to{" "}
          <a
            href={explorerAddress(address)}
            target="_blank"
            rel="noreferrer"
            className="interactive font-mono underline decoration-dotted underline-offset-2"
          >
            {short(address)}
          </a>
        </p>
      ) : null}
    </main>
  );
}
