import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Link from "next/link";
import { ScalingCurve, type CurvePoint } from "./curve";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "World model — World Mod",
  description: "What the collected episodes are worth to a model.",
};

interface Results {
  encoder: string;
  latent_dim: number;
  parameters: number;
  horizon: number;
  train_episodes: number;
  heldout_episodes: number;
  heldout_contributors: string[];
  baseline_error: number;
  model_error: number;
  improvement: number;
  curve: CurvePoint[];
  utility: Array<{ entity_id: string; episodes: number; delta: number; share: number }>;
}

async function loadResults(): Promise<Results | null> {
  try {
    return JSON.parse(
      await readFile(join(process.cwd(), "public", "model-results.json"), "utf8"),
    ) as Results;
  } catch {
    return null;
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="tabular font-mono text-sm">{value}</dd>
    </div>
  );
}

export default async function ModelPage() {
  const results = await loadResults();

  if (!results) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 py-8">
        <h1 className="text-2xl font-semibold">World model</h1>
        <p className="mt-6 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-subtle">
          No training run yet. Run the trainer to produce one.
        </p>
      </main>
    );
  }

  const beatsBaseline = results.model_error < results.baseline_error;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 py-8">
      <Link href="/b/bounties" className="interactive text-sm text-muted hover:text-foreground">
        ← Bounties
      </Link>

      <header className="mt-4">
        <h1 className="text-2xl font-semibold">World model</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted">
          A latent forward-dynamics model: given what the camera sees now and how the
          wearer&apos;s head moved, predict what it sees next. Trained on the episodes this
          network collected.
        </p>
      </header>

      <section className="mt-7">
        <h2 className="text-sm font-medium text-muted">
          Held-out error against episodes collected
        </h2>
        <div className="mt-2">
          <ScalingCurve curve={results.curve} baseline={results.baseline_error} />
        </div>
      </section>

      {beatsBaseline ? (
        <section className="mt-4 rounded-2xl border border-positive/25 bg-positive/10 p-4">
          <p className="text-sm font-medium text-positive">
            Beats the no-change baseline by {(results.improvement * 100).toFixed(0)}%
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            The model has learned something about how this scene evolves, beyond the fact that video is smooth.
          </p>
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="text-sm font-medium text-muted">Run</h2>
        <dl className="mt-2 rounded-2xl border border-line bg-surface px-4 py-1">
          <Row label="Encoder" value={`${results.encoder} · ${results.latent_dim}d`} />
          <Row label="Dynamics head" value={`${results.parameters.toLocaleString()} params`} />
          <Row label="Horizon" value={`${results.horizon} steps ahead`} />
          <Row
            label="Train / held out"
            value={`${results.train_episodes} / ${results.heldout_episodes} episodes`}
          />
          <Row label="Baseline error" value={results.baseline_error.toFixed(4)} />
          <Row label="Model error" value={results.model_error.toFixed(4)} />
        </dl>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-muted">Contributor utility</h2>
        {results.utility.length === 0 ? (
          <p className="mt-2 rounded-2xl border border-dashed border-line p-6 text-center text-sm leading-relaxed text-subtle">
            Utility is measured by retraining without each contributor and seeing how much
            the held-out error moves. That needs at least two contributors — every episode
            so far came from one device.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {results.utility.map((row) => (
              <li
                key={row.entity_id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface p-4"
              >
                <span className="tabular font-mono text-xs text-muted">
                  {row.entity_id.slice(0, 14)}…
                </span>
                <span className="tabular text-sm">
                  {(row.share * 100).toFixed(1)}%
                  <span className="text-subtle"> of the utility pool</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* A table view so the chart is never the only way to read the numbers. */}
      <details className="mt-6">
        <summary className="interactive cursor-pointer list-none rounded-2xl border border-line px-4 py-3 text-sm font-medium text-muted">
          Curve as a table
        </summary>
        <table className="mt-2 w-full rounded-2xl border border-line bg-surface text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-subtle">
              <th className="px-4 py-2 font-medium">Episodes</th>
              <th className="px-4 py-2 font-medium">Mean error</th>
              <th className="px-4 py-2 font-medium">Std</th>
              <th className="px-4 py-2 font-medium">Seeds</th>
            </tr>
          </thead>
          <tbody>
            {results.curve.map((point) => (
              <tr key={point.episodes} className="border-b border-line last:border-0">
                <td className="tabular px-4 py-2">{point.episodes}</td>
                <td className="tabular px-4 py-2">{point.mean_error.toFixed(4)}</td>
                <td className="tabular px-4 py-2 text-muted">±{point.std_error.toFixed(4)}</td>
                <td className="tabular px-4 py-2 text-muted">{point.seeds}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </main>
  );
}
