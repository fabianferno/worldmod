import Link from "next/link";
import { formatUnits } from "viem";
import { explorerAddress } from "@/lib/chain/config";
import {
  bondChainSupported,
  readValidatorBond,
  VALIDATOR_BOND_ADDRESS,
  WMOD_ADDRESS,
  type ValidatorBondState,
} from "@/lib/chain/validator-bond";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Validator bond — World Mod",
  description: "WMOD staked by the validator, slashable for bad validation.",
};

function amount(v: bigint, decimals: number, symbol: string): string {
  const n = Number(formatUnits(v, decimals));
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`;
}

export default async function ValidatorBondPage() {
  const supported = bondChainSupported();

  let state: ValidatorBondState | null = null;
  let loadError: string | null = null;
  if (supported) {
    try {
      state = await readValidatorBond();
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 py-8">
      <Link href="/b/bounties" className="interactive text-sm text-muted hover:text-foreground">
        ← Bounties
      </Link>

      <header className="mt-4">
        <h1 className="text-2xl font-semibold">Validator bond</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted">
          WMOD is the network&rsquo;s token, and this is its one live function: a validator stakes
          WMOD to take part, and the registry owner can <strong>slash</strong> that stake for bad
          validation. Slashed stake is <strong>burned</strong>, never paid to whoever slashed it —
          so the incentive is honest work, not a bounty on accusations.
        </p>
      </header>

      {!supported ? (
        <p className="mt-5 rounded-2xl border border-caution/30 bg-caution/5 p-4 text-sm leading-relaxed text-caution">
          WMOD and ValidatorBond are deployed on Ethereum Sepolia; this deployment is pointed at a
          different chain, so there is no live bond to read here.
        </p>
      ) : loadError ? (
        <p className="mt-5 rounded-2xl border border-negative/30 bg-negative/5 p-4 text-sm leading-relaxed text-negative">
          Could not read the bond contracts right now: {loadError}
        </p>
      ) : state ? (
        <div className="mt-6 space-y-3">
          {/* The validator's actual stake — the headline. */}
          {state.validator ? (
            <div
              className={`rounded-2xl border p-4 ${
                state.validator.isBonded
                  ? "border-positive/25 bg-positive/10"
                  : "border-caution/25 bg-caution/10"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span
                  className={`text-sm font-medium ${
                    state.validator.isBonded ? "text-positive" : "text-caution"
                  }`}
                >
                  {state.validator.isBonded ? "Validator bonded" : "Validator not bonded"}
                </span>
                <span className="tabular text-lg font-semibold">
                  {amount(state.validator.bondOf, state.token.decimals, state.token.symbol)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
                <span>minimum {amount(state.bond.minBond, state.token.decimals, state.token.symbol)}</span>
                <span aria-hidden>·</span>
                <span>{state.validator.isRegistered ? "registered validator" : "not registered"}</span>
                <span aria-hidden>·</span>
                <a
                  href={explorerAddress(state.validator.address)}
                  target="_blank"
                  rel="noreferrer"
                  className="interactive font-mono hover:text-foreground"
                >
                  {state.validator.address.slice(0, 10)}…
                </a>
              </div>
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-subtle">
              No validator address is configured on this deployment, so there is no individual bond
              to show — the network totals below are still live.
            </p>
          )}

          <dl className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5">
              <dt className="text-sm text-muted">Total bonded</dt>
              <dd className="tabular font-mono text-sm">
                {amount(state.bond.totalBonded, state.token.decimals, state.token.symbol)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5">
              <dt className="text-sm text-muted">Minimum bond</dt>
              <dd className="tabular font-mono text-sm">
                {amount(state.bond.minBond, state.token.decimals, state.token.symbol)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="text-sm text-muted">WMOD supply</dt>
              <dd className="tabular font-mono text-sm">
                {amount(state.token.totalSupply, state.token.decimals, state.token.symbol)}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-center text-xs text-subtle">
            <a
              href={explorerAddress(WMOD_ADDRESS)}
              target="_blank"
              rel="noreferrer"
              className="interactive underline underline-offset-2"
            >
              WMOD {WMOD_ADDRESS.slice(0, 10)}…
            </a>
            <a
              href={explorerAddress(VALIDATOR_BOND_ADDRESS)}
              target="_blank"
              rel="noreferrer"
              className="interactive underline underline-offset-2"
            >
              ValidatorBond {VALIDATOR_BOND_ADDRESS.slice(0, 10)}…
            </a>
          </div>
        </div>
      ) : null}
    </main>
  );
}
