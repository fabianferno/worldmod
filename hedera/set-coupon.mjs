/**
 * T5: a lifecycle op beyond issuance — set a licence-fee coupon on a real
 * Bond and read it back, proving the mapping isn't a one-shot mint-and-walk-
 * away but a real instrument with a real payout mechanism attached.
 *
 * A World Mod dataset licence, once tokenized as a Bond (dataset-to-bond.mjs),
 * needs a way to actually distribute what it's worth — ATS's `setCoupon` is
 * that mechanism: a snapshot ("recordDate") of who holds the Bond, a rate,
 * and a payout date ("executionDate"). This fixes one for real against an
 * already-issued Bond and reads every field back from the chain, not from
 * the transaction's own return value.
 *
 * Design decision: the coupon period runs from the Bond's own `startingDate`
 * (read back live via GetBondDetailsRequest, not assumed) for 30 days — "one
 * licence term" — at a 5% rate. What this script does NOT attempt: computing
 * an actual USDC payout amount from that rate. `getCouponAmountFor` returns
 * a numerator/denominator pair the ATS contract defines from a holder's
 * balance at the snapshot, not a currency amount — turning that into a real
 * payment is wiring this Bond's coupon to Sepolia's own USDC flow, a further
 * step this exercise doesn't take. What it proves: the lifecycle op itself
 * works, end to end, against a real dataset Bond.
 *
 * A role grant IS needed here, same as T4's KYC roles, discovered the same
 * way: the first attempt against a real Bond reverted, decoded via the
 * mirror node to `AccountNotAssignedToRole(_CORPORATEACTIONS_ROLE, ...)`.
 * The SDK's own Bond.test.js calls `setCoupon` once *without* granting this
 * role first and it passes — misleading if copied at face value; that test's
 * fixture account evidently already holds it from outside the test itself.
 * A real, freshly issued Bond does not hand it to the owner automatically,
 * exactly like `_KYC_ROLE`/`_SSI_MANAGER_ROLE` in T4 — corporate actions are
 * a delegable role, not an owner privilege, and this project's diamond owner
 * starts with none of the delegable roles pre-granted.
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const sdkRoot = join(__dirname, "node_modules/@hashgraph/asset-tokenization-sdk/build/cjs/src");
const req = createRequire(import.meta.url);
const internal = (relativePath) => req(join(sdkRoot, relativePath));

const { default: Injectable } = internal("core/injectable/Injectable.js");
const { RPCTransactionAdapter } = internal("port/out/rpc/RPCTransactionAdapter.js");
const { RPCQueryAdapter } = internal("port/out/rpc/RPCQueryAdapter.js");
const { MirrorNodeAdapter } = internal("port/out/mirror/MirrorNodeAdapter.js");
const { default: NetworkService } = internal("app/service/network/NetworkService.js");
const {
  Network,
  SupportedWallets,
  Bond,
  SetCouponRequest,
  GetCouponRequest,
  GetAllCouponsRequest,
  GetCouponForRequest,
  GetBondDetailsRequest,
  Role,
  RoleRequest,
} = internal("port/in/index.js");
const { default: ConnectRequest } = internal("port/in/request/network/ConnectRequest.js");
const { RateStatus, CastRateStatus } = internal("domain/context/bond/RateStatus.js");
const { SecurityRole } = internal("domain/context/security/SecurityRole.js");

const ACCOUNT_ID = process.env.HEDERA_ACCOUNT_ID;
const PRIVATE_KEY = process.env.HEDERA_PRIVATE_KEY;
if (!ACCOUNT_ID || !PRIVATE_KEY) {
  throw new Error("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY must be set (see hedera/.env).");
}

const securityId = process.argv[2];
if (!securityId) {
  throw new Error(
    "Usage: node --env-file=.env set-coupon.mjs <bondEvmAddress>\n" +
      "  e.g. a Bond issued by issue-dataset-bond.mjs or the app's /b/datasets page.",
  );
}

const FACTORY_ADDRESS = "0.0.7708432";
const RESOLVER_ADDRESS = "0.0.7707874";
const mirrorNode = { name: "hedera-testnet-mirror", baseUrl: "https://testnet.mirrornode.hedera.com/api/v1/" };
const rpcNode = { name: "hashio-testnet", baseUrl: "https://testnet.hashio.io/api" };
const DAY = 24 * 60 * 60;

async function decodedRevertReason(err) {
  const message = err instanceof Error ? err.message : String(err);
  const hashMatch = message.match(/"hash":"(0x[0-9a-f]+)"/);
  if (!hashMatch) return null;
  const res = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${hashMatch[1]}`);
  const data = await res.json();
  return { hash: hashMatch[1], errorMessage: data.error_message, status: data.status };
}

async function run(label, fn) {
  console.log(`\n${label}...`);
  try {
    return await fn();
  } catch (err) {
    const reason = await decodedRevertReason(err).catch(() => null);
    if (reason) console.error("Decoded revert:", reason);
    throw err;
  }
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

const ownEvmAddress = ethers.computeAddress(PRIVATE_KEY);
console.log("Connected as", ACCOUNT_ID, `(${ownEvmAddress})`);
console.log("Bond:", securityId);

// grantRole is not idempotent — regranting an already-held role reverts
// with AccountAssignedToRole (confirmed via the mirror node on a rerun
// against the same Bond) — so check first rather than grant-and-swallow.
const alreadyHasRole = await run("Checking _CORPORATEACTIONS_ROLE", () =>
  Role.hasRole(
    new RoleRequest({ securityId, targetId: ownEvmAddress, role: SecurityRole._CORPORATEACTIONS_ROLE }),
  ),
);
if (alreadyHasRole) {
  console.log("Already held from a previous run — skipping the grant.");
} else {
  await run("Granting _CORPORATEACTIONS_ROLE to self", () =>
    Role.grantRole(
      new RoleRequest({ securityId, targetId: ownEvmAddress, role: SecurityRole._CORPORATEACTIONS_ROLE }),
    ),
  );
}

const bondDetails = await run("Reading the Bond's own starting date", () =>
  Bond.getBondDetails(new GetBondDetailsRequest({ bondId: securityId })),
);
const periodStart = Math.floor(bondDetails.startingDate.getTime() / 1000);
const periodEnd = periodStart + 30 * DAY;

// Every one of these timestamps must be strictly in the future at the
// moment the transaction actually mines, not merely when this script builds
// the request — `ScheduledTasksCommon.onlyValidTimestamp` reverts with
// `WrongTimestamp` otherwise. A `fixingTimestamp` of exactly "now" looked
// right when read from Date.now() here, then landed in the past by the time
// the transaction reached the chain a few seconds later.
const now = Math.floor(Date.now() / 1000);
const rate = "5"; // 5%, this term's licence-fee coupon
const fixingTimestamp = now + 30;
const recordTimestamp = now + 60;
const executionTimestamp = recordTimestamp + 3600;

console.log("\nCoupon terms:");
console.log("  period:   ", new Date(periodStart * 1000).toISOString(), "→", new Date(periodEnd * 1000).toISOString());
console.log("  rate:     ", `${rate}%`);
console.log("  fixed:    ", new Date(fixingTimestamp * 1000).toISOString());
console.log("  record:   ", new Date(recordTimestamp * 1000).toISOString());
console.log("  execution:", new Date(executionTimestamp * 1000).toISOString());

const setResult = await run("Setting the coupon", () =>
  Bond.setCoupon(
    new SetCouponRequest({
      securityId,
      rate,
      recordTimestamp: recordTimestamp.toString(),
      executionTimestamp: executionTimestamp.toString(),
      startTimestamp: periodStart.toString(),
      endTimestamp: periodEnd.toString(),
      fixingTimestamp: fixingTimestamp.toString(),
      rateStatus: CastRateStatus.toNumber(RateStatus.SET),
    }),
  ),
);
console.log("Coupon id:", setResult.payload);
console.log("Set tx:   ", setResult.transactionId);

const coupon = await run("Reading the coupon back", () =>
  Bond.getCoupon(new GetCouponRequest({ securityId, couponId: setResult.payload })),
);
console.log("\n=== READ BACK ===");
console.log("couponId:    ", coupon.couponId);
console.log("rate:        ", coupon.rate, `(${coupon.rateDecimals} decimals)`);
console.log("recordDate:  ", coupon.recordDate.toISOString());
console.log("executionDate:", coupon.executionDate.toISOString());

const all = await run("Confirming it's on the Bond's coupon list", () =>
  Bond.getAllCoupons(new GetAllCouponsRequest({ securityId })),
);
console.log("Total coupons on this Bond:", all.length);

const couponFor = await run("Reading this account's entitlement", () =>
  Bond.getCouponFor(new GetCouponForRequest({ securityId, targetId: ownEvmAddress, couponId: setResult.payload })),
);
console.log("Diamond owner's token balance at this coupon:", couponFor.tokenBalance);
if (couponFor.tokenBalance === "0") {
  console.log(
    "  (0 is correct here, not a bug: numberOfUnits at issuance is a supply CAP, not an initial\n" +
      "   mint — nobody holds units yet. Minting to a real holder is a further step this exercise\n" +
      "   doesn't take.)",
  );
}

console.log("\n=== T5 coupon lifecycle exercise complete ===");
