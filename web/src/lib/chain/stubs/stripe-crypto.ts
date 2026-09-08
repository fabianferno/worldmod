/**
 * Stub for @stripe/crypto.
 *
 * Privy imports it to support a fiat on-ramp — buying crypto with a card from
 * inside the wallet UI. Nothing here uses that: a contributor is paid in USDC
 * for recording, and never needs to buy any. The package is an optional
 * dependency Privy does not install, so without this alias the whole capture
 * route fails to resolve and returns a 500.
 *
 * Deliberately a stub rather than an install. Pulling Stripe's SDK into a
 * phone's bundle to satisfy an import for a screen that cannot be reached would
 * cost every contributor the download.
 *
 * If the on-ramp is ever wanted, delete this and install the real package.
 */

function unavailable(): never {
  throw new Error(
    "@stripe/crypto is stubbed: World Mod has no fiat on-ramp. " +
      "Install the package and remove the alias in next.config.ts to enable it.",
  );
}

export const loadStripeOnramp = unavailable;

const stripeCrypto = { loadStripeOnramp };
export default stripeCrypto;
