/**
 * Phase 0 Spike A (migration plan): does plain viem `writeContract` work
 * reliably against Hedera testnet over Hashio (the JSON-RPC relay), the
 * exact pattern web/src/lib/chain/relay.ts needs for the gasless relayer?
 *
 * Every prior Hedera write in this repo went through the Hedera Hashgraph
 * SDK (@hashgraph/asset-tokenization-sdk), never raw viem/JSON-RPC writes.
 * This is the first time that specific path is exercised at all.
 */

import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, decodeErrorResult } from "viem";
import { hederaTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const ACCOUNT_ID = process.env.HEDERA_ACCOUNT_ID;
const PRIVATE_KEY = process.env.HEDERA_PRIVATE_KEY;
if (!ACCOUNT_ID || !PRIVATE_KEY) {
  throw new Error("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY must be set (see hedera/.env).");
}

// Resolves one of the migration plan's open uncertainties: viem/chains DOES
// ship a built-in `hederaTestnet` (id 296, Hashio RPC, HashScan explorer,
// HBAR/18 decimals at the JSON-RPC layer) — no defineChain() needed.

const { abi, bytecode } = JSON.parse(
  readFileSync(new URL("./spike-counter/counter-artifact.json", import.meta.url), "utf-8"),
);

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: hederaTestnet, transport: http() });
const walletClient = createWalletClient({ account, chain: hederaTestnet, transport: http() });

console.log("Account:", account.address);
console.log("\n=== 1. Deploying Counter via viem deployContract ===");

const deployHash = await walletClient.deployContract({ abi, bytecode });
console.log("Deploy tx:", deployHash);
const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
console.log("Status:", deployReceipt.status, "| Contract:", deployReceipt.contractAddress);

if (deployReceipt.status !== "success" || !deployReceipt.contractAddress) {
  throw new Error("Deploy did not succeed — stopping here, this alone is a spike verdict.");
}

const address = deployReceipt.contractAddress;

console.log("\n=== 2. Reading count() before increment ===");
const before = await publicClient.readContract({ address, abi, functionName: "count" });
console.log("count() =", before);

console.log("\n=== 3. Writing increment() via viem writeContract ===");
const incHash = await walletClient.writeContract({ address, abi, functionName: "increment" });
console.log("Increment tx:", incHash);
const incReceipt = await publicClient.waitForTransactionReceipt({ hash: incHash });
console.log("Status:", incReceipt.status);

console.log("\n=== 4. Reading count() after increment ===");
const after = await publicClient.readContract({ address, abi, functionName: "count" });
console.log("count() =", after);

const roundTripOk = incReceipt.status === "success" && after === before + 1n;
console.log("\nROUND-TRIP OK:", roundTripOk);

console.log("\n=== 5. Deliberately triggering a failure (calling with a bad function selector) ===");
try {
  // Call a selector Counter doesn't implement, forcing a real revert path
  // through Hashio, to see whether the error carries a decodable reason.
  await walletClient.writeContract({
    address,
    abi: [{ type: "function", name: "thisFunctionDoesNotExist", inputs: [], outputs: [], stateMutability: "nonpayable" }],
    functionName: "thisFunctionDoesNotExist",
  });
  console.log("Unexpectedly succeeded — no failure to inspect.");
} catch (err) {
  console.log("Caught error. Shape:");
  console.log("  err.name:      ", err.name);
  console.log("  err.shortMessage:", err.shortMessage);
  console.log("  err.message (first 300 chars):", String(err.message).slice(0, 300));
  const cause = err.cause;
  console.log("  err.cause?.name:", cause?.name);
  console.log("  err.cause?.data:", cause?.data ?? "(none)");
  if (cause?.data) {
    try {
      const decoded = decodeErrorResult({ abi, data: cause.data });
      console.log("  Decoded revert:", decoded);
    } catch {
      console.log("  Revert data present but not ABI-decodable with Counter's own ABI (expected, wrong selector).");
    }
  } else {
    console.log("  No revert data at all — EMPTY REVERT DATA CONFIRMED for plain viem writes over Hashio.");
  }
}

console.log("\n=== SPIKE A VERDICT ===");
console.log("Contract address:", address);
console.log("Round-trip write+read reliable:", roundTripOk);
