/**
 * Same connection and issuance path as issue-dataset-bond.mjs, restructured
 * for machine consumption: the ONLY thing on stdout is one line of JSON, on
 * success or failure. Everything else goes to stderr.
 *
 * Exists to be spawned as a child process — see web/src/lib/hedera/issue.ts.
 * The window stub this needs (see spike-issue-bond.mjs's header, item 4) is
 * process-wide and permanent for the life of whatever process sets it. That
 * is harmless here, in a process that runs once and exits. It is not
 * harmless inside Next.js's own long-lived server process: React and
 * Next.js check `typeof window` throughout their own internals to decide
 * server-vs-client behaviour, and setting a fake one broke server rendering
 * for the whole app until the dev server was restarted — found by trying it
 * the direct way first and watching /c 500 a moment later. This script is
 * the fix: isolate the SDK's global mutation to a process Next.js never
 * touches directly.
 *
 *     node scripts/issue-bond-json.mjs <datasetId> <datasetJson>
 */

import "reflect-metadata";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ethers } from "ethers";

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

function fail(message) {
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");
const sdkRoot = join(packageRoot, "node_modules/@hashgraph/asset-tokenization-sdk/build/cjs/src");
const req = createRequire(join(sdkRoot, "package.json"));
const internal = (relativePath) => req(join(sdkRoot, relativePath));

const { default: Injectable } = internal("core/injectable/Injectable.js");
const { RPCTransactionAdapter } = internal("port/out/rpc/RPCTransactionAdapter.js");
const { RPCQueryAdapter } = internal("port/out/rpc/RPCQueryAdapter.js");
const { MirrorNodeAdapter } = internal("port/out/mirror/MirrorNodeAdapter.js");
const { default: NetworkService } = internal("app/service/network/NetworkService.js");
const { Network, Bond, SupportedWallets, CreateBondRequest } = internal("port/in/index.js");
const { default: ConnectRequest } = internal("port/in/request/network/ConnectRequest.js");

const { datasetToBondRequest } = await import(join(packageRoot, "src/dataset-to-bond.mjs"));

const ACCOUNT_ID = process.env.HEDERA_ACCOUNT_ID;
const PRIVATE_KEY = process.env.HEDERA_PRIVATE_KEY;
if (!ACCOUNT_ID || !PRIVATE_KEY) fail("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY are not set.");

const datasetRegistryAddress = process.argv[2];
let dataset;
try {
  dataset = JSON.parse(process.argv[3]);
  dataset.priceUsdc = BigInt(dataset.priceUsdc);
} catch {
  fail("Second argument must be a JSON-encoded SepoliaDataset (priceUsdc as a string).");
}

const FACTORY_ADDRESS = "0.0.7708432";
const RESOLVER_ADDRESS = "0.0.7707874";
const mirrorNode = { name: "hedera-testnet-mirror", baseUrl: "https://testnet.mirrornode.hedera.com/api/v1/" };
const rpcNode = { name: "hashio-testnet", baseUrl: "https://testnet.hashio.io/api" };

try {
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

  const bondFields = datasetToBondRequest(dataset, datasetRegistryAddress, { diamondOwnerAccount: ACCOUNT_ID });
  const result = await Bond.create(new CreateBondRequest(bondFields));
  const evmAddress = result.security.evmDiamondAddress.toString();

  console.log(
    JSON.stringify({
      ok: true,
      hederaContractId: result.security.diamondAddress.toString(),
      evmAddress,
      transactionId: result.transactionId,
      hashscanUrl: `https://hashscan.io/testnet/contract/${evmAddress}`,
    }),
  );
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
