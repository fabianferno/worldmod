/**
 * Phase 0 Spike B (migration plan): HTS USDC association mechanics,
 * specifically the load-bearing case — can a Solidity CONTRACT (not just an
 * EOA) hold real Hedera testnet USDC (0.0.429274, an HTS token, not a plain
 * ERC-20)? BountyEscrow/DatasetRegistry/FederatedRound all take custody of
 * USDC via `transferFrom(msg.sender, address(this), amount)` — the contract
 * itself is a token holder, which HTS gates behind "association."
 */

import { createPublicClient, createWalletClient, http, erc20Abi } from "viem";
import { hederaTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  Client,
  PrivateKey,
  AccountId,
  TokenAssociateTransaction,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  ContractId,
  TokenId,
} from "@hiero-ledger/sdk";

const ACCOUNT_ID = process.env.HEDERA_ACCOUNT_ID;
const PRIVATE_KEY = process.env.HEDERA_PRIVATE_KEY;
if (!ACCOUNT_ID || !PRIVATE_KEY) {
  throw new Error("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY must be set (see hedera/.env).");
}

const USDC_TOKEN_ID = "0.0.429274";
// The mirror node doesn't expose the token's own EVM address directly, but
// HTS's rule is deterministic: a token 0.0.X's "long-zero" EVM address is
// 0x00...00 followed by X in hex, 20 bytes total.
function longZeroAddress(num) {
  return "0x" + num.toString(16).padStart(40, "0");
}
const USDC_EVM_ADDRESS = longZeroAddress(429274);
console.log("USDC EVM address (derived):", USDC_EVM_ADDRESS);

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: hederaTestnet, transport: http() });
const walletClient = createWalletClient({ account, chain: hederaTestnet, transport: http() });

const hederaClient = Client.forTestnet().setOperator(
  AccountId.fromString(ACCOUNT_ID),
  PrivateKey.fromStringECDSA(PRIVATE_KEY),
);

console.log("\n=== 1. Confirming my own account is NOT associated with USDC yet ===");
try {
  const balance = await publicClient.readContract({
    address: USDC_EVM_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log("balanceOf succeeded without association:", balance, "(unexpected if association is enforced)");
} catch (err) {
  console.log("balanceOf failed as expected pre-association:", err.shortMessage ?? err.message?.slice(0, 200));
}

console.log("\n=== 2. Associating MY OWN account with USDC (EOA case) ===");
const myAssociateTx = await new TokenAssociateTransaction()
  .setAccountId(AccountId.fromString(ACCOUNT_ID))
  .setTokenIds([TokenId.fromString(USDC_TOKEN_ID)])
  .execute(hederaClient);
const myAssociateReceipt = await myAssociateTx.getReceipt(hederaClient);
console.log("My account association status:", myAssociateReceipt.status.toString());

console.log("\n=== 3. Reading my USDC balance now (should succeed, expect 0) ===");
const myBalance = await publicClient.readContract({
  address: USDC_EVM_ADDRESS,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [account.address],
});
console.log("My USDC balance:", myBalance, "(6 decimals)");

console.log("\n=== 4. Deploying a fresh Counter contract to test CONTRACT-held association ===");
const { readFileSync } = await import("node:fs");
const { abi: counterAbi, bytecode } = JSON.parse(
  readFileSync(new URL("./spike-counter/counter-artifact.json", import.meta.url), "utf-8"),
);
const deployHash = await walletClient.deployContract({ abi: counterAbi, bytecode });
const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
const contractAddress = deployReceipt.contractAddress;
console.log("Fresh Counter deployed at:", contractAddress);

console.log("\n=== 5. Associating the CONTRACT's address with USDC, via an EOA-driven call ===");
// TokenAssociateTransaction's accountId can be any account ID, including a
// contract's — Hedera contract addresses map 1:1 to a contract account ID.
// This tests whether an EOA (using the SDK) can associate a contract it
// does NOT own/control any special permission over, purely by address.
const contractAccountId = ContractId.fromEvmAddress(0, 0, contractAddress).toString();
console.log("Contract as Hedera account/contract ID:", contractAccountId);

let contractAssociateWorked = false;
try {
  const contractAssociateTx = await new TokenAssociateTransaction()
    .setAccountId(contractAccountId)
    .setTokenIds([TokenId.fromString(USDC_TOKEN_ID)])
    .execute(hederaClient);
  const contractAssociateReceipt = await contractAssociateTx.getReceipt(hederaClient);
  console.log("Contract association status:", contractAssociateReceipt.status.toString());
  contractAssociateWorked = true;
} catch (err) {
  console.log("Contract association via EOA-driven SDK call FAILED:", err.message);
}

console.log("\n=== 6. Reading the contract's USDC balance (proves it can now hold USDC) ===");
if (contractAssociateWorked) {
  const contractBalance = await publicClient.readContract({
    address: USDC_EVM_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [contractAddress],
  });
  console.log("Contract's USDC balance:", contractBalance, "(6 decimals) — reading succeeded, association confirmed.");
} else {
  console.log("Skipped — association failed, contract cannot hold USDC via this method.");
}

console.log("\n=== SPIKE B VERDICT ===");
console.log("EOA self-association: WORKS (TokenAssociateTransaction via Hedera SDK)");
console.log("Contract association via EOA-driven SDK call (post-deploy, not in constructor):", contractAssociateWorked ? "WORKS" : "FAILS");
console.log("USDC token EVM address:", USDC_EVM_ADDRESS);
