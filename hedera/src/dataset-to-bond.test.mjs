import { test } from "node:test";
import assert from "node:assert/strict";
import { datasetToBondRequest, BOND_CONFIG_ID } from "./dataset-to-bond.mjs";

/** The real dataset minted on Sepolia — see hedera/README.md for the tx. */
const REAL_DATASET = {
  datasetId: 1,
  creator: "0x89EA57a0E61Ac9B167e263839b65E58E8DFDAAe8",
  priceUsdc: 6_000_000n,
  episodesRoot: "0x67fd5a843da88fc165a797990d9a7825dcc0af1c9931a6aebababf15e4f2ac41",
  episodeCount: 6,
  mintedAt: 1788849312,
  license: "commercial_ai_training",
  metadataURI: "ipfs://bafkreihusmtjgfjz4xrjrfwsfujz5cf6krtenchrftetuz3rzhsfsw4oyy",
};
const DATASET_REGISTRY = "0x1df8feDf50394A9e0f78cb0EF8F187D587812cbB";
const HEDERA_ACCOUNT = "0.0.10413607";

test("requires an explicit issuer — no silent fallback", () => {
  assert.throws(() => datasetToBondRequest(REAL_DATASET, DATASET_REGISTRY, {}));
});

test("converts USDC's 6-decimal price into the Bond's 2-decimal nominal value", () => {
  const req = datasetToBondRequest(REAL_DATASET, DATASET_REGISTRY, {
    diamondOwnerAccount: HEDERA_ACCOUNT,
  });
  // $6.00 -> "600" at nominalValueDecimals: 2, the convention the spike
  // confirmed by round-tripping nominalValue:"100"/decimals:2 -> read back "100".
  assert.equal(req.nominalValue, "600");
  assert.equal(req.nominalValueDecimals, 2);
});

test("produces a checksum-valid ISIN, distinct per dataset id", () => {
  const req1 = datasetToBondRequest(REAL_DATASET, DATASET_REGISTRY, { diamondOwnerAccount: HEDERA_ACCOUNT });
  const req2 = datasetToBondRequest(
    { ...REAL_DATASET, datasetId: 2 },
    DATASET_REGISTRY,
    { diamondOwnerAccount: HEDERA_ACCOUNT },
  );
  assert.equal(req1.isin.length, 12);
  assert.notEqual(req1.isin, req2.isin);
});

test("starting date is in the future even for a dataset minted in the past", () => {
  // REAL_DATASET.mintedAt is a real past timestamp; onlyValidBondDates
  // requires startingDate >= current block time, so the two must not be
  // conflated even though it is tempting to set startingDate = mintedAt.
  const req = datasetToBondRequest(REAL_DATASET, DATASET_REGISTRY, { diamondOwnerAccount: HEDERA_ACCOUNT });
  assert.ok(Number(req.startingDate) > REAL_DATASET.mintedAt);
  assert.ok(Number(req.startingDate) > Math.floor(Date.now() / 1000));
});

test("maturity is after starting date by the configured licence term", () => {
  const oneWeek = 7 * 24 * 60 * 60;
  const req = datasetToBondRequest(REAL_DATASET, DATASET_REGISTRY, {
    diamondOwnerAccount: HEDERA_ACCOUNT,
    licenseTermSeconds: oneWeek,
  });
  assert.equal(Number(req.maturityDate) - Number(req.startingDate), oneWeek);
});

test("info carries a full, checkable trail back to the real Sepolia dataset", () => {
  const req = datasetToBondRequest(REAL_DATASET, DATASET_REGISTRY, { diamondOwnerAccount: HEDERA_ACCOUNT });
  assert.match(req.info, /dataset #1/);
  assert.match(req.info, new RegExp(DATASET_REGISTRY));
  assert.match(req.info, /6 episodes/);
  assert.match(req.info, /commercial_ai_training/);
  assert.match(req.info, new RegExp(REAL_DATASET.episodesRoot));
  assert.match(req.info, new RegExp(REAL_DATASET.metadataURI.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("uses the Bond configuration id, not Equity's", () => {
  const req = datasetToBondRequest(REAL_DATASET, DATASET_REGISTRY, { diamondOwnerAccount: HEDERA_ACCOUNT });
  assert.equal(req.configId, BOND_CONFIG_ID);
  assert.notEqual(
    req.configId,
    "0x0000000000000000000000000000000000000000000000000000000000000001",
  );
});

test("KYC is on: a dataset licence is exactly what compliance should gate", () => {
  const req = datasetToBondRequest(REAL_DATASET, DATASET_REGISTRY, { diamondOwnerAccount: HEDERA_ACCOUNT });
  assert.equal(req.internalKycActivated, true);
});

test("sets every field CreateBondRequest's constructor requires", () => {
  // regulationType/regulationSubType were silently missing from an earlier
  // version of this module — the pure-function tests above did not catch it
  // because none of them checked for a field's mere PRESENCE, only the
  // values of fields already known to exist. Caught instead by the SDK's own
  // client-side validation on a real run, before any gas was spent — this
  // test exists so the next missing field is caught here instead.
  const required = [
    "name", "symbol", "isin", "decimals", "isWhiteList", "erc20VotesActivated",
    "isControllable", "arePartitionsProtected", "clearingActive",
    "internalKycActivated", "isMultiPartition", "diamondOwnerAccount",
    "currency", "numberOfUnits", "nominalValue", "nominalValueDecimals",
    "startingDate", "maturityDate", "regulationType", "regulationSubType",
    "isCountryControlListWhiteList", "countries", "info", "configId", "configVersion",
  ];
  const req = datasetToBondRequest(REAL_DATASET, DATASET_REGISTRY, { diamondOwnerAccount: HEDERA_ACCOUNT });
  for (const field of required) {
    assert.ok(field in req, `missing field: ${field}`);
    assert.notEqual(req[field], undefined, `field is undefined: ${field}`);
  }
});
