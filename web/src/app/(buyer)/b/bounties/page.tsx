import Link from "next/link";
import { fileStore } from "@/lib/market/store";
import { budgetBreakdown } from "@/lib/market/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Bounties — World Mod",
  description: "Open bounties for physical-world data.",
};

const usd = (v: number) => `$${v.toFixed(2)}`;

export default async function BountiesPage() {
  const bounties = await fileStore.listBounties();
  const episodes = await fileStore.listEpisodes();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Bounties</h1>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted">
            Demand first. Describe the data you need and contributors go and generate it —
            scored on their own device before it reaches you.
          </p>
        </div>

        <Link
          href="/b/bounties/new"
          className="interactive shrink-0 rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background hover:bg-white"
        >
          Post a bounty
        </Link>
      </header>

      {bounties.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line p-10 text-center">
          <p className="text-sm font-medium">No bounties yet</p>
          <p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-subtle">
            A bounty describes a physical task and escrows what it pays. Contributors see it
            the moment it opens.
          </p>
          <Link
            href="/b/bounties/new"
            className="interactive mt-5 inline-block rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background hover:bg-white"
          >
            Post the first one
          </Link>
        </div>
      ) : (
        <ul className="mt-7 space-y-3">
          {bounties.map((bounty) => {
            const mine = episodes.filter((e) => e.bounty_id === bounty.bounty_id);
            const accepted = mine.filter((e) => e.accepted).length;
            const progress = Math.min(1, accepted / bounty.min_episodes);
            const { balanced } = budgetBreakdown(bounty);

            return (
              <li key={bounty.bounty_id}>
                <Link
                  href={`/b/bounties/${bounty.bounty_id}`}
                  className="interactive block rounded-2xl border border-line bg-surface p-5 hover:border-white/25"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h2 className="text-base font-medium">{bounty.title}</h2>
                    <span className="tabular font-mono text-sm text-muted">
                      {usd(bounty.per_episode_usdc)}
                      <span className="text-subtle"> / episode</span>
                    </span>
                  </div>

                  <p className="mt-1.5 line-clamp-2 max-w-prose text-sm leading-relaxed text-muted">
                    {bounty.task_spec}
                  </p>

                  <div className="mt-4 flex items-center gap-3">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${progress * 100}%` }}
                      />
                    </div>
                    <span className="tabular shrink-0 font-mono text-xs text-subtle">
                      {accepted}/{bounty.min_episodes}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-md bg-white/5 px-2 py-0.5 text-subtle">
                      {bounty.required_modalities.join(" + ")}
                    </span>

                    {bounty.motion_policy === "allow_static" ? (
                      <span className="rounded-md bg-caution/12 px-2 py-0.5 text-caution">
                        no motion check
                      </span>
                    ) : null}

                    {!balanced ? (
                      <span className="rounded-md bg-negative/12 px-2 py-0.5 text-negative">
                        budget does not balance
                      </span>
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
