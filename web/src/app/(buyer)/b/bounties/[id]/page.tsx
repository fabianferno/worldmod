import { explorerTx } from "@/lib/chain/config";
import { Traces } from "./traces";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fileStore } from "@/lib/market/store";
import { budgetBreakdown } from "@/lib/market/types";
import type { StoredEpisode } from "@/lib/market/types";

export const dynamic = "force-dynamic";

const pct = (v: number | null | undefined) =>
  typeof v === "number" ? `${Math.round(v * 100)}%` : "—";

const usd = (v: number) => `$${v.toFixed(2)}`;

function Term({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-b border-line py-2.5 last:border-0">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-sm text-muted">{label}</dt>
        <dd className="tabular font-mono text-sm">{value}</dd>
      </div>
      {note ? <p className="mt-1 text-xs text-subtle">{note}</p> : null}
    </div>
  );
}

/**
 * One measurement with its bar. A buyer scans these to judge a batch, so the
 * number and the bar sit together rather than the bar carrying it alone.
 */
function Score({ label, value }: { label: string; value: number | null }) {
  const known = typeof value === "number";
  const tone = !known
    ? "bg-paper-sunk"
    : value >= 0.7
      ? "bg-positive"
      : value >= 0.4
        ? "bg-caution"
        : "bg-negative";

  return (
    <div className="min-w-24 flex-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-subtle">{label}</span>
        <span className="tabular font-mono text-xs">{pct(value)}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-paper-sunk">
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: known ? `${Math.max(3, value * 100)}%` : "100%" }}
        />
      </div>
    </div>
  );
}

