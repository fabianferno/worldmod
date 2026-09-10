import "reflect-metadata";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ethers } from "ethers";

globalThis.window ??= {
  matchMedia: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {}, removeEventListener() {},
  navigator: { userAgent: "node" },
  document: { createElement: () => ({}), getElementsByTagName: () => [] },
};

export const FACTORY_ADDRESS = "0.0.7708432";
export const RESOLVER_ADDRESS = "0.0.7707874";
export const USDC_TOKEN_ID = "0.0.429274";
export const mirrorNode = { name: "hedera-testnet-mirror", baseUrl: "https://testnet.mirrornode.hedera.com/api/v1/" };
export const rpcNode = { name: "hashio-testnet", baseUrl: "https://testnet.hashio.io/api" };

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/ -> ../node_modules
const sdkRoot = join(__dirname, "..", "node_modules/@hashgraph/asset-tokenization-sdk/build/cjs/src");
const req = createRequire(join(sdkRoot, "package.json"));
const internal = (p) => req(join(sdkRoot, p));

export async function decodedRevertReason(err) {
  const message = err instanceof Error ? err.message : String(err);
  const hashMatch = message.match(/"hash":"(0x[0-9a-f]+)"/);
  if (!hashMatch) return null;
  const res = await fetch(`${mirrorNode.baseUrl}contracts/results/${hashMatch[1]}`);
  const data = await res.json();
  return { hash: hashMatch[1], errorMessage: data.error_message, status: data.status };
}

export async function connect() {
  const ACCOUNT_ID = process.env.HEDERA_ACCOUNT_ID;
  const PRIVATE_KEY = process.env.HEDERA_PRIVATE_KEY;
  if (!ACCOUNT_ID || !PRIVATE_KEY) throw new Error("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY must be set.");

  const { default: Injectable } = internal("core/injectable/Injectable.js");
  const { RPCTransactionAdapter } = internal("port/out/rpc/RPCTransactionAdapter.js");
  const { RPCQueryAdapter } = internal("port/out/rpc/RPCQueryAdapter.js");
  const { MirrorNodeAdapter } = internal("port/out/mirror/MirrorNodeAdapter.js");
  const { default: NetworkService } = internal("app/service/network/NetworkService.js");
  const requests = internal("port/in/index.js");
  const { default: ConnectRequest } = internal("port/in/request/network/ConnectRequest.js");
  const { Network, SupportedWallets } = requests;

  Injectable.resolve(MirrorNodeAdapter).set(mirrorNode);
  const transactionHandler = Injectable.resolve(RPCTransactionAdapter);
  const networkService = Injectable.resolve(NetworkService);
  Injectable.resolve(RPCQueryAdapter).init();
  networkService.environment = "testnet";
  networkService.configuration = { factoryAddress: FACTORY_ADDRESS, resolverAddress: RESOLVER_ADDRESS };
  networkService.mirrorNode = mirrorNode;
  networkService.rpcNode = rpcNode;

  await transactionHandler.init(true);
  const provider = new ethers.JsonRpcProvider(rpcNode.baseUrl);
  transactionHandler.setSignerOrProvider(new ethers.Wallet(PRIVATE_KEY, provider));

  await Network.connect(new ConnectRequest({
    account: { accountId: ACCOUNT_ID, privateKey: { key: PRIVATE_KEY, type: "ECDSA" } },
    network: "testnet", wallet: SupportedWallets.METAMASK, mirrorNode, rpcNode, debug: true,
  }));
  Injectable.resolveTransactionHandler();

  return {
    ports: {
      Network, Bond: requests.Bond, Security: requests.Security, Kyc: requests.Kyc,
      Role: requests.Role, SsiManagement: requests.SsiManagement, requests, internal,
    },
    ownEvmAddress: ethers.computeAddress(PRIVATE_KEY),
    provider,
  };
}
