export const USDC_DECIMALS = 6;
export const BOND_NOMINAL_DECIMALS = 2;

/**
 * Payout for one holder, in USDC smallest units (6 dp).
 *
 * dollars = unitsHeld × (nominalValueCents / 100) × (ratePercent / 100)
 * usdcSmallest = dollars × 10^6
 *             = unitsHeld × nominalValueCents × ratePercent × 10^4 / 100
 *
 * ratePercent may be fractional (e.g. 0.5), so scale it to an integer
 * basis-points-like factor before doing bigint math, then round half-up on
 * the single final division.
 */
export function couponPayoutUsdcSmallest({ unitsHeld, nominalValueCents, ratePercent }) {
  const units = BigInt(unitsHeld);
  const nominal = BigInt(nominalValueCents);
  // Represent ratePercent with 4 decimal places of precision as an integer.
  const rateScaled = BigInt(Math.round(Number(ratePercent) * 10_000)); // e.g. 5 -> 50000
  const scale = 10n ** BigInt(USDC_DECIMALS - BOND_NOMINAL_DECIMALS); // 10^4
  // numerator = units × nominal × rateScaled × scale
  // denominator = 100 (percent) × 10_000 (rate precision)
  const numerator = units * nominal * rateScaled * scale;
  const denominator = 100n * 10_000n;
  // round half up
  return (numerator + denominator / 2n) / denominator;
}
