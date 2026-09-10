/**
 * Continuation of spike-hts-association.mjs after finding a bug: the real
 * numeric Hedera contract ID (from the mirror node) must be used with
 * TokenAssociateTransaction, not ContractId.fromEvmAddress().toString()
 * (which produces an EVM-address-form ID string TokenAssociateTransaction
 * rejects with INVALID_ACCOUNT_ID — a bug in the spike, not a Hedera limit).
 */
import { createPublicClient, http, erc20Abi } from "viem";
import { hederaTestnet } from "viem/chains";
import {
  Client,
  PrivateKey,
  AccountId,
  TokenAssociateTransaction,
  ContractId,
  TokenId,
} from "@hiero-ledger/sdk";

const ACCOUNT_ID = process.env.HEDERA_ACCOUNT_ID;
const PRIVATE_KEY = process.env.HEDERA_PRIVATE_KEY;
const USDC_TOKEN_ID = "0.0.429274";
const USDC_EVM_ADDRESS = "0x0000000000000000000000000000000000068cda";
const CONTRACT_EVM_ADDRESS = "0x7fbb039bba33bfe82880171a8750279a411fc6bf";

const mirrorRes = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/contracts/${CONTRACT_EVM_ADDRESS}`);
const { contract_id } = await mirrorRes.json();
console.log("Real numeric contract ID (from mirror node):", contract_id);

const hederaClient = Client.forTestnet().setOperator(
  AccountId.fromString(ACCOUNT_ID),
  PrivateKey.fromStringECDSA(PRIVATE_KEY),
);

console.log("\n=== Associating the CONTRACT (correct numeric ID this time) ===");
let ok = false;
try {
  const tx = await new TokenAssociateTransaction()
    .setAccountId(ContractId.fromString(contract_id).toString())
    .setTokenIds([TokenId.fromString(USDC_TOKEN_ID)])
    .execute(hederaClient);
  const receipt = await tx.getReceipt(hederaClient);
  console.log("Contract association status:", receipt.status.toString());
  ok = true;
} catch (err) {
  console.log("Still failed:", err.message);
}

if (ok) {
  const publicClient = createPublicClient({ chain: hederaTestnet, transport: http() });
  const balance = await publicClient.readContract({
    address: USDC_EVM_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [CONTRACT_EVM_ADDRESS],
  });
  console.log("Contract's USDC balance readable post-association:", balance);
}

console.log("\n=== VERDICT (corrected) ===");
console.log("Contract association via EOA-driven SDK call, correct numeric ID:", ok ? "WORKS" : "FAILS");
hederaClient.close();
