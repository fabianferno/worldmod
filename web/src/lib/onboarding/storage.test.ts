import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ONBOARDED_STORAGE, hasOnboarded, markOnboarded } from "./storage";

/**
 * The onboarding "seen" flag: it must round-trip, default to not-seen, and
 * never throw when storage is missing or hostile — a thrown read here would
 * take down the capture screen that gates the auto-tour on it.
 */

class FakeStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
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

describe("onboarding storage", () => {
  it("defaults to not onboarded", () => {
    expect(hasOnboarded()).toBe(false);
  });

  it("marks and reads back as onboarded", () => {
    markOnboarded();
    expect(hasOnboarded()).toBe(true);
    expect(localStorage.getItem(ONBOARDED_STORAGE)).toBe("1");
  });

  it("treats any non-\"1\" value as not onboarded", () => {
    localStorage.setItem(ONBOARDED_STORAGE, "true");
    expect(hasOnboarded()).toBe(false);
  });

  it("does not throw when storage is unavailable", () => {
    useStorage(undefined);
    expect(() => hasOnboarded()).not.toThrow();
    expect(hasOnboarded()).toBe(false);
    expect(() => markOnboarded()).not.toThrow();
  });

  it("does not throw when storage access throws", () => {
    useStorage({
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    } as unknown as Storage);
    expect(hasOnboarded()).toBe(false);
    expect(() => markOnboarded()).not.toThrow();
  });
});
