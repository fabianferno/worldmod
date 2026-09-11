import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Federated rounds — World Mod",
  description: "Organizations contributing to a model without releasing data.",
};

interface Participant {
  org_id: string;
  episodes: number;
  frames: number;
  update_hash: string;
  local_error: number;
}

/**
 * Real differential-privacy parameters for a round, written by the trainer.
 * Absent (or null) means DP was not applied — in which case nothing is shown,
 * rather than a privacy claim the numbers don't back.
 */
interface DpParams {
  epsilon: number;
  delta: number;
  sigma: number;
  clip_norm: number;
}

interface Round {
  round_id: number;
  participants: Participant[];
  global_hash: string;
  global_error: number;
  baseline_error: number;
  /** Minimum participants required to aggregate this round, if enforced. */
  threshold?: number;
  /** Differential-privacy parameters, if applied. */
  dp?: DpParams | null;
}

interface FederatedResults {
  rounds: Round[];
  orgs: string[];
  parameters: number;
  horizon: number;
  heldout_episodes: number;
}

async function load(): Promise<FederatedResults | null> {
  try {
    return JSON.parse(
      await readFile(join(process.cwd(), "public", "federated-results.json"), "utf8"),
    ) as FederatedResults;
  } catch {
    return null;
  }
}

export default async function FederatedPage() {
  const results = await load();

  if (!results || results.rounds.length === 0) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 py-8">
        <h1 className="text-2xl font-semibold">Federated rounds</h1>
        <p className="mt-6 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-subtle">
          No rounds recorded yet. Run the trainer to produce some.
        </p>
      </main>
    );
  }

  const best = Math.min(...results.rounds.map((r) => r.global_error));
  const baseline = results.rounds[0].baseline_error;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 py-8">
      <Link href="/b/bounties" className="interactive text-sm text-muted hover:text-foreground">
        ← Bounties
      </Link>

      <header className="mt-4">
        <h1 className="text-2xl font-semibold">Federated rounds</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted">
          Two organizations train the same model on data neither one shares. Each sends
          only a weight update, each update is hashed, and the averaged model is
          evaluated on a held-out set both can see.
        </p>
      </header>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-muted">Rounds</h2>
        <ul className="mt-2 space-y-2">
          {results.rounds.map((round) => {
            const isBest = round.global_error === best;
            return (
              <li key={round.round_id} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-sm font-medium">Round {round.round_id}</span>
                  <span className="tabular font-mono text-sm">
                    {round.global_error.toFixed(4)}
                    {isBest ? (
                      <span className="ml-2 rounded bg-paper-sunk px-1.5 py-0.5 text-[10px] text-muted">
                        best
                      </span>
                    ) : null}
                  </span>
                </div>

                <ul className="mt-3 space-y-1.5">
                  {round.participants.map((p) => (
                    <li
                      key={p.org_id}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs"
                    >
                      <span className="text-muted">
                        {p.org_id.replace("_", " ")}
                        <span className="tabular text-subtle"> · {p.episodes} episodes kept private</span>
                      </span>
                      <span
                        className="tabular font-mono text-subtle"
                        title={`Update hash: ${p.update_hash}`}
                      >
                        Δ {p.update_hash.slice(2, 14)}…
                      </span>
                    </li>
                  ))}
                </ul>

                {/* Privacy, drawn only from numbers the trainer actually
                    emitted — no fields, no claim. */}
                {round.threshold || round.dp ? (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-[11px]">
                    {round.threshold ? (
                      <span className="tabular text-subtle">
                        min {round.threshold} participants
                        {round.participants.length < round.threshold
                          ? " · below threshold, not aggregated"
                          : ""}
                      </span>
                    ) : null}
                    {round.dp ? (
                      <span
                        className="tabular rounded-full bg-positive/10 px-2 py-0.5 text-positive"
                        title={`Per-round Gaussian mechanism: each update clipped to L2 norm ${round.dp.clip_norm}, then Gaussian noise σ=${round.dp.sigma} added. This ε is per round, not composed across rounds.`}
                      >
                        differential privacy · ε {round.dp.epsilon}/round, δ {round.dp.delta}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <p
                  className="mt-2 truncate border-t border-line pt-2 font-mono text-[10px] text-subtle/70"
                  title={round.global_hash}
                >
                  global {round.global_hash}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-muted">What the rounds show</h2>
        <div className="mt-2 rounded-2xl border border-line bg-surface p-4">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Best round</dt>
              <dd className="tabular font-mono">{best.toFixed(4)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">No-change baseline</dt>
              <dd className="tabular font-mono">{baseline.toFixed(4)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Shared model</dt>
              <dd className="tabular font-mono">{results.parameters.toLocaleString()} params</dd>
            </div>
          </dl>

          <p className="mt-3 border-t border-line pt-3 text-sm leading-relaxed text-muted">
            Raw data never moved: each organization sent {results.parameters.toLocaleString()}{" "}
            numbers and a hash. That is the coordination the protocol needs, and it works.
          </p>
        </div>
      </section>
    </main>
  );
}
