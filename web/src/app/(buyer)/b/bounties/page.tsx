import Link from "next/link";
import { fileStore } from "@/lib/market/store";
import { budgetBreakdown } from "@/lib/market/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Bounties — World Mod",
  description: "Open bounties for physical-world data.",
};

export default async function BountiesPage() {
  const bounties = await fileStore.listBounties();
  const episodes = await fileStore.listEpisodes();

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Bounties</h1>
          <p className="mt-1 text-sm text-white/50">
            Demand-first: a buyer describes what they need, contributors go and generate it.
          </p>
        </div>
        <Link
          href="/b/bounties/new"
          className="shrink-0 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-neutral-950"
        >
          Post a bounty
        </Link>
      </header>

      <ul className="space-y-3">
        {bounties.map((bounty) => {
          const mine = episodes.filter((e) => e.bounty_id === bounty.bounty_id);
          const accepted = mine.filter((e) => e.accepted).length;
          const { balanced } = budgetBreakdown(bounty);

          return (
            <li key={bounty.bounty_id}>
              <Link
                href={`/b/bounties/${bounty.bounty_id}`}
                className="block rounded-xl border border-white/10 p-4 transition-colors hover:border-white/25"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-medium">{bounty.title}</h2>
                  <span className="font-mono text-sm tabular-nums text-white/70">
                    ${bounty.per_episode_usdc.toFixed(2)}/episode
                  </span>
                </div>

                <p className="mt-1 line-clamp-2 text-sm text-white/50">{bounty.task_spec}</p>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono">
                    {accepted}/{bounty.min_episodes} accepted
                  </span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5">
                    {bounty.required_modalities.join(" + ")}
                  </span>
                  {bounty.motion_policy === "allow_static" ? (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">
                      static task — no motion check
                    </span>
                  ) : null}
                  {!balanced ? (
                    <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-red-300">
                      budget does not balance
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {bounties.length === 0 ? (
        <p className="rounded-xl border border-white/10 p-6 text-center text-sm text-white/50">
          No bounties yet.
        </p>
      ) : null}
    </main>
  );
}
