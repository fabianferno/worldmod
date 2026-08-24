import Link from "next/link";
import { notFound } from "next/navigation";
import { fileStore } from "@/lib/market/store";
import { budgetBreakdown } from "@/lib/market/types";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/10 py-2">
      <span className="text-xs uppercase tracking-wide text-white/50">{label}</span>
      <span className="font-mono text-sm tabular-nums">{value}</span>
    </div>
  );
}

export default async function BountyDetail({ params }: PageProps<"/b/bounties/[id]">) {
  const { id } = await params;

  const bounty = await fileStore.getBounty(id);
  if (!bounty) notFound();

  const episodes = await fileStore.listEpisodes(id);
  const accepted = episodes.filter((e) => e.accepted);
  const paid = accepted.reduce((sum, e) => sum + e.paid_usdc, 0);
  const { allocated, balanced } = budgetBreakdown(bounty);

  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(0)}%`);

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-8">
      <Link href="/b/bounties" className="text-sm text-white/50 hover:text-white">
        ← Bounties
      </Link>

      <header className="mb-6 mt-3">
        <h1 className="text-xl font-semibold tracking-tight">{bounty.title}</h1>
        <p className="mt-2 text-sm text-white/60">{bounty.task_spec}</p>
      </header>

      {bounty.motion_policy === "allow_static" ? (
        <p className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          This is a seated task, so head motion is too small to verify captures against the
          gyroscope. Episodes here are accepted without that evidence and are the easiest in
          the network to fake — priced and trusted accordingly.
        </p>
      ) : null}

      <section className="mb-6">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/40">
          Terms
        </h2>
        <Row label="Per episode" value={`$${bounty.per_episode_usdc.toFixed(2)}`} />
        <Row label="Episodes wanted" value={String(bounty.min_episodes)} />
        <Row label="Duration" value={`${bounty.duration_range_s[0]}–${bounty.duration_range_s[1]}s`} />
        <Row label="Min framing" value={pct(bounty.min_framing)} />
        <Row
          label="Min plausibility"
          value={bounty.motion_policy === "require" ? pct(bounty.min_plausibility) : "not required"}
        />
        <Row label="Min trust level" value={bounty.min_trust_level} />
        <Row label="License" value={bounty.license} />
        <Row
          label="Budget"
          value={`$${bounty.budget_usdc.toFixed(2)}${balanced ? "" : ` (allocates $${allocated.toFixed(2)})`}`}
        />
        <Row label="Paid so far" value={`$${paid.toFixed(2)}`} />
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">
          Episodes ({accepted.length} accepted of {episodes.length})
        </h2>

        {episodes.length === 0 ? (
          <p className="rounded-xl border border-white/10 p-6 text-center text-sm text-white/50">
            No submissions yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {episodes.map((e) => (
              <li
                key={e.episode_id}
                className="rounded-xl border border-white/10 p-3.5"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-xs text-white/60">{e.episode_id}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      e.accepted
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-red-500/15 text-red-300"
                    }`}
                  >
                    {e.accepted ? `accepted · $${e.paid_usdc.toFixed(2)}` : "rejected"}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/60">
                  <span className="rounded bg-white/5 px-2 py-0.5">
                    framing {pct(e.framing)}
                  </span>
                  <span className="rounded bg-white/5 px-2 py-0.5">
                    plausibility {pct(e.plausibility)}
                  </span>
                  <span className="rounded bg-white/5 px-2 py-0.5">
                    {e.duration_s.toFixed(1)}s
                  </span>
                  <span className="rounded bg-white/5 px-2 py-0.5">{e.trust_level}</span>
                  <span className="rounded bg-white/5 px-2 py-0.5">{e.ua_class}</span>
                </div>

                {e.reasons.length > 0 ? (
                  <ul className="mt-2 space-y-0.5 text-xs text-red-300/80">
                    {e.reasons.map((reason) => (
                      <li key={reason}>· {reason}</li>
                    ))}
                  </ul>
                ) : null}

                <p className="mt-2 truncate font-mono text-[10px] text-white/25">
                  {e.manifest_hash}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
