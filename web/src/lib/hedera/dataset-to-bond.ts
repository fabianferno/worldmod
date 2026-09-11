/**
 * The asset class: a World Mod dataset licence, expressed as an ATS Bond.
 *
 * The mapping from what `DatasetRegistry.Dataset` records on-chain (see
 * contracts/src/DatasetRegistry.sol — deployed to Ethereum Sepolia
 * originally, migrated to Hedera testnet, see hedera/README.md's "one
 * registry, two token layers") to what Hedera's Asset Tokenization Studio
 * needs to issue a compliant security token. Every field is a specific
 * decision, not a default; the comments are the spec. Proven against a real
 * dataset before this port existed — see hedera/README.md.
 *
 * A Bond, not an Equity: a dataset licence is closer to a receivable with a
 * term than to a share of an enterprise. `setCoupon` is the natural fit for
 * a future licence-fee distribution; Equity's dividend/voting-rights
 * machinery has nothing to attach to here.
 *
 * The identity bridge this once left unbuilt is now built: the dataset's
 * `creator` (an EVM address) becomes the real holder of the Bond's licence
 * seats via mint-to-creator (KYC the creator, then mint to it).
 * `diamondOwnerAccount` is still the issuing Hedera account passed in — it
 * names who holds diamond *admin* (kept with the platform relayer, to run KYC
 * and coupons), a separate thing from economic ownership via holding the
 * tokens. What remains: transferring diamond admin to the creator, and
 * onboarding an external creator EOA to a Hedera account so it can *receive* a
 * USDC coupon payout (see distribute-coupon.ts's caveat).
 */

import { CHAIN } from "@/lib/chain/config";
import { realIsin } from "./isin";

/** apps/ats/web/.env.example: "...001" is Equity, "...002" is Bond. */
export const BOND_CONFIG_ID = "0x0000000000000000000000000000000000000000000000000000000000000002";

/** USDC and this Bond's `currency` are both USD-denominated; no FX involved. */
const USDC_DECIMALS = 6;
const BOND_NOMINAL_DECIMALS = 2; // cents

/**
 * How long a licence issued today stays valid. DatasetRegistry has no
 * expiry of its own — a registry licence, once purchased, does not lapse —
 * so this is a Hedera-side term applied at issuance, not a mirror of
 * anything on-chain. A year is a starting assumption, not a researched one.
 */
const DEFAULT_LICENSE_TERM_SECONDS = 365 * 24 * 60 * 60;

/**
 * The registry's `purchaseLicense` has no cap — any number of buyers can
 * each independently license the same dataset. ATS's `numberOfUnits` is a
 * fixed maximum set at issuance, so the two cannot literally mirror each
 * other; this picks a deliberately generous ceiling for how many licence
 * seats the Hedera-side instrument offers, decoupled from the registry's
 * own count.
 */
const DEFAULT_MAX_LICENSE_SEATS = 100;

const DEFAULT_REGULATION_TYPE = 1; // RegulationType.REG_S
const DEFAULT_REGULATION_SUBTYPE = 0; // RegulationSubType.NONE

/** One `DatasetRegistry.Dataset`, read live from whichever chain it's on. */
export interface RegistryDataset {
  datasetId: number | bigint;
  creator: string;
  priceUsdc: bigint;
  episodesRoot: string;
  episodeCount: number;
  mintedAt: number | bigint;
  license: string;
  metadataURI: string;
}

export interface BondMappingOptions {
  /** Hedera account id that issues and initially owns the Bond. */
  diamondOwnerAccount: string;
  licenseTermSeconds?: number;
  maxLicenseSeats?: number;
  countries?: string;
  regulationType?: number;
  regulationSubType?: number;
}

/** Plain fields for the ATS SDK's `CreateBondRequest` constructor. */
export interface BondFields {
  name: string;
  symbol: string;
  isin: string;
  decimals: number;
  isWhiteList: boolean;
  erc20VotesActivated: boolean;
  isControllable: boolean;
  arePartitionsProtected: boolean;
  clearingActive: boolean;
  internalKycActivated: boolean;
  isMultiPartition: boolean;
  diamondOwnerAccount: string;
  currency: string;
  numberOfUnits: string;
  nominalValue: string;
  nominalValueDecimals: number;
  startingDate: string;
  maturityDate: string;
  regulationType: number;
  regulationSubType: number;
  isCountryControlListWhiteList: boolean;
  countries: string;
  info: string;
  configId: string;
  configVersion: number;
}

/**
 * @param dataset The real, on-chain registry dataset this Bond represents.
 * @param datasetRegistryAddress DatasetRegistry's address on whichever chain
 *   it's currently deployed to — recorded in `info` so a Bond holder can
 *   trace back to it without trusting this module's own claim of which
 *   dataset it corresponds to.
 */
export function datasetToBondRequest(
  dataset: RegistryDataset,
  datasetRegistryAddress: string,
  options: BondMappingOptions,
): BondFields {
  const {
    diamondOwnerAccount,
    licenseTermSeconds = DEFAULT_LICENSE_TERM_SECONDS,
    maxLicenseSeats = DEFAULT_MAX_LICENSE_SEATS,
    countries = "US,GB,IN",
    regulationType = DEFAULT_REGULATION_TYPE,
    regulationSubType = DEFAULT_REGULATION_SUBTYPE,
  } = options;

  if (!diamondOwnerAccount) {
    throw new Error("diamondOwnerAccount is required — see the identity-bridge note in this file's header.");
  }

  const datasetId = Number(dataset.datasetId);

  // priceUsdc is USDC's own 6-decimal integer (e.g. 6_000_000 = $6.00).
  // nominalValue is ATS's integer-in-smallest-unit convention, matching
  // BOND_NOMINAL_DECIMALS (cents) rather than USDC_DECIMALS — confirmed by
  // round-tripping nominalValue:"100" with decimals:2 against a real
  // deployment and reading back exactly "100", not "1.00".
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
    // compliance is meant to gate.
    internalKycActivated: true,
    isMultiPartition: false,
    diamondOwnerAccount,
    currency: "0x555344", // "USD"
    numberOfUnits: String(maxLicenseSeats),
    nominalValue,
    nominalValueDecimals: BOND_NOMINAL_DECIMALS,
    startingDate: String(startingDate),
    maturityDate: String(maturityDate),
    regulationType,
    regulationSubType,
    isCountryControlListWhiteList: true,
    countries,
    // The traceability contract: chain, registry address, dataset id, and the
    // same content-addressed metadata the registry's own metadataURI points
    // at — so a Bond holder can verify this token corresponds to a specific,
    // inspectable bundle of episodes without trusting this module's word for it.
    info:
      `World Mod dataset #${datasetId} on ${CHAIN.name} DatasetRegistry ` +
      `${datasetRegistryAddress} — ${dataset.episodeCount} episodes, ` +
      `${dataset.license}, episodesRoot ${dataset.episodesRoot}, ` +
      `metadata ${dataset.metadataURI}`,
    configId: BOND_CONFIG_ID,
    configVersion: 1,
  };
}
