/**
 * Deploys all six core contracts to Hedera testnet via raw viem — not
 * `forge script`.
 *
 * `forge script`'s own local EVM (revm) always executes a contract's init
 * code once to build the transaction it broadcasts — there is no way around
 * that step, `--skip-simulation` included, it only skips a secondary
 * liveness check. revm has no implementation of Hedera's HTS precompile
 * (0x167): a real `forge script --broadcast --rpc-url hedera_testnet` run
 * against BountyEscrow/DatasetRegistry/FederatedRound (all three now call
 * the precompile in their constructors — see contracts/src/*.sol) failed
 * locally with `InvalidFEOpcode` before a single real transaction went out,
 * confirmed against the mirror node (nothing broadcast). EntityRegistry/
 * AssetRegistry/EpisodeRegistry, which never touch 0x167, deployed fine
 * through forge in the same run — this is specific to the precompile call,
 * not Hedera generally.
 *
 * The exact fix already exists: `hedera/spike-viem-write.mjs` proved plain
 * viem `deployContract`/`writeContract` works reliably against real Hedera
 * testnet over Hashio. This script is that same proven pattern, reading
 * compiled bytecode/ABI straight from forge's own `out/` directory so the
 * source of truth for what gets deployed is still `forge build`, not a
 * second, hand-copied build step.
 *
 *   cd contracts && node --env-file=.env script/deploy-hedera.mjs
 *
 * `forge script` remains the right tool for any chain without this
 * precompile — Sepolia's fork tests and any future Sepolia redeploy still
 * go through Deploy.s.sol / DeployDatasetsAndFederation.s.sol unchanged.
 */

import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http } from "viem";
import { hederaTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY must be set (see contracts/.env).");

const USDC = "0x0000000000000000000000000000000000068cDa"; // Hedera testnet HTS 0.0.429274

function artifact(contractFile, contractName) {
  const path = new URL(`../out/${contractFile}/${contractName}.json`, import.meta.url);
  const { abi, bytecode } = JSON.parse(readFileSync(path, "utf-8"));
  return { abi, bytecode: bytecode.object };
}

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: hederaTestnet, transport: http() });
const walletClient = createWalletClient({ account, chain: hederaTestnet, transport: http() });

console.log("Deployer:", account.address);
console.log("USDC:    ", USDC);

async function deploy(label, contractFile, contractName, args, gas) {
  const { abi, bytecode } = artifact(contractFile, contractName);
  console.log(`\nDeploying ${label}...`);
  const hash = await walletClient.deployContract({ abi, bytecode, args, gas });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`${label} deploy failed: tx ${hash}, status ${receipt.status}`);
  }
  console.log(`  ${label}: ${receipt.contractAddress} (tx ${hash}, gas used ${receipt.gasUsed})`);
  return { address: receipt.contractAddress, abi };
}

const entities = await deploy("EntityRegistry", "EntityRegistry.sol", "EntityRegistry", [], 1_000_000n);
const assets = await deploy("AssetRegistry", "AssetRegistry.sol", "AssetRegistry", [entities.address], 1_200_000n);
const episodes = await deploy("EpisodeRegistry", "EpisodeRegistry.sol", "EpisodeRegistry", [assets.address], 1_500_000n);
const escrow = await deploy("BountyEscrow", "BountyEscrow.sol", "BountyEscrow", [USDC, episodes.address], 6_000_000n);
const datasets = await deploy(
  "DatasetRegistry",
  "DatasetRegistry.sol",
  "DatasetRegistry",
  [USDC, episodes.address],
  6_000_000n,
);
const federated = await deploy("FederatedRound", "FederatedRound.sol", "FederatedRound", [USDC], 6_000_000n);

console.log("\n=== DEPLOYED ===");
console.log(
  JSON.stringify(
    {
      EntityRegistry: entities.address,
      AssetRegistry: assets.address,
      EpisodeRegistry: episodes.address,
      BountyEscrow: escrow.address,
      DatasetRegistry: datasets.address,
      FederatedRound: federated.address,
    },
    null,
    2,
  ),
);
