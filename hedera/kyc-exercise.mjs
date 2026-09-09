/**
 * T4: exercise KYC/compliance for real against a real second account — not
 * just the `internalKycActivated: true` flag every Bond above already
 * carries, but actually granting, checking, and revoking it on-chain.
 *
 * Every Bond T2/T3 issue has `internalKycActivated: true`. That only turns
 * the check ON; nothing so far has ever granted an account KYC status or
 * queried it. This script does, against a real already-issued Bond:
 *
 *   1. Grants this project's own account `_SSI_MANAGER_ROLE` and
 *      `_KYC_ROLE` on the Bond — the diamond owner does NOT hold these
 *      automatically (confirmed by reading the SDK's own Kyc.test.js: even
 *      the diamond's own creator grants itself both roles before it can act).
 *   2. Registers that same account as a trusted VC issuer via
 *      `SsiManagement.addIssuer` — `grantKyc`'s on-chain check
 *      (`ValidationService.checkIssuer`) rejects a credential from anyone
 *      not on this list, checked against the chain, not the SDK's say-so.
 *   3. Self-issues a Verifiable Credential (Terminal3's ECDSA VC format,
 *      `@terminal3/ecdsa_vc` — a real transitive dependency of the SDK
 *      itself, pulled in because `grantKyc`'s command handler imports
 *      `@terminal3/verify_vc` to check one) for a freshly generated,
 *      never-before-seen account — proof this isn't reusing a fixture.
 *   4. Grants KYC on-chain, reads the status back (GRANTED), reads the full
 *      KYC record back (issuer, validity window, credential id), then
 *      revokes it and reads the status back again (NOT_GRANTED) — the same
 *      "grant and revoke" lifecycle the SDK's own integration test exercises,
 *      run here against a real dataset Bond instead of a disposable fixture.
 *
 * What creating the VC does NOT need, and deliberately skips: a revocation
 * registry contract. `createEcdsaCredential`'s `options` argument (revocation
 * registry address, DID registry address, a provider) is only used to stamp
 * `credentialStatus` metadata into the VC for LATER revocation-registry
 * lookups; `verifyVc(vc)` as `grantKyc`'s own command handler calls it — with
 * no `options` — never reaches that branch (confirmed by reading
 * `@terminal3/verify_vc_core`'s `verifyVcNonSpecificPart`: the revocation
 * check is gated behind `options.revocationRegistryAddress` being present).
 * Passing none is not a shortcut around a real check; it's exactly what the
 * production code path checks or doesn't.
 */

import "reflect-metadata";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ethers } from "ethers";
import { EthrDID } from "@terminal3/ecdsa_vc";
import { createEcdsaCredential } from "@terminal3/ecdsa_vc";
import { DID } from "@terminal3/vc_core";

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
  Role,
  RoleRequest,
  SsiManagement,
  AddIssuerRequest,
  Kyc,
  GrantKycRequest,
  RevokeKycRequest,
  GetKycStatusForRequest,
  GetKycForRequest,
} = internal("port/in/index.js");
const { default: ConnectRequest } = internal("port/in/request/network/ConnectRequest.js");
const { SecurityRole } = internal("domain/context/security/SecurityRole.js");
const { KycStatus } = internal("domain/context/kyc/Kyc.js");

const ACCOUNT_ID = process.env.HEDERA_ACCOUNT_ID;
const PRIVATE_KEY = process.env.HEDERA_PRIVATE_KEY;
if (!ACCOUNT_ID || !PRIVATE_KEY) {
  throw new Error("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY must be set (see hedera/.env).");
}

const securityId = process.argv[2];
if (!securityId) {
  throw new Error(
    "Usage: node --env-file=.env kyc-exercise.mjs <bondEvmAddress>\n" +
      "  e.g. a Bond issued by issue-dataset-bond.mjs or the app's /b/datasets page.",
  );
}

const FACTORY_ADDRESS = "0.0.7708432";
const RESOLVER_ADDRESS = "0.0.7707874";
const mirrorNode = { name: "hedera-testnet-mirror", baseUrl: "https://testnet.mirrornode.hedera.com/api/v1/" };
const rpcNode = { name: "hashio-testnet", baseUrl: "https://testnet.hashio.io/api" };

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

await run("Granting _SSI_MANAGER_ROLE to self", () =>
  Role.grantRole(
    new RoleRequest({ securityId, targetId: ownEvmAddress, role: SecurityRole._SSI_MANAGER_ROLE }),
  ),
);
await run("Granting _KYC_ROLE to self", () =>
  Role.grantRole(new RoleRequest({ securityId, targetId: ownEvmAddress, role: SecurityRole._KYC_ROLE })),
);
await run("Registering self as a trusted VC issuer", () =>
  SsiManagement.addIssuer(new AddIssuerRequest({ securityId, issuerId: ownEvmAddress })),
);

// A freshly generated account — never seen by this Bond, never funded. KYC
// status is a contract-side list entry keyed by EVM address; nothing about
// granting or checking it requires the target to already exist on Hedera.
const target = ethers.Wallet.createRandom();
console.log("\nTarget account (freshly generated, not the issuer):", target.address);

const issuerDid = new EthrDID(PRIVATE_KEY, "hedera-testnet");
const holderDid = new DID("ethr", target.address);
const vc = await createEcdsaCredential(issuerDid, holderDid, { kyc: "passed" }, ["KycCredential"]);
const vcBase64 = Buffer.from(JSON.stringify(vc)).toString("base64");
console.log("Self-issued VC id:", vc.id);

const grantResult = await run("Granting KYC", () =>
  Kyc.grantKyc(new GrantKycRequest({ securityId, targetId: target.address, vcBase64 })),
);
console.log("Grant tx:", grantResult.transactionId);

const statusAfterGrant = await run("Reading KYC status back", () =>
  Kyc.getKycStatusFor(new GetKycStatusForRequest({ securityId, targetId: target.address })),
);
const statusName = (s) => (s === KycStatus.GRANTED ? "GRANTED" : "NOT_GRANTED");
console.log("Status after grant:", statusName(statusAfterGrant));
if (statusAfterGrant !== KycStatus.GRANTED) {
  throw new Error(`Expected GRANTED after grantKyc, chain says ${statusName(statusAfterGrant)}.`);
}

const record = await run("Reading the full KYC record back", () =>
  Kyc.getKycFor(new GetKycForRequest({ securityId, targetId: target.address })),
);
console.log("KYC record:", {
  vcId: record.vcId,
  issuer: record.issuer,
  validFrom: record.validFrom,
  validTo: record.validTo,
  status: statusName(record.status),
});

const revokeResult = await run("Revoking KYC", () =>
  Kyc.revokeKyc(new RevokeKycRequest({ securityId, targetId: target.address })),
);
console.log("Revoke tx:", revokeResult.transactionId);

const statusAfterRevoke = await run("Reading KYC status back again", () =>
  Kyc.getKycStatusFor(new GetKycStatusForRequest({ securityId, targetId: target.address })),
);
console.log("Status after revoke:", statusName(statusAfterRevoke));
if (statusAfterRevoke !== KycStatus.NOT_GRANTED) {
  throw new Error(`Expected NOT_GRANTED after revokeKyc, chain says ${statusName(statusAfterRevoke)}.`);
}

console.log("\n=== T4 KYC exercise complete: grant, check, and revoke all confirmed on-chain ===");