function EpisodeRow({ episode }: { episode: StoredEpisode }) {
  const verified =
    episode.validation?.checks.manifest_intact && episode.validation?.checks.streams_intact;

  return (
    <li className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <span className="tabular font-mono text-xs text-muted">{episode.episode_id}</span>

        <span
          className={`rounded-md px-2 py-0.5 text-xs font-medium ${
            episode.accepted
              ? "bg-positive/15 text-positive"
              : "bg-negative/15 text-negative"
          }`}
        >
          {episode.accepted ? `Accepted · ${usd(episode.paid_usdc)}` : "Rejected"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-3">
        <Score label="Framing" value={episode.framing} />
        <Score label="Motion match" value={episode.plausibility} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
        <span className="tabular">{episode.duration_s.toFixed(1)}s</span>
        <span aria-hidden>·</span>
        <span>{episode.ua_class.replace("_", " ")}</span>
        <span aria-hidden>·</span>
        <span>{episode.trust_level}</span>
        {episode.anchor?.onchain_episode_id ? (
          <a
            href={explorerTx(episode.anchor.txs[episode.anchor.txs.length - 1].hash)}
            target="_blank"
            rel="noreferrer"
            className="interactive text-accent underline decoration-dotted"
          >
            on-chain #{episode.anchor.onchain_episode_id}
          </a>
        ) : null}
        {verified ? (
          <>
            <span aria-hidden>·</span>
            {/* The distinction a buyer is actually paying for. */}
            <span className="text-positive/80" title="Hashes recomputed from the uploaded bytes">
              hashes verified
            </span>
          </>
        ) : null}
      </div>

      {episode.status === "scored" ? (
        <Traces
          episodeId={episode.episode_id}
          correlation={episode.validation?.checks.flow_gyro_corr ?? null}
        />
      ) : null}

      {episode.reasons.length > 0 ? (
        <ul className="mt-3 space-y-1 border-l-2 border-negative/30 pl-3 text-xs text-negative/85">
          {episode.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {episode.accepted && episode.streams?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {episode.streams.map((stream) => (
            <a
              key={stream.kind}
              href={`/api/episodes/${episode.episode_id}/stream?kind=${stream.kind}`}
              className="interactive rounded-lg border border-line px-2.5 py-1 text-xs font-medium hover:border-line-strong hover:text-accent"
            >
              {stream.kind === "rgb" ? "Video" : stream.kind.toUpperCase()}
              <span className="ml-1.5 tabular text-subtle">
                {(stream.bytes / 1_000_000).toFixed(1)}MB
              </span>
            </a>
          ))}
        </div>
      ) : null}

      <p className="mt-3 truncate font-mono text-[10px] text-subtle/70" title={episode.manifest_hash}>
        {episode.manifest_hash}
      </p>
    </li>
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
  const progress = Math.min(1, accepted.length / bounty.min_episodes);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 py-8">
      <Link
        href="/b/bounties"
        className="interactive text-sm text-muted hover:text-foreground"
      >
        ← All bounties
      </Link>

      <header className="mt-4">
        <h1 className="text-2xl font-semibold">{bounty.title}</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted">{bounty.task_spec}</p>
      </header>

      <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted">Collected</p>
            <p className="tabular mt-0.5 text-2xl font-semibold">
              {accepted.length}
              <span className="text-lg font-normal text-subtle"> / {bounty.min_episodes}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted">Paid out</p>
            <p className="tabular mt-0.5 text-2xl font-semibold">{usd(paid)}</p>
          </div>
        </div>

        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-paper-sunk">
          <div className="h-full rounded-full bg-accent" style={{ width: `${progress * 100}%` }} />
        </div>
      </section>

      {bounty.motion_policy === "allow_static" ? (
        <p className="mt-4 rounded-2xl border border-caution/25 bg-caution/10 p-4 text-sm leading-relaxed text-caution">
          This is a seated task, so head motion is too small to verify captures against the
          gyroscope. Episodes here are accepted without that evidence and are the easiest in
          the network to fake — price and trust them accordingly.
        </p>
      ) : null}

      <section className="mt-6">
        <h2 className="text-sm font-medium text-muted">Terms</h2>
        <dl className="mt-2 rounded-2xl border border-line bg-surface px-4 py-1">
          <Term label="Per episode" value={usd(bounty.per_episode_usdc)} />
          <Term
            label="Duration"
            value={`${bounty.duration_range_s[0]}–${bounty.duration_range_s[1]}s`}
          />
          <Term
            label="Minimum framing"
            value="confidential"
            note="Checked privately inside a Chainlink CRE enclave, not exposed here."
          />
          <Term
            label="Minimum motion match"
            value={bounty.motion_policy === "require" ? "confidential" : "not required"}
          />
          <Term label="Minimum trust level" value={bounty.min_trust_level} />
          <Term label="Licence" value={bounty.license.replace(/_/g, " ")} />
          <Term
            label="Escrowed"
            value={usd(bounty.budget_usdc)}
            note={balanced ? undefined : `Allocations total ${usd(allocated)} — this does not balance.`}
          />
          <Term label="Utility pool" value={usd(bounty.utility_pool_usdc)} />
        </dl>
      </section>

      <section className="mt-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium text-muted">
            Episodes <span className="tabular text-subtle">({episodes.length})</span>
          </h2>
          {accepted.length > 0 ? (
            <span className="text-xs text-subtle">Downloads are licensed on acceptance</span>
          ) : null}
        </div>

        {episodes.length === 0 ? (
          <div className="mt-2 rounded-2xl border border-dashed border-line p-8 text-center">
            <p className="text-sm font-medium">No submissions yet</p>
            <p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-subtle">
              Contributors see this bounty as soon as they open the capture screen. Share the
              link to reach more of them.
            </p>
            <Link
              href="/c"
              className="interactive mt-4 inline-block rounded-xl border border-line px-4 py-2 text-sm font-medium hover:border-line-strong"
            >
              Record one yourself
            </Link>
          </div>
        ) : (
          <ul className="mt-2 space-y-2">
            {episodes.map((episode) => (
              <EpisodeRow key={episode.episode_id} episode={episode} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
