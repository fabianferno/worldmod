import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  WORLD_APP_ADDRESS_STORAGE,
  clearWorldAppAddress,
  loadWorldAppAddress,
  saveWorldAppAddress,
  subscribeWorldAppAddress,
} from "./world-app-store";

/**
 * The persistence behind a World App sign-in surviving a reload.
 *
 * Only a public address is kept — signing still re-prompts in World App per
 * action — so the contract this guards is narrow: a valid address round-trips,
 * garbage is ignored rather than trusted, and unavailable storage never throws
 * into the render that reads it.
 */

const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678" as const;

class FakeStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

function useStorage(storage: Storage | undefined) {
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => useStorage(new FakeStorage() as unknown as Storage));
afterEach(() => useStorage(undefined));

describe("world-app-store", () => {
  it("round-trips a saved address", () => {
    saveWorldAppAddress(ADDRESS);
    expect(loadWorldAppAddress()).toBe(ADDRESS);
  });

  it("returns null when nothing is saved", () => {
    expect(loadWorldAppAddress()).toBeNull();
  });

  it("clear removes a saved address", () => {
    saveWorldAppAddress(ADDRESS);
    clearWorldAppAddress();
    expect(loadWorldAppAddress()).toBeNull();
  });

  it("ignores a malformed stored value rather than trusting it", () => {
    localStorage.setItem(WORLD_APP_ADDRESS_STORAGE, "not-an-address");
    expect(loadWorldAppAddress()).toBeNull();
  });

  it("notifies subscribers on save and clear, and stops after unsubscribe", () => {
    let calls = 0;
    const unsubscribe = subscribeWorldAppAddress(() => calls++);

    saveWorldAppAddress(ADDRESS);
    clearWorldAppAddress();
    expect(calls).toBe(2);

    unsubscribe();
    saveWorldAppAddress(ADDRESS);
    expect(calls).toBe(2);
  });

  it("survives storage being unavailable", () => {
    useStorage(undefined);
    expect(() => loadWorldAppAddress()).not.toThrow();
    expect(loadWorldAppAddress()).toBeNull();
    expect(() => saveWorldAppAddress(ADDRESS)).not.toThrow();
    expect(() => clearWorldAppAddress()).not.toThrow();
  });

  it("survives storage throwing on access", () => {
    useStorage({
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
      removeItem() {
        throw new Error("denied");
      },
    } as unknown as Storage);
    expect(() => loadWorldAppAddress()).not.toThrow();
    expect(loadWorldAppAddress()).toBeNull();
    expect(() => saveWorldAppAddress(ADDRESS)).not.toThrow();
    expect(() => clearWorldAppAddress()).not.toThrow();
  });
});
