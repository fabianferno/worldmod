/**
 * The asset class: a World Mod dataset licence, expressed as an ATS Bond.
 *
 * This is T2 — the mapping from what actually exists on Ethereum Sepolia
 * (DatasetRegistry.Dataset, see contracts/src/DatasetRegistry.sol) to what
 * Hedera's Asset Tokenization Studio needs to issue a compliant security
 * token. Every field below is a specific decision, not a default; the
 * comments are the spec.
 *
 * A Bond, not an Equity: hedera.md's own reasoning holds — a dataset licence
 * is closer to a receivable with a term than to a share of an enterprise.
 * `setCoupon` (T5) is the natural fit for a future licence-fee distribution;
 * Equity's dividend/voting-rights machinery has nothing to attach to here.
 *
 * The identity bridge this once left unbuilt is now built elsewhere: the
 * dataset creator becomes the real holder of the Bond's licence seats via
 * mint-to-creator.mjs (KYC the creator's EVM address, then mint to it).
 * `diamondOwnerAccount` here is still the issuing Hedera account you pass in —
 * it names who holds diamond *admin* (kept with the platform relayer, to run
 * KYC and coupons), which is a separate thing from economic ownership via
 * holding the tokens. What remains: transferring diamond admin to the creator,
 * and onboarding an external creator EOA to a Hedera account so it can receive
 * a USDC coupon payout (see distribute-coupon.mjs's caveat).
 */

import { realIsin } from "./isin.mjs";

/**
 * Reg S: offered outside the US, no SEC registration required — the closest
 * fit for a data-licensing receivable with no US general solicitation, and
 * the same choice the SDK's own integration tests make for a plain test bond.
 * Revisiting this is real securities-law work, not something to default past.
 */
const DEFAULT_REGULATION_TYPE = 1; // RegulationType.REG_S
const DEFAULT_REGULATION_SUBTYPE = 0; // RegulationSubType.NONE

/** apps/ats/web/.env.example: "...001" is Equity, "...002" is Bond. */
export const BOND_CONFIG_ID = "0x0000000000000000000000000000000000000000000000000000000000000002";

/** USDC and this Bond's `currency` are both USD-denominated; no FX involved. */
const USDC_DECIMALS = 6;
const BOND_NOMINAL_DECIMALS = 2; // cents

/**
 * How long a licence issued today stays valid. DatasetRegistry has no
 * expiry of its own — a Sepolia licence, once purchased, does not lapse —
 * so this is a Hedera-side term applied at issuance, not a mirror of
 * anything on-chain. A year is a starting assumption, not a researched one.
 */
const DEFAULT_LICENSE_TERM_SECONDS = 365 * 24 * 60 * 60;

/**
 * Sepolia's `purchaseLicense` has no cap — any number of buyers can each
 * independently license the same dataset. ATS's `numberOfUnits` is a fixed
 * maximum set at issuance, so the two cannot literally mirror each other;
 * this picks a deliberately generous ceiling for how many licence seats the
 * Hedera-side instrument offers, decoupled from Sepolia's own count.
 */
const DEFAULT_MAX_LICENSE_SEATS = 100;

/**
 * @typedef {object} SepoliaDataset
 * One Sepolia `DatasetRegistry.Dataset`, read from the chain, plus the id it
 * was minted under.
 * @property {number|bigint} datasetId
 * @property {string} creator
 * @property {bigint} priceUsdc
 * @property {string} episodesRoot
 * @property {number} episodeCount
 * @property {number|bigint} mintedAt
 * @property {string} license
 * @property {string} metadataURI
 */

/**
 * @param {SepoliaDataset} dataset The real, on-chain Sepolia dataset this Bond represents.
 * @param datasetRegistryAddress Sepolia DatasetRegistry's address — recorded
 *   in `info` so a Bond holder can trace back to it without trusting this
 *   script's own claim of which dataset it corresponds to.
 * @param options.diamondOwnerAccount Hedera account id that issues and
 *   initially owns the Bond. See the identity-bridge note above.
 * @param options.licenseTermSeconds Overrides DEFAULT_LICENSE_TERM_SECONDS.
 * @param options.maxLicenseSeats Overrides DEFAULT_MAX_LICENSE_SEATS.
 */
