import { test } from "node:test";
import assert from "node:assert/strict";
import { isinChecksum, realIsin } from "./isin.mjs";

test("matches the on-chain algorithm's own known-good value", () => {
  // Confirmed against isinValidator.sol by running the real transaction:
  // "USWMDATASET" + "6" passed onlyValidISIN on Hedera testnet (see
  // hedera/README.md). If this checksum function ever drifts from the
  // Solidity it was ported from, this is the test that should catch it
  // before a real transaction burns gas finding out.
  assert.equal(isinChecksum("USWMDATASET"), "6");
  assert.equal(realIsin("USWMDATASET"), "USWMDATASET6");
});

test("rejects a base that is not 11 characters", () => {
  assert.throws(() => isinChecksum("TOOSHORT"));
  assert.throws(() => isinChecksum("WAYTOOLONGABASE"));
});

test("is deterministic", () => {
  assert.equal(isinChecksum("USWD0000001"), isinChecksum("USWD0000001"));
});

test("produces different digits for different inputs (not a constant)", () => {
  const seen = new Set();
  for (let i = 1; i <= 20; i++) {
    seen.add(isinChecksum(`USWD${String(i).padStart(7, "0")}`));
  }
  assert.ok(seen.size > 1, "checksum should vary across different dataset ids");
});
