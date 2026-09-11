"use client";

/**
 * The buyer-side Hedera Bond lifecycle, from World Mod's own app rather than
 * hand-run scripts: issue a Bond against a real registry dataset (T3), then
 * mint its licence seats to the dataset's creator (identity bridge), fix a
 * licence-fee coupon, and distribute that coupon to holders in real testnet
 * USDC. Each action calls its /api/hedera/* route, which shells out to an
 * isolated child process — see lib/hedera/*.ts and hedera/scripts/*-json.mjs
 * for why that isolation exists (the ATS SDK's window stub cannot run in this
 * app's own server process).
 */

import { useState } from "react";

interface IssuedBond {
  hederaContractId: string;
  evmAddress: string;
  transactionId: string;
  hashscanUrl: string;
}
interface MintResult {
  creator: string;
  unitsMinted: string;
  kycTxId: string | null;
  mintTxId: string;
  balanceAfter: string;
}
interface CouponResult {
  couponId: string;
  setTxId: string;
  rate: string;
  period: { start: number; end: number };
}
interface Payout {
  holder: string;
  unitsHeld: string;
  amountUsdcSmallest: string;
  transferTxId: string | null;
  note: string;
}
interface DistributeResult {
  couponId: string;
  ratePercent: number;
  nominalValueCents: string;
  payouts: Payout[];
}

type Step = "idle" | "pending" | "done" | "error";

const txUrl = (hash: string) => `https://hashscan.io/testnet/transaction/${hash}`;
const fmtUsdc = (smallest: string) => `$${(Number(smallest) / 1_000_000).toFixed(2)}`;

