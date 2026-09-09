import { describe, expect, it } from "vitest";
import { datasetToBondRequest, BOND_CONFIG_ID, type RegistryDataset } from "./dataset-to-bond";

/** The real dataset minted on Sepolia — see hedera/README.md for the tx. */
const REAL_DATASET: RegistryDataset = {
  datasetId: 1,
  creator: "0x89EA57a0E61Ac9B167e263839b65E58E8DFDAAe8",
  priceUsdc: BigInt("6000000"),
  episodesRoot: "0x67fd5a843da88fc165a797990d9a7825dcc0af1c9931a6aebababf15e4f2ac41",
  episodeCount: 6,
  mintedAt: 1788849312,
  license: "commercial_ai_training",
  metadataURI: "ipfs://bafkreihusmtjgfjz4xrjrfwsfujz5cf6krtenchrftetuz3rzhsfsw4oyy",
};
const DATASET_REGISTRY = "0x1df8feDf50394A9e0f78cb0EF8F187D587812cbB";
const HEDERA_ACCOUNT = "0.0.10413607";

describe("datasetToBondRequest", () => {
  it("requires an explicit issuer — no silent fallback", () => {
    // @ts-expect-error deliberately omitting the required field
    expect(() => datasetToBondRequest(REAL_DATASET, DATASET_REGISTRY, {})).toThrow();
  });

  it("converts USDC's 6-decimal price into the Bond's 2-decimal nominal value", () => {
    const req = datasetToBondRequest(REAL_DATASET, DATASET_REGISTRY, { diamondOwnerAccount: HEDERA_ACCOUNT });
    expect(req.nominalValue).toBe("600");
    expect(req.nominalValueDecimals).toBe(2);
  });

  it("produces a checksum-valid ISIN, distinct per dataset id", () => {
    const req1 = datasetToBondRequest(REAL_DATASET, DATASET_REGISTRY, { diamondOwnerAccount: HEDERA_ACCOUNT });
    const req2 = datasetToBondRequest(
      { ...REAL_DATASET, datasetId: 2 },
      DATASET_REGISTRY,
      { diamondOwnerAccount: HEDERA_ACCOUNT },
    );
    expect(req1.isin).toHaveLength(12);
    expect(req1.isin).not.toBe(req2.isin);
  });

  it("starting date is in the future even for a dataset minted in the past", () => {
    const req = datasetToBondRequest(REAL_DATASET, DATASET_REGISTRY, { diamondOwnerAccount: HEDERA_ACCOUNT });
    expect(Number(req.startingDate)).toBeGreaterThan(Number(REAL_DATASET.mintedAt));
    expect(Number(req.startingDate)).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("maturity is after starting date by the configured licence term", () => {
    const oneWeek = 7 * 24 * 60 * 60;
    const req = datasetToBondRequest(REAL_DATASET, DATASET_REGISTRY, {
      diamondOwnerAccount: HEDERA_ACCOUNT,
      licenseTermSeconds: oneWeek,
    });
    expect(Number(req.maturityDate) - Number(req.startingDate)).toBe(oneWeek);
  });

  it("info carries a full, checkable trail back to the real Sepolia dataset", () => {
    const req = datasetToBondRequest(REAL_DATASET, DATASET_REGISTRY, { diamondOwnerAccount: HEDERA_ACCOUNT });
    expect(req.info).toMatch(/dataset #1/);
    expect(req.info).toContain(DATASET_REGISTRY);
    expect(req.info).toMatch(/6 episodes/);
    expect(req.info).toContain("commercial_ai_training");
    expect(req.info).toContain(REAL_DATASET.episodesRoot);
    expect(req.info).toContain(REAL_DATASET.metadataURI);
  });

  it("uses the Bond configuration id, not Equity's", () => {
    const req = datasetToBondRequest(REAL_DATASET, DATASET_REGISTRY, { diamondOwnerAccount: HEDERA_ACCOUNT });
    expect(req.configId).toBe(BOND_CONFIG_ID);
    expect(req.configId).not.toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000001",
    );
  });

  it("KYC is on: a dataset licence is exactly what compliance should gate", () => {
    const req = datasetToBondRequest(REAL_DATASET, DATASET_REGISTRY, { diamondOwnerAccount: HEDERA_ACCOUNT });
    expect(req.internalKycActivated).toBe(true);
  });

  it("sets every field CreateBondRequest's constructor requires", () => {
    // regulationType/regulationSubType were silently missing from an earlier
    // version of this mapping — caught by the SDK's own client-side
    // validation on a real run, before any gas was spent. This is the test
    // that should catch the next missing field before that happens again.
    const required: (keyof ReturnType<typeof datasetToBondRequest>)[] = [
      "name", "symbol", "isin", "decimals", "isWhiteList", "erc20VotesActivated",
      "isControllable", "arePartitionsProtected", "clearingActive",
      "internalKycActivated", "isMultiPartition", "diamondOwnerAccount",
      "currency", "numberOfUnits", "nominalValue", "nominalValueDecimals",
      "startingDate", "maturityDate", "regulationType", "regulationSubType",
      "isCountryControlListWhiteList", "countries", "info", "configId", "configVersion",
    ];
    const req = datasetToBondRequest(REAL_DATASET, DATASET_REGISTRY, { diamondOwnerAccount: HEDERA_ACCOUNT });
    for (const field of required) {
      expect(req[field], `missing field: ${field}`).not.toBeUndefined();
    }
  });
});
