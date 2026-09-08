/**
 * Issue a real ATS Bond on Hedera testnet from a plain Node script, signed by
 * a raw account key — no browser, no MetaMask extension, no custodial service.
 *
 * Working end to end. `npm run spike` deploys a genuine diamond-pattern Bond
 * against Hedera's own maintained testnet factory and reads it back. Verified
 * independently against the mirror node, not just against the SDK's own
 * success response — see hedera/README.md for the transaction and contract
 * IDs from a real run.
 *
 * None of this is documented anywhere. Getting here meant reading the SDK's
 * own source past its public API surface, six separate times over:
 *
 *   1. MODULE RESOLUTION. The SDK's public `exports` map allows exactly one
 *      entry point (`.`). The pieces raw-key signing needs — RPCTransactionAdapter,
 *      Injectable, NetworkService — are internal. They physically exist in the
 *      installed package, so this reaches them by absolute file path instead of
 *      a package specifier, which Node's `exports` restriction does not govern.
 *
 *   2. A `reflect-metadata` POLYFILL the SDK's DI container (tsyringe) requires
 *      but does not document as a consumer prerequisite.
 *
 *   3. CJS, NOT ESM. The SDK's ESM build uses extensionless internal imports
 *      that only a bundler tolerates; Node's own ESM resolver refuses them.
 *      CJS `require()` resolves them the same way a bundler would.
 *
 *   4. A HARD GATE. `TransactionService.getHandlerClass` throws
 *      "Wallet is not allowed" for the METAMASK path unless `Injectable.isWeb()`
 *      — a bare `!!global.window` check — is true. `ConnectRequest`'s
 *      `debug: true` already skips the real browser-detection call further in
 *      (`MetamaskService.register`), so a stub only has to be truthy. A newer
 *      transitive dependency (`@hashgraph/hedera-wallet-connect`) probes deeper
 *      at import time — `window.matchMedia` — so the stub below covers that too.
 *
 *   5. A VERSION MISMATCH, not a parameter bug. `@hashgraph/asset-tokenization-sdk`
 *      latest on npm is 8.0.0 — an explicit breaking rewrite ("Modular Asset
 *      Factory... every resolver key, storage slot... changes... greenfield
 *      redeploy required"). The live testnet factory
 *      (docs/ats/developer-guides/contracts/deployed-addresses.md) is still
 *      "Smart Contract Version: 4.0.0", from before that rewrite. Calling it
 *      with 8.0.0's typechain bindings produced a mined transaction that
 *      reverted with zero revert data at ~39k gas — consistent with a diamond
 *      proxy's fallback failing to match ANY registered selector. Pinning both
 *      `@hashgraph/asset-tokenization-sdk` and `@hashgraph/asset-tokenization-contracts`
 *      to 4.2.0 — the latest release still on the 4.x line — fixed it.
 *
 *   6. THE CONFIG ID. Even with matching versions, `deployBond` reverted with
 *      genuinely empty revert data from BOTH the JSON-RPC relay and Hedera's
 *      own mirror-node simulation endpoint — no decodable reason at all.
 *      `configId: 0x000...000` is not a registered configuration on the live
 *      Business Logic Resolver; `apps/ats/web/.env.example` names the real
 *      ones: `...001` is Equity, `...002` is Bond. The all-zero key I tried
 *      first was ResolverProxy's constructor looking up nothing and failing
 *      before any deployment logic ran — with a nested-CREATE failure mode
 *      that neither Hashio's relay nor Hedera's own mirror node surfaces a
 *      reason for.
 *
 * The one further error the fixed config ID did surface with a real decoded
 * reason: `WrongISINChecksum`. It fired even against the SDK's own test
 * fixture ("ABCDE123456Z") — that literal is not valid on this contract's real
 * checksum algorithm, decoded from the actual custom-error selector via the
 * Factory ABI (`0x342c92db`). A generic textbook ISIN checksum produced a
 * second, still-wrong digit; isinValidator.sol's algorithm has its own
 * bit-level details (letters map to ascii-55, two-digit codes split into
 * separate entries before doubling, and the doubling's starting parity
 * depends on total digit count) that a standard implementation does not
 * reproduce. `isinChecksum()` below is a direct line-for-line port of that
 * Solidity, not a library call.
 */

import "reflect-metadata";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ethers } from "ethers";

/**
 * Satisfies Injectable.isWeb()'s `!!global.window` gate (see header, item 4).
 * matchMedia is stubbed because @hashgraph/hedera-wallet-connect calls it at
 * import time, before this script ever reaches a code path that needs it.
 */
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
/** Reaches past the package's public `exports` map — see header, item 1. */
const internal = (relativePath) => req(join(sdkRoot, relativePath));

const { default: Injectable } = internal("core/injectable/Injectable.js");
const { RPCTransactionAdapter } = internal("port/out/rpc/RPCTransactionAdapter.js");
const { RPCQueryAdapter } = internal("port/out/rpc/RPCQueryAdapter.js");
const { MirrorNodeAdapter } = internal("port/out/mirror/MirrorNodeAdapter.js");
const { default: NetworkService } = internal("app/service/network/NetworkService.js");
const {
  Network,
  Bond,
  SupportedWallets,
  CreateBondRequest,
  GetBondDetailsRequest,
} = internal("port/in/index.js");
const { default: ConnectRequest } = internal("port/in/request/network/ConnectRequest.js");
const { RegulationType, RegulationSubType, CastRegulationType, CastRegulationSubType } = internal(
  "domain/context/factory/RegulationType.js",
);

