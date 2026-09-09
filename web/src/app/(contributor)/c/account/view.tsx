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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3">
      <p className="text-xs text-subtle">{label}</p>
      <p className="tabular mt-0.5 text-lg font-semibold">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

function Episode({ episode }: { episode: StoredEpisode }) {
  const paid = episode.accepted;
  const when = new Date(episode.recorded_at * 1000);

  return (
    <li className="rounded-2xl border border-line bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">
          {when.toLocaleDateString(undefined, { month: "short", day: "numeric" })}{" "}
          <span className="text-subtle">
            {when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </span>
        </span>
        <span
          className={`tabular shrink-0 text-sm font-semibold ${paid ? "text-positive" : "text-muted"}`}
        >
          {paid ? `+$${episode.paid_usdc.toFixed(2)}` : "—"}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
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
              className="interactive text-accent underline decoration-dotted"
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

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-5 pb-10">
      <header className="flex items-center justify-between gap-3 py-5">
        <h1 className="text-lg font-semibold">Your account</h1>
        <Link href="/c" className="interactive text-sm text-accent">
          Record
        </Link>
      </header>

      <Identity />
      <div className="mt-3">
        <SelfieCheck />
      </div>

      {/* Money first: it is why someone strapped a phone to their head. */}
      <div className="mt-4 rounded-2xl border border-line bg-surface p-5 text-center">
        <p className="text-xs text-subtle">Ready to withdraw</p>
        <p className="tabular mt-1 text-4xl font-semibold text-positive">${balance.toFixed(2)}</p>

        {state === "done" ? (
          <p className="mt-3 text-sm text-positive">
            Sent.{" "}
            {hash ? (
              <a
                href={explorerTx(hash)}
                target="_blank"
                rel="noreferrer"
                className="interactive underline decoration-dotted"
              >
                View
              </a>
            ) : null}
          </p>
        ) : balance > 0 ? (
          <button
            onClick={() => void collect()}
            disabled={state === "sending"}
            className="interactive mt-4 w-full rounded-2xl bg-positive py-3.5 text-base font-semibold text-background disabled:opacity-60"
          >
            {state === "sending" ? "Collecting…" : "Withdraw"}
          </button>
        ) : (
          <p className="mt-2 text-xs leading-relaxed text-subtle">
            Accepted episodes credit here. Gas is covered — you sign, we pay for it.
          </p>
        )}

        {error ? <p className="mt-2 text-xs leading-relaxed text-caution">{error}</p> : null}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Stat label="Episodes" value={String(episodes?.length ?? 0)} hint={`${accepted} accepted`} />
        <Stat label="Earned so far" value={`$${earned.toFixed(2)}`} hint="across all bounties" />
      </div>

      {reputation && reputation.episodes > 0 ? (
        <div className="mt-3 rounded-2xl border border-line bg-surface px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium">Reputation</span>
            <span className="tabular text-sm font-semibold">{Math.round(reputation.score)}/100</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-subtle">
            {reputation.provisional
              ? "Provisional — too few episodes for this to mean much yet. Nothing is gated on it."
              : "From acceptance rate, framing, motion match and duplicates. Nothing is gated on it."}
          </p>
        </div>
      ) : null}

      <h2 className="mt-6 mb-2 text-sm font-medium text-muted">Your episodes</h2>

      {episodes === null ? (
        <p className="text-sm text-subtle">Loading…</p>
      ) : episodes.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface px-4 py-6 text-center text-sm leading-relaxed text-subtle">
          Nothing yet.{" "}
          <Link href="/c" className="interactive text-accent underline decoration-dotted">
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

      {address ? (
        <p className="mt-6 text-center text-xs text-subtle">
          Paid to{" "}
          <a
            href={explorerAddress(address)}
            target="_blank"
            rel="noreferrer"
            className="interactive font-mono underline decoration-dotted"
          >
            {short(address)}
          </a>
        </p>
      ) : null}
    </main>
  );
}
