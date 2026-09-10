/**
 * Spike B, real test: can a contract associate ITSELF with an HTS token by
 * calling the 0x167 precompile from within its own code — both (a) via a
 * normal post-deploy function call, and (b) from inside its constructor?
 */
import { createPublicClient, createWalletClient, http, erc20Abi } from "viem";
import { hederaTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

const PRIVATE_KEY = process.env.HEDERA_PRIVATE_KEY;
const USDC_EVM_ADDRESS = "0x0000000000000000000000000000000000068cda";

const { abi, bytecode } = JSON.parse(
  readFileSync(new URL("./spike-counter/associating-counter-artifact.json", import.meta.url), "utf-8"),
);

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: hederaTestnet, transport: http() });
const walletClient = createWalletClient({ account, chain: hederaTestnet, transport: http() });

async function checkBalance(address, label) {
  try {
    const bal = await publicClient.readContract({
      address: USDC_EVM_ADDRESS,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    });
    console.log(`  ${label} balanceOf: ${bal} (readable — but note: balanceOf worked even for an UNASSOCIATED EOA earlier, so this alone doesn't prove association; the real proof is the precompile's own response code below)`);
  } catch (err) {
    console.log(`  ${label} balanceOf FAILED:`, err.shortMessage ?? err.message?.slice(0, 150));
  }
}

console.log("=== Case A: post-deploy associate() call ===");
const deployA = await walletClient.deployContract({ abi, bytecode, args: [USDC_EVM_ADDRESS, false] });
const receiptA = await publicClient.waitForTransactionReceipt({ hash: deployA });
console.log("Deployed at:", receiptA.contractAddress, "status:", receiptA.status);

const { request, result: responseCode } = await publicClient.simulateContract({
  account,
  address: receiptA.contractAddress,
  abi,
  functionName: "associate",
  args: [USDC_EVM_ADDRESS],
});
console.log("Simulated associate() response code (22 = SUCCESS):", responseCode);
const associateHash = await walletClient.writeContract(request);
const associateReceipt = await publicClient.waitForTransactionReceipt({ hash: associateHash });
console.log("associate() call on-chain status:", associateReceipt.status);
await checkBalance(receiptA.contractAddress, "Case A contract");

console.log("\n=== Case B: in-constructor self-association ===");
let caseBWorked = null;
try {
  const deployB = await walletClient.deployContract({ abi, bytecode, args: [USDC_EVM_ADDRESS, true] });
  const receiptB = await publicClient.waitForTransactionReceipt({ hash: deployB });
  console.log("Deployed at:", receiptB.contractAddress, "status:", receiptB.status);
  if (receiptB.status === "success") {
    const associatedInConstructor = await publicClient.readContract({
      address: receiptB.contractAddress,
      abi,
      functionName: "associatedInConstructor",
    });
    console.log("associatedInConstructor flag:", associatedInConstructor);
    caseBWorked = associatedInConstructor;
    await checkBalance(receiptB.contractAddress, "Case B contract");
  } else {
    caseBWorked = false;
  }
} catch (err) {
  console.log("Constructor-time association deploy FAILED:", err.shortMessage ?? err.message?.slice(0, 200));
  caseBWorked = false;
}

console.log("\n=== SPIKE B FINAL VERDICT ===");
console.log("Post-deploy associate() call: status", associateReceipt.status, "(check contract's own return code interpretation below)");
console.log("In-constructor self-association worked:", caseBWorked);
