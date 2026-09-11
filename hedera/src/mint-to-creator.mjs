/**
 * The identity bridge, built: mint a dataset's ATS Bond licence seats to the
 * dataset's real `creator` (the EVM address recorded on the registry), so the
 * creator is the actual economic holder of the token that represents their
 * data — not the platform relayer that issued it.
 *
 * Minting is also what gives a coupon (set-coupon.mjs / distribute-coupon.mjs)
 * a non-zero holder to pay: `numberOfUnits` at issuance is only a supply cap,
 * and nothing holds a unit until this runs.
 *
 * The relayer keeps the compliance/admin roles (KYC, corporate actions):
 * economic ownership via holding tokens is a different thing from diamond
 * admin, and the platform needs the latter to run KYC and coupons. What stays
 * unbuilt, honestly: the creator EOA must have a Hedera account / association
 * to *receive USDC* later (distribute-coupon.mjs), and diamond admin is not
 * transferred to them here.
 *
 * KYC precedes the mint deliberately: every Bond carries
 * `internalKycActivated: true`, so issuing units to a non-KYC'd holder
 * reverts. The KYC path (roles, trusted issuer, self-issued Terminal3 VC) is
 * the same one kyc-exercise.mjs proved.
 */

import { EthrDID, createEcdsaCredential } from "@terminal3/ecdsa_vc";
import { DID } from "@terminal3/vc_core";
import { readSepoliaDataset, DATASET_REGISTRY } from "../read-sepolia-dataset.mjs";
import { datasetToBondRequest } from "./dataset-to-bond.mjs";
import { decodedRevertReason } from "./hedera-connect.mjs";

/**
 * @param conn The object returned by hedera-connect.mjs `connect()`:
 *   `{ ports, ownEvmAddress }`.
 * @param opts `{ securityId, datasetId, log }` — `securityId` is the Bond's
 *   EVM address, `datasetId` the registry id whose `creator` receives the
 *   units, `log` an optional line logger (stdout for the CLI, stderr for the
 *   JSON child script).
 * @returns `{ creator, unitsMinted, kycTxId, mintTxId, balanceAfter }`
 */
export async function mintToCreator({ ports, ownEvmAddress }, { securityId, datasetId, log = () => {} }) {
  const { Security, Kyc, Role, SsiManagement, requests, internal } = ports;
  const {
    IssueRequest,
    RoleRequest,
    GrantKycRequest,
    GetKycStatusForRequest,
    AddIssuerRequest,
    GetAccountBalanceRequest,
  } = requests;
  const { SecurityRole } = internal("domain/context/security/SecurityRole.js");
  const { KycStatus } = internal("domain/context/kyc/Kyc.js");

  const PRIVATE_KEY = process.env.HEDERA_PRIVATE_KEY;

  async function runOp(label, fn) {
    log(`${label}...`);
    try {
      return await fn();
    } catch (err) {
      const reason = await decodedRevertReason(err).catch(() => null);
      if (reason) log("Decoded revert:", JSON.stringify(reason));
      throw err;
    }
  }

  // 1. The real dataset and the exact unit count it was issued with. The count
  // comes from the same mapping issuance used (diamondOwnerAccount does not
  // affect numberOfUnits), so it always matches the Bond's own supply cap.
  const dataset = await readSepoliaDataset(datasetId);
  const creator = dataset.creator;
  const bondFields = datasetToBondRequest(dataset, DATASET_REGISTRY, { diamondOwnerAccount: ownEvmAddress });
  const numberOfUnits = bondFields.numberOfUnits; // string, e.g. "100"
  log(`Dataset #${datasetId} creator: ${creator}; minting ${numberOfUnits} seats.`);

  // 2. Relayer roles needed to mint and to administer KYC. grantRole is not
  // idempotent (re-granting reverts AccountAssignedToRole), so check first.
  async function ensureRole(role, name) {
    const has = await runOp(`Checking ${name}`, () =>
      Role.hasRole(new RoleRequest({ securityId, targetId: ownEvmAddress, role })),
    );
    if (has) {
      log(`  ${name} already held.`);
      return;
    }
    await runOp(`Granting ${name} to self`, () =>
      Role.grantRole(new RoleRequest({ securityId, targetId: ownEvmAddress, role })),
    );
  }
  await ensureRole(SecurityRole._ISSUER_ROLE, "_ISSUER_ROLE");
  await ensureRole(SecurityRole._KYC_ROLE, "_KYC_ROLE");
  await ensureRole(SecurityRole._SSI_MANAGER_ROLE, "_SSI_MANAGER_ROLE");

  // 3. Register the relayer as a trusted VC issuer. Re-adding reverts
  // (already an issuer) — that is fine, treat it as satisfied.
  try {
    await runOp("Registering self as a trusted VC issuer", () =>
      SsiManagement.addIssuer(new AddIssuerRequest({ securityId, issuerId: ownEvmAddress })),
    );
  } catch (err) {
    log("  addIssuer skipped (already an issuer):", err instanceof Error ? err.message : String(err));
  }

  // 4. KYC the creator, unless already granted. grantKyc needs a real VC — the
  // ATS command handler verifies it — self-issued the same way kyc-exercise.mjs
  // does (Terminal3 ECDSA VC, no revocation registry, which the production
  // grantKyc path also does not check).
  let kycTxId = null;
  const status = await runOp("Reading creator KYC status", () =>
    Kyc.getKycStatusFor(new GetKycStatusForRequest({ securityId, targetId: creator })),
  );
  if (status === KycStatus.GRANTED) {
    log("  Creator already KYC'd.");
  } else {
    const issuerDid = new EthrDID(PRIVATE_KEY, "hedera-testnet");
    const holderDid = new DID("ethr", creator);
    const vc = await createEcdsaCredential(issuerDid, holderDid, { kyc: "passed" }, ["KycCredential"]);
    const vcBase64 = Buffer.from(JSON.stringify(vc)).toString("base64");
    const grant = await runOp("Granting KYC to creator", () =>
      Kyc.grantKyc(new GrantKycRequest({ securityId, targetId: creator, vcBase64 })),
    );
    kycTxId = grant.transactionId;
    log(`  KYC granted, tx ${kycTxId}`);
  }

  // 5. Mint the seats to the creator.
  const mint = await runOp(`Minting ${numberOfUnits} seats to creator`, () =>
    Security.issue(new IssueRequest({ securityId, amount: String(numberOfUnits), targetId: creator })),
  );
  const mintTxId = mint.transactionId;
  log(`  Minted, tx ${mintTxId}`);

  // 6. Read the balance back from the chain — the proof the creator now holds
  // the units, not the SDK's own return value.
  const bal = await runOp("Reading creator balance back", () =>
    Security.getBalanceOf(new GetAccountBalanceRequest({ securityId, targetId: creator })),
  );
  const balanceAfter = bal.value;
  log(`  Creator balance now: ${balanceAfter}`);

  return { creator, unitsMinted: numberOfUnits, kycTxId, mintTxId, balanceAfter };
}