export function datasetToBondRequest(dataset, datasetRegistryAddress, options = {}) {
  const {
    diamondOwnerAccount,
    licenseTermSeconds = DEFAULT_LICENSE_TERM_SECONDS,
    maxLicenseSeats = DEFAULT_MAX_LICENSE_SEATS,
    countries = "US,GB,IN",
  } = options;

  if (!diamondOwnerAccount) {
    throw new Error("diamondOwnerAccount is required — see the identity-bridge note in this file's header.");
  }

  const datasetId = Number(dataset.datasetId);

  // priceUsdc is USDC's own 6-decimal integer (e.g. 6_000_000 = $6.00).
  // nominalValue is ATS's integer-in-smallest-unit convention, matching
  // BOND_NOMINAL_DECIMALS (cents) rather than USDC_DECIMALS — the spike
  // confirmed this by round-tripping nominalValue:"100" with decimals:2 and
  // reading back exactly "100", not "1.00" or any other representation.
  const priceUsdWhole = Number(dataset.priceUsdc) / 10 ** USDC_DECIMALS;
  const nominalValue = String(Math.round(priceUsdWhole * 10 ** BOND_NOMINAL_DECIMALS));

  const now = Math.floor(Date.now() / 1000);
  // Deliberately "now", not `dataset.mintedAt`: onlyValidBondDates requires
  // startingDate to be at or after the current block time, and a dataset
  // minted in the past would fail that outright. mintedAt is the truth about
  // when the underlying data was bundled; startingDate is when this
  // particular licence instrument becomes active, which can be later.
  const startingDate = now + 60;
  const maturityDate = startingDate + licenseTermSeconds;

  // 11 characters before the check digit: "US" + "WD" + 7-digit dataset id,
  // zero-padded. Not a real ISIN — no registrar issued it — but it has to
  // satisfy the same checksum the contract enforces on any ISIN, real or not.
  const isinBase = `USWD${String(datasetId).padStart(7, "0")}`;

  return {
    name: `World Mod Dataset #${datasetId} Licence`,
    symbol: `WMD${datasetId}`,
    isin: realIsin(isinBase),
    decimals: 0,
    isWhiteList: false,
    erc20VotesActivated: false,
    isControllable: true,
    arePartitionsProtected: false,
    clearingActive: false,
    // On, deliberately: a dataset licence is exactly the kind of transfer
    // T4 wants gated — hedera.md's compliance-controls extra point is meant
    // to run against this asset, not a throwaway one.
    internalKycActivated: true,
    isMultiPartition: false,
    diamondOwnerAccount,
    currency: "0x555344", // "USD"
    numberOfUnits: String(maxLicenseSeats),
    nominalValue,
    nominalValueDecimals: BOND_NOMINAL_DECIMALS,
    startingDate: String(startingDate),
    maturityDate: String(maturityDate),
    regulationType: options.regulationType ?? DEFAULT_REGULATION_TYPE,
    regulationSubType: options.regulationSubType ?? DEFAULT_REGULATION_SUBTYPE,
    isCountryControlListWhiteList: true,
    countries,
    // The traceability contract: chain, registry address, dataset id, and the
    // same content-addressed metadata Sepolia's own metadataURI points at —
    // so a Bond holder can verify this token corresponds to a specific,
    // inspectable bundle of episodes without trusting this script's word for it.
    info:
      `World Mod dataset #${datasetId} on Ethereum Sepolia DatasetRegistry ` +
      `${datasetRegistryAddress} — ${dataset.episodeCount} episodes, ` +
      `${dataset.license}, episodesRoot ${dataset.episodesRoot}, ` +
      `metadata ${dataset.metadataURI}`,
    configId: BOND_CONFIG_ID,
    configVersion: 1,
  };
}
