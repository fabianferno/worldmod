/**
 * The real bridge: read a dataset live from Ethereum Sepolia, map it through
 * T2's asset-class definition (src/dataset-to-bond.mjs), and issue it as a
 * compliant ATS Bond on Hedera testnet.
 *
 * Everything below the mapping call is spike-issue-bond.mjs's already-proven
 * connection and signing path — see that file's header for the six root
 * causes that took to get there. This file's own new ground is entirely in
 * src/dataset-to-bond.mjs: what the fields mean, not how to get a
 * transaction to Hedera at all.
 *
 *     node --env-file=.env issue-dataset-bond.mjs <datasetId>
 */

import "reflect-metadata";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ethers } from "ethers";
import { readSepoliaDataset, DATASET_REGISTRY } from "./read-sepolia-dataset.mjs";
import { datasetToBondRequest } from "./src/dataset-to-bond.mjs";

globalThis.window ??= {
  matchMedia: () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }),
  addEventListener() {},
  removeEventListener() {},
  navigator: { userAgent: "node" },
  document: { createElement: () => ({}), getElementsByTagName: () => [] },
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const sdkRoot = join(__dirname, "node_modules/@hashgraph/asset-tokenization-sdk/build/cjs/src");
const req = createRequire(import.meta.url);
const internal = (relativePath) => req(join(sdkRoot, relativePath));

const { default: Injectable } = internal("core/injectable/Injectable.js");
const { RPCTransactionAdapter } = internal("port/out/rpc/RPCTransactionAdapter.js");
const { RPCQueryAdapter } = internal("port/out/rpc/RPCQueryAdapter.js");
const { MirrorNodeAdapter } = internal("port/out/mirror/MirrorNodeAdapter.js");
const { default: NetworkService } = internal("app/service/network/NetworkService.js");
const { Network, Bond, SupportedWallets, CreateBondRequest, GetBondDetailsRequest } = internal("port/in/index.js");
const { default: ConnectRequest } = internal("port/in/request/network/ConnectRequest.js");

const ACCOUNT_ID = process.env.HEDERA_ACCOUNT_ID;
const PRIVATE_KEY = process.env.HEDERA_PRIVATE_KEY;
if (!ACCOUNT_ID || !PRIVATE_KEY) {
  throw new Error("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY must be set (see hedera/.env).");
}

const FACTORY_ADDRESS = "0.0.7708432";
const RESOLVER_ADDRESS = "0.0.7707874";
const mirrorNode = { name: "hedera-testnet-mirror", baseUrl: "https://testnet.mirrornode.hedera.com/api/v1/" };
const rpcNode = { name: "hashio-testnet", baseUrl: "https://testnet.hashio.io/api" };

const datasetId = Number(process.argv[2] ?? 1);

console.log(`Reading dataset #${datasetId} from Sepolia's DatasetRegistry (${DATASET_REGISTRY})...`);
const dataset = await readSepoliaDataset(datasetId);
console.log("  episodes:      ", dataset.episodeCount);
console.log("  license:       ", dataset.license);
console.log("  priceUsdc:     ", dataset.priceUsdc.toString());
console.log("  episodesRoot:  ", dataset.episodesRoot);
console.log("  metadataURI:   ", dataset.metadataURI);

const bondFields = datasetToBondRequest(dataset, DATASET_REGISTRY, {
  diamondOwnerAccount: ACCOUNT_ID,
});
console.log("\nMapped to Bond:");
console.log("  name:  ", bondFields.name);
console.log("  isin:  ", bondFields.isin);
console.log("  price: $" + (Number(bondFields.nominalValue) / 100).toFixed(2));

console.log("\nWiring the transaction adapter with a raw-key ethers signer...");
const mirrorNodeAdapter = Injectable.resolve(MirrorNodeAdapter);
mirrorNodeAdapter.set(mirrorNode);

const transactionHandler = Injectable.resolve(RPCTransactionAdapter);
const networkService = Injectable.resolve(NetworkService);
const rpcQueryAdapter = Injectable.resolve(RPCQueryAdapter);

rpcQueryAdapter.init();
networkService.environment = "testnet";
networkService.configuration = { factoryAddress: FACTORY_ADDRESS, resolverAddress: RESOLVER_ADDRESS };
networkService.mirrorNode = mirrorNode;
networkService.rpcNode = rpcNode;

await transactionHandler.init(true);
const provider = new ethers.JsonRpcProvider(rpcNode.baseUrl);
transactionHandler.setSignerOrProvider(new ethers.Wallet(PRIVATE_KEY, provider));

console.log("Connecting...");
await Network.connect(
  new ConnectRequest({
    account: { accountId: ACCOUNT_ID, privateKey: { key: PRIVATE_KEY, type: "ECDSA" } },
    network: "testnet",
    wallet: SupportedWallets.METAMASK,
    mirrorNode,
    rpcNode,
    debug: true,
  }),
);

Injectable.resolveTransactionHandler();

console.log("Issuing...");
const result = await Bond.create(new CreateBondRequest(bondFields));

console.log("\n=== ISSUED ===");
console.log("Hedera contract ID:", result.security.diamondAddress.toString());
console.log("EVM address:       ", result.security.evmDiamondAddress.toString());
console.log("Transaction ID:    ", result.transactionId);
console.log(`HashScan: https://hashscan.io/testnet/contract/${result.security.evmDiamondAddress.toString()}`);

const details = await Bond.getBondDetails(
  new GetBondDetailsRequest({ bondId: result.security.evmDiamondAddress.toString() }),
);
console.log("\n=== READ BACK FROM HEDERA ===");
console.log("nominalValue:", details.nominalValue);
console.log("maturityDate:", details.maturityDate);

console.log("\n=== THE FULL BRIDGE ===");
console.log(`Sepolia dataset  #${datasetId}  ${DATASET_REGISTRY}`);
console.log(`Hedera bond      ${result.security.evmDiamondAddress.toString()}`);
console.log("Both point at the same episodesRoot and the same pinned metadata:");
console.log(" ", dataset.metadataURI);
