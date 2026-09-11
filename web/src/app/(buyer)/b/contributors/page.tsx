import Link from "next/link";
import { fileStore } from "@/lib/market/store";
import { leaderboard, PROVISIONAL_BELOW } from "@/lib/market/reputation";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Contributors — World Mod",
  description: "Derived reputation across the network.",
};

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

export default async function ContributorsPage() {
  const ranked = leaderboard(await fileStore.listEpisodes());

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 py-8">
      <Link href="/b/bounties" className="interactive text-sm text-muted hover:text-foreground">
        ← Bounties
      </Link>

      <header className="mt-4">
        <h1 className="text-2xl font-semibold">Contributors</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted">
          Reputation is derived from what a contributor has already submitted — acceptance
          rate, framing, motion evidence and duplicates — not stored separately, so it can
          never drift from the record it summarises.
        </p>
      </header>

      {ranked.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-subtle">
          No contributors yet.
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {ranked.map((rep) => (
            <li key={rep.entity_id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="tabular font-mono text-xs text-muted">
                  {rep.entity_id.slice(0, 16)}…
                </span>
                <span className="flex items-baseline gap-2">
                  <span className="tabular text-lg font-semibold">{rep.score.toFixed(0)}</span>
                  {rep.provisional ? (
                    <span
                      className="rounded bg-paper-sunk px-1.5 py-0.5 text-[10px] text-muted"
                      title={`Fewer than ${PROVISIONAL_BELOW} episodes — not yet meaningful`}
                    >
                      provisional
                    </span>
                  ) : null}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
                <span className="tabular">
                  {rep.accepted}/{rep.episodes} accepted
                </span>
                <span aria-hidden>·</span>
                <span className="tabular">framing {pct(rep.mean_framing)}</span>
                <span aria-hidden>·</span>
                <span className="tabular">motion {pct(rep.mean_plausibility)}</span>
                {rep.duplicate_rate > 0 ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="tabular text-negative">
                      {pct(rep.duplicate_rate)} duplicates
                    </span>
                  </>
                ) : null}
                <span aria-hidden>·</span>
                <span className="tabular">${rep.total_earned_usdc.toFixed(2)} earned</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