const ACCOUNT_ID = process.env.HEDERA_ACCOUNT_ID;
const PRIVATE_KEY = process.env.HEDERA_PRIVATE_KEY;
if (!ACCOUNT_ID || !PRIVATE_KEY) {
  throw new Error("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY must be set (see hedera/.env).");
}

// Hedera's own maintained testnet deployment (v4.0.0) — not one this project
// deployed. See docs/ats/developer-guides/contracts/deployed-addresses.md.
const FACTORY_ADDRESS = "0.0.7708432";
const RESOLVER_ADDRESS = "0.0.7707874";
// apps/ats/web/.env.example: REACT_APP_BOND_CONFIG_ID. "...001" is Equity.
const BOND_CONFIG_ID = "0x0000000000000000000000000000000000000000000000000000000000000002";

const mirrorNode = { name: "hedera-testnet-mirror", baseUrl: "https://testnet.mirrornode.hedera.com/api/v1/" };
const rpcNode = { name: "hashio-testnet", baseUrl: "https://testnet.hashio.io/api" };

/**
 * Direct port of isinValidator.sol's `_checkChecksum` (packages/ats/contracts
 * in hashgraph/asset-tokenization-studio) — see header, item 6. Letters map to
 * ascii-55 (A=10..Z=35); values over 9 split into two separate digit entries
 * before summation, not before doubling; the doubling parity is chosen from
 * the total digit count rather than fixed to odd or even position.
 */
function isinChecksum(base11) {
  if (base11.length !== 11) throw new Error("ISIN base must be 11 characters.");

  const byteToCode = (ch) => {
    const code = ch.charCodeAt(0);
    return code > 57 ? code - 55 : code - 48; // '9' is 57
  };

  const conv = [];
  for (const ch of base11) {
    const code = byteToCode(ch);
    if (code > 9) {
      conv.push(Math.floor(code / 10), code % 10);
    } else {
      conv.push(code);
    }
  }

  const pairing = (conv.length + 1) % 2;
  let checksum = 0;
  conv.forEach((digit, index) => {
    const doubled = index % 2 === pairing ? digit * 2 : digit;
    checksum += doubled > 9 ? Math.floor(doubled / 10) + (doubled % 10) : doubled;
  });
  return String((10 - (checksum % 10)) % 10);
}

function realIsin(base11) {
  return base11 + isinChecksum(base11);
}

console.log("Wiring the transaction adapter with a raw-key ethers signer...");

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

console.log("Connected. Issuing a Bond as a stand-in for a World Mod dataset licence...");

const now = Math.floor(Date.now() / 1000);
const startingDate = now + 60;
const maturityDate = startingDate + 365 * 24 * 60 * 60; // 1 year

const request = new CreateBondRequest({
  name: "World Mod Dataset Licence",
  symbol: "WMDL",
  isin: realIsin("USWMDATASET"),
  decimals: 0,
  isWhiteList: false,
  erc20VotesActivated: false,
  isControllable: true,
  arePartitionsProtected: false,
  clearingActive: false,
  internalKycActivated: true,
  isMultiPartition: false,
  diamondOwnerAccount: ACCOUNT_ID,
  currency: "0x555344", // "USD"
  numberOfUnits: "1000",
  nominalValue: "100",
  nominalValueDecimals: 2,
  startingDate: startingDate.toString(),
  maturityDate: maturityDate.toString(),
  regulationType: CastRegulationType.toNumber(RegulationType.REG_S),
  regulationSubType: CastRegulationSubType.toNumber(RegulationSubType.NONE),
  isCountryControlListWhiteList: true,
  countries: "US,GB,IN",
  info: "World Mod: a compliant security token standing in for a licensed dataset's cashflow.",
  configId: BOND_CONFIG_ID,
  configVersion: 1,
});

Injectable.resolveTransactionHandler();

/**
 * Hedera's EVM compatibility layer does not reliably surface a revert reason
 * for a failure inside a nested CREATE (see header, item 6) through either
 * the JSON-RPC relay or the SDK's own error wrapping. The mirror node's
 * `/contracts/results/{hash}` endpoint carries the decoded reason when one
 * exists — this recovers it from whichever transaction hash the SDK's error
 * message happened to log.
 */
async function decodedRevertReason(err) {
  const message = err instanceof Error ? err.message : String(err);
  const hashMatch = message.match(/"hash":"(0x[0-9a-f]+)"/);
  if (!hashMatch) return null;

  const res = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${hashMatch[1]}`);
  const data = await res.json();
  return { hash: hashMatch[1], errorMessage: data.error_message, status: data.status };
}

let result;
try {
  result = await Bond.create(request);
} catch (err) {
  const reason = await decodedRevertReason(err).catch(() => null);
  if (reason) console.error("\nDecoded revert:", reason);
  throw err;
}

console.log("\n=== ISSUED ===");
console.log("Hedera contract ID:", result.security.diamondAddress.toString());
console.log("EVM address:       ", result.security.evmDiamondAddress.toString());
console.log("Transaction ID:    ", result.transactionId);
console.log(`HashScan: https://hashscan.io/testnet/contract/${result.security.evmDiamondAddress.toString()}`);

// Confirm read-after-write against the chain, not just the write's own response.
const details = await Bond.getBondDetails(
  new GetBondDetailsRequest({ bondId: result.security.evmDiamondAddress.toString() }),
);
console.log("\n=== READ BACK ===");
console.log("currency:    ", details.currency);
console.log("nominalValue:", details.nominalValue);
console.log("maturityDate:", details.maturityDate);
