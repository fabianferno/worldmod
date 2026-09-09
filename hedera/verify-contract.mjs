/**
 * T6: verify a real deployed Bond on Sourcify — the registry HashScan's own
 * "Verified" badge reads from — for real, not just by linking a raw address.
 *
 * Every Bond this project has issued is `ResolverProxy.sol`, Hedera's own
 * shared ATS diamond-proxy implementation (`@hashgraph/asset-tokenization-
 * contracts`) — code this project didn't write, but nobody had verified on
 * this network before: `sourcify.dev`'s own lookup returns `match: null` for
 * every one of our deployed Bond addresses until this script runs.
 *
 * What made this nontrivial: the published npm package ships the Solidity
 * sources but — being a package, not the original monorepo — none of the
 * `hardhat.config`, `build-info`, or a pinned solc binary that would say
 * exactly which compiler and settings built the deployed bytecode. Recovered
 * the same way T1's config ID and ISIN checksum were: read what's actually
 * on chain. The deployed runtime bytecode's own trailing metadata CBOR
 * encodes the exact compiler tag (`solc 0.8.28`), and its opcode usage
 * (`PUSH0`, EIP-3855) narrows the EVM target to Shanghai or later. Compiling
 * the full resolved import tree with solc 0.8.28, default optimizer
 * (`enabled: true, runs: 200`), `evmVersion: "shanghai"` reproduced the real
 * on-chain runtime bytecode exactly — byte for byte outside the trailing
 * metadata hash, which differs only because this compiles the same sources
 * from different file paths than the original deployment did — on the
 * first attempt.
 *
 * The import tree needed three packages the installed SDK dependency does
 * NOT ship: `@openzeppelin/contracts`, `@onchain-id/solidity`, and
 * `@tokenysolutions/t-rex` are devDependencies of
 * `@hashgraph/asset-tokenization-contracts`, present at its own build time
 * but never installed as part of consuming it as a library. `package.json`
 * here lists them (pinned to the exact versions that package's own
 * package.json specifies) as devDependencies so `npm install` reproduces
 * this without extra steps.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "node_modules/@hashgraph/asset-tokenization-contracts");
const CONTRACTS_ROOT = join(PKG_ROOT, "contracts");
const NODE_MODULES = join(PKG_ROOT, "node_modules");
const HEDERA_NODE_MODULES = join(__dirname, "node_modules");

const ENTRY = "contracts/resolver/resolverProxy/ResolverProxy.sol";
const CONTRACT_IDENTIFIER = "contracts/resolver/resolverProxy/ResolverProxy.sol:ResolverProxy";
const HEDERA_TESTNET_CHAIN_ID = 296;

const address = process.argv[2];
const creationTxHash = process.argv[3];
if (!address) {
  throw new Error(
    "Usage: node verify-contract.mjs <bondEvmAddress> [creationTransactionHash]\n" +
      "  Verifies a deployed Bond's ResolverProxy source on Sourcify (Hedera testnet, chain 296).",
  );
}

function resolveImportPath(importPath, fromFile) {
  if (importPath.startsWith(".")) {
    return normalize(join(dirname(fromFile), importPath));
  }
  for (const base of [PKG_ROOT, NODE_MODULES, HEDERA_NODE_MODULES]) {
    const candidate = join(base, importPath);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Cannot resolve import "${importPath}" from ${fromFile}`);
}

function keyFor(absPath) {
  if (absPath.startsWith(CONTRACTS_ROOT)) return "contracts" + absPath.slice(CONTRACTS_ROOT.length);
  if (absPath.startsWith(NODE_MODULES)) return absPath.slice(NODE_MODULES.length + 1);
  if (absPath.startsWith(HEDERA_NODE_MODULES)) return absPath.slice(HEDERA_NODE_MODULES.length + 1);
  throw new Error(`Unrecognized root for ${absPath}`);
}

const sources = {};
const visited = new Set();
function gather(absPath) {
  if (visited.has(absPath)) return;
  visited.add(absPath);
  if (!existsSync(absPath)) throw new Error(`Missing file: ${absPath}`);
  const content = readFileSync(absPath, "utf-8");
  sources[keyFor(absPath)] = content;
  const importRe = /import\s+(?:\{[^}]*\}\s+from\s+)?["']([^"']+)["']/g;
  let m;
  while ((m = importRe.exec(content))) gather(resolveImportPath(m[1], absPath));
}

console.log("Resolving the ResolverProxy import tree...");
gather(join(PKG_ROOT, ENTRY));
console.log(`  ${Object.keys(sources).length} source files.`);

const stdJsonInput = {
  language: "Solidity",
  sources: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, { content: v }])),
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: false,
    evmVersion: "shanghai",
    outputSelection: { "*": { "*": ["evm.deployedBytecode.object"] } },
  },
};

console.log("Compiling locally with solc", solc.version(), "to confirm a match before submitting...");
const output = JSON.parse(solc.compile(JSON.stringify(stdJsonInput)));
const errors = (output.errors || []).filter((e) => e.severity === "error");
if (errors.length > 0) {
  console.error("Compile errors:");
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}
const candidate = output.contracts[CONTRACT_IDENTIFIER.split(":")[0]].ResolverProxy.evm.deployedBytecode.object;

const mirrorRes = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/contracts/${address}`);
const mirrorData = await mirrorRes.json();
const real = mirrorData.runtime_bytecode.replace(/^0x/, "");

function stripMetadata(hex) {
  const len = parseInt(hex.slice(-4), 16);
  return hex.slice(0, hex.length - 4 - len * 2);
}
const localMatch = stripMetadata(candidate) === stripMetadata(real);
console.log("Local bytecode match (ignoring metadata hash):", localMatch);
if (!localMatch) {
  console.error("Not a match locally — refusing to submit a verification that won't succeed.");
  process.exit(1);
}

console.log("Submitting to Sourcify (Hedera testnet, chain 296)...");
const body = {
  stdJsonInput: { ...stdJsonInput, settings: { ...stdJsonInput.settings, outputSelection: undefined } },
  compilerVersion: "0.8.28+commit.7893614a",
  contractIdentifier: CONTRACT_IDENTIFIER,
  ...(creationTxHash ? { creationTransactionHash: creationTxHash } : {}),
};
const submitRes = await fetch(`https://sourcify.dev/server/v2/verify/${HEDERA_TESTNET_CHAIN_ID}/${address}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const submitData = await submitRes.json();
if (submitRes.status !== 202) {
  console.error("Submission failed:", submitRes.status, submitData);
  process.exit(1);
}
console.log("Queued, verificationId:", submitData.verificationId);

async function poll() {
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`https://sourcify.dev/server/v2/verify/${submitData.verificationId}`);
    const data = await res.json();
    if (data.isJobCompleted) return data;
  }
  throw new Error("Timed out waiting for Sourcify to finish.");
}
const result = await poll();
console.log("\n=== RESULT ===");
console.log("runtimeMatch: ", result.contract.runtimeMatch);
console.log("creationMatch:", result.contract.creationMatch);
console.log(`HashScan: https://hashscan.io/testnet/contract/${address}`);
console.log(`Sourcify: https://repo.sourcify.dev/${HEDERA_TESTNET_CHAIN_ID}/${address}/`);
