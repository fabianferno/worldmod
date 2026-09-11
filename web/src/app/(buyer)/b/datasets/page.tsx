import Link from "next/link";
import { ADDRESSES, CHAIN, explorerAddress } from "@/lib/chain/config";
import { readDatasetRegistry, datasetRegistryCount } from "@/lib/hedera/read-dataset-registry";
import { hederaConfigured } from "@/lib/hedera/issue";
import { IssueBondButton } from "./issue-bond-button";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Datasets — World Mod",
  description: "Datasets minted on-chain, tokenizable as Hedera Bonds.",
};

// priceUsdc is USDC's own 6-decimal integer (e.g. 6_000_000 = $6.00).
const usd = (priceUsdc6: bigint) => `$${(Number(priceUsdc6) / 1_000_000).toFixed(2)}`;

type Dataset = Awaited<ReturnType<typeof readDatasetRegistry>>;

export default async function DatasetsPage() {
  const configured = hederaConfigured();

  // Read the registry defensively: a chain hiccup, or a single dataset that
  // fails to read, must not take down the whole page. Show whatever resolved.
  let datasets: Dataset[] = [];
  let loadError: string | null = null;
  try {
    const count = await datasetRegistryCount();
    const ids = Array.from({ length: count }, (_, i) => i + 1);
    const settled = await Promise.allSettled(ids.map((id) => readDatasetRegistry(id)));
    datasets = settled
      .filter((r): r is PromiseFulfilledResult<Dataset> => r.status === "fulfilled")
      .map((r) => r.value);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 py-8">
      <Link href="/b/bounties" className="interactive text-sm text-muted hover:text-foreground">
        ← Bounties
      </Link>

      <header className="mt-4">
        <h1 className="text-2xl font-semibold">Datasets</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted">
          Every dataset here is minted on {CHAIN.name}&rsquo;s <code className="text-xs">DatasetRegistry</code> from
          episodes already validated by World Mod&rsquo;s own flow-vs-gyro check. A dataset can also be
          tokenized as a Hedera Bond — a licence instrument, not a copy of the data — so it can be
          held, transferred and later paid against on Hedera testnet as part of the Tokenization
          of Anything track.
        </p>
      </header>

      {!configured ? (
        <p className="mt-5 rounded-2xl border border-caution/30 bg-caution/5 p-4 text-sm leading-relaxed text-caution">
          Hedera issuance is not configured on this deployment — the &ldquo;Issue as Hedera Bond&rdquo; action
          will not appear until <code className="text-xs">HEDERA_ACCOUNT_ID</code> and{" "}
          <code className="text-xs">HEDERA_PRIVATE_KEY</code> are set.
        </p>
      ) : null}

      {loadError ? (
        <p className="mt-5 rounded-2xl border border-negative/30 bg-negative/5 p-4 text-sm leading-relaxed text-negative">
          Could not read the {CHAIN.name} registry right now: {loadError}
        </p>
      ) : null}

      {!loadError && datasets.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-subtle">
          No datasets minted yet.
        </p>
      ) : datasets.length > 0 ? (
        <ul className="mt-6 space-y-3">
          {datasets.map((dataset) => (
            <li key={dataset.datasetId} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-sm font-medium">Dataset #{dataset.datasetId}</span>
                <span className="tabular text-lg font-semibold">{usd(dataset.priceUsdc)}</span>
              </div>

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
                <span className="tabular">{dataset.episodeCount} episodes</span>
                <span aria-hidden>·</span>
                <span>{dataset.license}</span>
                <span aria-hidden>·</span>
                <a
                  href={explorerAddress(dataset.creator)}
                  target="_blank"
                  rel="noreferrer"
                  className="interactive font-mono text-subtle hover:text-foreground"
                >
                  {dataset.creator.slice(0, 10)}…
                </a>
              </div>

              {dataset.metadataURI ? (
                <p className="mt-2 truncate font-mono text-xs text-subtle" title={dataset.metadataURI}>
                  {dataset.metadataURI}
                </p>
              ) : null}

              {configured ? <IssueBondButton datasetId={Number(dataset.datasetId)} /> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-6 text-center text-xs text-subtle">
        {CHAIN.name} registry:{" "}
        <a
          href={explorerAddress(ADDRESSES.datasetRegistry)}
          target="_blank"
          rel="noreferrer"
          className="interactive underline underline-offset-2"
        >
          {ADDRESSES.datasetRegistry.slice(0, 10)}…
        </a>
      </p>
    </main>
  );
}
