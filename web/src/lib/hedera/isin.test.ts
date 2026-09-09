import { describe, expect, it } from "vitest";
import { isinChecksum, realIsin } from "./isin";

describe("isinChecksum", () => {
  it("matches the on-chain algorithm's own known-good value", () => {
    // "USWMDATASET" + "6" passed onlyValidISIN in a real transaction on
    // Hedera testnet — see hedera/README.md. If this ever drifts from the
    // Solidity it was ported from, this is the test that should catch it
    // before a real transaction burns gas finding out.
    expect(isinChecksum("USWMDATASET")).toBe("6");
    expect(realIsin("USWMDATASET")).toBe("USWMDATASET6");
  });

  it("rejects a base that is not 11 characters", () => {
    expect(() => isinChecksum("TOOSHORT")).toThrow();
    expect(() => isinChecksum("WAYTOOLONGABASE")).toThrow();
  });

  it("is deterministic", () => {
    expect(isinChecksum("USWD0000001")).toBe(isinChecksum("USWD0000001"));
  });

  it("produces different digits for different inputs, not a constant", () => {
    const seen = new Set<string>();
    for (let i = 1; i <= 20; i++) seen.add(isinChecksum(`USWD${String(i).padStart(7, "0")}`));
    expect(seen.size).toBeGreaterThan(1);
  });
});
