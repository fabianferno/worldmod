import { beforeEach, describe, expect, it } from "vitest";
import { coarsen, OrientationRecorder } from "./geo";

/** London, to a metre. */
const LAT = 51.507351;
const LON = -0.127758;

describe("coarsen", () => {
  it("snaps a position to the grid", () => {
    const result = coarsen(LAT, LON, 10);
    expect(result.grid_km).toBe(10);
    expect(Math.abs(result.lat - LAT)).toBeLessThan(0.09);
  });

  it("destroys street-level precision", () => {
    // The point of the whole module: a head-mounted camera already sees inside
    // someone's home, and full-precision coordinates would locate their door.
    const a = coarsen(LAT, LON, 10);
    const b = coarsen(LAT + 0.001, LON + 0.001, 10);
    expect(a).toEqual(b);
  });

  it("still distinguishes places further apart than the grid", () => {
    const london = coarsen(LAT, LON, 10);
    const oxford = coarsen(51.752, -1.2577, 10);
    expect(london.lat === oxford.lat && london.lon === oxford.lon).toBe(false);
  });

  it("scales the longitude step by latitude", () => {
    // Longitude degrees shrink toward the poles; rounding both axes equally
    // would give a far narrower cell than intended at high latitude.
    const equator = coarsen(0, 10, 10);
    const arctic = coarsen(70, 10, 10);

    const equatorStep = Math.abs(equator.lon - coarsen(0, 10.05, 10).lon);
    const arcticStep = Math.abs(arctic.lon - coarsen(70, 10.15, 10).lon);
    expect(arcticStep).toBeGreaterThanOrEqual(equatorStep);
  });

  it("does not divide by zero at the pole", () => {
    const result = coarsen(90, 10, 10);
    expect(Number.isFinite(result.lat)).toBe(true);
    expect(Number.isFinite(result.lon)).toBe(true);
  });

  it("keeps the device's own accuracy for the record", () => {
    expect(coarsen(LAT, LON, 10, 12.5).device_accuracy_m).toBe(12.5);
    expect(coarsen(LAT, LON, 10).device_accuracy_m).toBeNull();
  });

  it("uses a finer grid when asked", () => {
    const coarse = coarsen(LAT, LON, 10);
    const fine = coarsen(LAT, LON, 1);
    expect(Math.abs(fine.lat - LAT)).toBeLessThanOrEqual(Math.abs(coarse.lat - LAT) + 1e-9);
  });
});

describe("OrientationRecorder", () => {
  let target: EventTarget;

  function event(init: Partial<{ alpha: number | null; beta: number | null; gamma: number | null; absolute: boolean }>) {
    return Object.assign(new Event("deviceorientation"), {
      alpha: null,
      beta: null,
      gamma: null,
      ...init,
    });
  }

  beforeEach(() => {
    target = new EventTarget();
  });

  it("captures samples while recording", () => {
    const recorder = new OrientationRecorder(target, () => 0);
    recorder.start();
    target.dispatchEvent(event({ alpha: 90, beta: 10, gamma: -5, absolute: true }));
    const result = recorder.stop();

    expect(result.count).toBe(1);
    expect(result.samples[0]).toMatchObject({ alpha: 90, beta: 10, gamma: -5 });
    expect(result.absolute).toBe(true);
  });

  it("ignores events before start and after stop", () => {
    const recorder = new OrientationRecorder(target, () => 0);
    target.dispatchEvent(event({ alpha: 1 }));
    recorder.start();
    target.dispatchEvent(event({ alpha: 2 }));
    const result = recorder.stop();
    target.dispatchEvent(event({ alpha: 3 }));

    expect(result.count).toBe(1);
  });

  it("drops events with no orientation at all", () => {
    // Some platforms fire an empty event before the sensor settles.
    const recorder = new OrientationRecorder(target, () => 0);
    recorder.start();
    target.dispatchEvent(event({}));
    expect(recorder.stop().count).toBe(0);
  });

  it("reports relative orientation as not absolute", () => {
    const recorder = new OrientationRecorder(target, () => 0);
    recorder.start();
    target.dispatchEvent(event({ alpha: 45, beta: 0, gamma: 0, absolute: false }));
    expect(recorder.stop().absolute).toBe(false);
  });

  it("starts a clean recording each time", () => {
    const recorder = new OrientationRecorder(target, () => 0);
    recorder.start();
    target.dispatchEvent(event({ alpha: 1 }));
    recorder.stop();

    recorder.start();
    expect(recorder.stop().count).toBe(0);
  });
});