async function postAction<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as Record<string, unknown> & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (HTTP ${res.status}).`);
  return data as T;
}

export function IssueBondButton({ datasetId }: { datasetId: number }) {
  const [issueState, setIssueState] = useState<Step>("idle");
  const [bond, setBond] = useState<IssuedBond | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);

  const [mintState, setMintState] = useState<Step>("idle");
  const [mint, setMint] = useState<MintResult | null>(null);
  const [mintError, setMintError] = useState<string | null>(null);

  const [couponState, setCouponState] = useState<Step>("idle");
  const [coupon, setCoupon] = useState<CouponResult | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  const [distState, setDistState] = useState<Step>("idle");
  const [dist, setDist] = useState<DistributeResult | null>(null);
  const [distError, setDistError] = useState<string | null>(null);

  async function issue() {
    setIssueState("pending");
    setIssueError(null);
    try {
      const data = await postAction<{ bond: IssuedBond }>("/api/hedera/issue-bond", { datasetId });
      setBond(data.bond);
      setIssueState("done");
    } catch (err) {
      setIssueError(err instanceof Error ? err.message : String(err));
      setIssueState("error");
    }
  }

  async function runMint() {
    if (!bond) return;
    setMintState("pending");
    setMintError(null);
    try {
      const data = await postAction<{ mint: MintResult }>("/api/hedera/mint-to-creator", {
        datasetId,
        securityId: bond.evmAddress,
      });
      setMint(data.mint);
      setMintState("done");
    } catch (err) {
      setMintError(err instanceof Error ? err.message : String(err));
      setMintState("error");
    }
  }

  async function runCoupon() {
    if (!bond) return;
    setCouponState("pending");
    setCouponError(null);
    try {
      const data = await postAction<{ coupon: CouponResult }>("/api/hedera/set-coupon", {
        securityId: bond.evmAddress,
      });
      setCoupon(data.coupon);
      setCouponState("done");
    } catch (err) {
      setCouponError(err instanceof Error ? err.message : String(err));
      setCouponState("error");
    }
  }

  async function runDistribute() {
    if (!bond || !coupon) return;
    setDistState("pending");
    setDistError(null);
    try {
      const data = await postAction<{ distribution: DistributeResult }>("/api/hedera/distribute-coupon", {
        securityId: bond.evmAddress,
        couponId: coupon.couponId,
        holders: mint ? [mint.creator] : [],
      });
      setDist(data.distribution);
      setDistState("done");
    } catch (err) {
      setDistError(err instanceof Error ? err.message : String(err));
      setDistState("error");
    }
  }

  // Not yet issued: the single entry-point button.
  if (!bond) {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => void issue()}
          disabled={issueState === "pending"}
          className="interactive rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-line-strong disabled:opacity-40"
        >
          {issueState === "pending" ? "Issuing on Hedera…" : "Issue as Hedera Bond"}
        </button>
        {issueError ? <p className="mt-2 text-xs text-negative">{issueError}</p> : null}
      </div>
    );
  }

  // Issued: the bond card plus the lifecycle steps.
  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-xl border border-positive/25 bg-positive/5 p-3">
        <p className="text-xs font-medium text-positive">Issued on Hedera testnet</p>
        <p className="mt-1 break-all font-mono text-xs text-muted">{bond.hederaContractId}</p>
        <a
          href={bond.hashscanUrl}
          target="_blank"
          rel="noreferrer"
          className="interactive mt-1 inline-block text-xs text-foreground underline underline-offset-2"
        >
          View on HashScan →
        </a>
      </div>

      {/* Step: mint seats to the creator (identity bridge) */}
      <LifecycleAction
        label="Mint licence seats to creator"
        pendingLabel="Minting to creator…"
        state={mintState}
        error={mintError}
        onRun={() => void runMint()}
      >
        {mint ? (
          <>
            <Line label="Creator" value={`${mint.creator.slice(0, 12)}…`} />
            <Line label="Seats minted" value={`${mint.unitsMinted} (balance ${mint.balanceAfter})`} />
            <TxLine label="Mint tx" hash={mint.mintTxId} />
            {mint.kycTxId ? <TxLine label="KYC tx" hash={mint.kycTxId} /> : null}
          </>
        ) : null}
      </LifecycleAction>

      {/* Step: set a licence-fee coupon */}
      <LifecycleAction
        label="Set licence coupon"
        pendingLabel="Setting coupon…"
        state={couponState}
        error={couponError}
        onRun={() => void runCoupon()}
      >
        {coupon ? (
          <>
            <Line label="Coupon" value={`#${coupon.couponId} at ${coupon.rate}%`} />
            <TxLine label="Set tx" hash={coupon.setTxId} />
          </>
        ) : null}
      </LifecycleAction>

      {/* Step: distribute the coupon in real USDC (needs a coupon) */}
      <LifecycleAction
        label="Distribute coupon (USDC)"
        pendingLabel="Distributing USDC…"
        state={distState}
        error={distError}
        disabled={!coupon}
        disabledHint="Set a coupon first."
        onRun={() => void runDistribute()}
      >
        {dist ? (
          <ul className="space-y-1">
            {dist.payouts.map((p) => (
              <li key={p.holder} className="border-t border-line/60 pt-1 first:border-0 first:pt-0">
                <Line label={`${p.holder.slice(0, 12)}…`} value={`${fmtUsdc(p.amountUsdcSmallest)} (${p.unitsHeld} seats)`} />
                {p.transferTxId ? (
                  <p className="font-mono text-[11px] text-positive">paid · {p.transferTxId}</p>
                ) : (
                  <p className="text-[11px] text-caution">{p.note}</p>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </LifecycleAction>
    </div>
  );
}

function LifecycleAction({
  label,
  pendingLabel,
  state,
  error,
  disabled,
  disabledHint,
  onRun,
  children,
}: {
  label: string;
  pendingLabel: string;
  state: Step;
  error: string | null;
  disabled?: boolean;
  disabledHint?: string;
  onRun: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <button
        type="button"
        onClick={onRun}
        disabled={state === "pending" || disabled}
        className="interactive rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-line-strong disabled:opacity-40"
      >
        {state === "pending" ? pendingLabel : state === "done" ? `${label} ✓` : label}
      </button>
      {disabled && disabledHint ? <p className="mt-2 text-[11px] text-subtle">{disabledHint}</p> : null}
      {error ? <p className="mt-2 text-xs text-negative">{error}</p> : null}
      {state === "done" ? <div className="mt-2 space-y-1 text-xs text-muted">{children}</div> : null}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex flex-wrap justify-between gap-x-3">
      <span className="text-subtle">{label}</span>
      <span className="break-all font-mono">{value}</span>
    </p>
  );
}

function TxLine({ label, hash }: { label: string; hash: string }) {
  return (
    <p className="flex flex-wrap justify-between gap-x-3">
      <span className="text-subtle">{label}</span>
      <a
        href={txUrl(hash)}
        target="_blank"
        rel="noreferrer"
        className="interactive break-all font-mono underline underline-offset-2"
      >
        {hash.slice(0, 16)}…
      </a>
    </p>
  );
}
