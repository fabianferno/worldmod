"use client";

/**
 * The buyer-side action T3 asks for: issue a Hedera Bond against a real
 * Sepolia dataset from World Mod's own app, not a script run by hand. Calls
 * /api/hedera/issue-bond, which shells out to an isolated child process —
 * see hedera/scripts/issue-bond-json.mjs and lib/hedera/issue.ts for why
 * that isolation exists (the ATS SDK's window stub cannot run in this app's
 * own server process without corrupting Next.js's SSR checks).
 */

import { useState } from "react";

interface IssuedBond {
  hederaContractId: string;
  evmAddress: string;
  transactionId: string;
  hashscanUrl: string;
}

export function IssueBondButton({ datasetId }: { datasetId: number }) {
  const [state, setState] = useState<"idle" | "issuing" | "done" | "error">("idle");
  const [bond, setBond] = useState<IssuedBond | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setState("issuing");
    setError(null);
    try {
      const response = await fetch("/api/hedera/issue-bond", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ datasetId }),
      });
      const data = (await response.json()) as { bond?: IssuedBond; error?: string };
      if (!response.ok || !data.bond) {
        setError(data.error ?? `Could not issue the bond (HTTP ${response.status}).`);
        setState("error");
        return;
      }
      setBond(data.bond);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }

  if (state === "done" && bond) {
    return (
      <div className="mt-3 rounded-xl border border-positive/25 bg-positive/5 p-3">
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
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => void issue()}
        disabled={state === "issuing"}
        className="interactive rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-white/25 disabled:opacity-40"
      >
        {state === "issuing" ? "Issuing on Hedera…" : "Issue as Hedera Bond"}
      </button>
      {error ? <p className="mt-2 text-xs text-negative">{error}</p> : null}
    </div>
  );
}
