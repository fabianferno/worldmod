import { beforeEach, describe, expect, it } from "vitest";
import { ImuRecorder, observedRate, requestMotionPermission } from "./imu";

/** A synthetic DeviceMotionEvent, shaped the way a real device delivers one. */
function motionEvent(init: {
  acceleration?: { x: number | null; y: number | null; z: number | null } | null;
  accelerationIncludingGravity?: { x: number | null; y: number | null; z: number | null } | null;
  rotationRate?: { alpha: number | null; beta: number | null; gamma: number | null } | null;
}): Event {
  return Object.assign(new Event("devicemotion"), init);
}

/** A controllable monotonic clock, so rate assertions are exact. */
function clock(stepMs: number) {
  let t = 0;
  return {
    now: () => t,
    advance: () => {
      t += stepMs;
    },
    set: (v: number) => {
      t = v;
    },
  };
}

describe("ImuRecorder", () => {
  let target: EventTarget;

  beforeEach(() => {
    target = new EventTarget();
  });

  function recorder(c = clock(1000 / 60)) {
    return new ImuRecorder({
      target,
      now: c.now,
      epochNow: () => 1786550400123,
      orientation: () => "portrait-primary",
    });
  }

  it("captures samples dispatched while recording", () => {
    const c = clock(1000 / 60);
    const r = recorder(c);
    r.start();

    for (let i = 0; i < 5; i++) {
      target.dispatchEvent(
        motionEvent({
          acceleration: { x: 1, y: 2, z: 3 },
          rotationRate: { alpha: 10, beta: 20, gamma: 30 },
        }),
      );
      c.advance();
    }

    const rec = r.stop();
    expect(rec.samples).toBe(5);
    expect(rec.stream.samples).toHaveLength(5);
    expect(rec.screenOrientation).toBe("portrait-primary");
    expect(rec.stream.startedAtEpochMs).toBe(1786550400123);
  });

  it("maps rotationRate using the declared alpha=z, beta=x, gamma=y convention", () => {
    const r = recorder();
    r.start();
    target.dispatchEvent(
      motionEvent({
        acceleration: { x: 0, y: 0, z: 0 },
        rotationRate: { alpha: 1, beta: 2, gamma: 3 },
      }),
    );
    const [s] = r.stop().stream.samples;

    expect(s.rz).toBe(1); // alpha
    expect(s.rx).toBe(2); // beta
    expect(s.ry).toBe(3); // gamma
  });

  it("ignores events dispatched before start and after stop", () => {
    const r = recorder();
    const evt = () =>
      motionEvent({ acceleration: { x: 1, y: 1, z: 1 }, rotationRate: { alpha: 1, beta: 1, gamma: 1 } });

    target.dispatchEvent(evt());
    r.start();
    target.dispatchEvent(evt());
    const rec = r.stop();
    target.dispatchEvent(evt());

    expect(rec.samples).toBe(1);
  });

  it("prefers linear acceleration and records that it did", () => {
    const r = recorder();
    r.start();
    target.dispatchEvent(
      motionEvent({
        acceleration: { x: 1, y: 2, z: 3 },
        accelerationIncludingGravity: { x: 1, y: 2, z: 12.8 },
        rotationRate: { alpha: 0, beta: 0, gamma: 0 },
      }),
    );
    const rec = r.stop();

    expect(rec.accelSource).toBe("linear");
    expect(rec.stream.samples[0].az).toBe(3);
  });

  it("falls back to gravity-inclusive acceleration and labels the fallback", () => {
    // iOS commonly delivers acceleration as an object with null components.
    const r = recorder();
    r.start();
    target.dispatchEvent(
      motionEvent({
        acceleration: { x: null, y: null, z: null },
        accelerationIncludingGravity: { x: 1, y: 2, z: 9.8 },
        rotationRate: { alpha: 0, beta: 0, gamma: 0 },
      }),
    );
    const rec = r.stop();

    expect(rec.accelSource).toBe("including_gravity");
    expect(rec.stream.samples[0].az).toBeCloseTo(9.8, 5);
  });

  it("records accelSource as absent when the device supplies no acceleration", () => {
    const r = recorder();
    r.start();
    target.dispatchEvent(motionEvent({ rotationRate: { alpha: 1, beta: 2, gamma: 3 } }));
    const rec = r.stop();

    expect(rec.accelSource).toBe("absent");
    expect(rec.stream.samples[0].ax).toBe(0);
    expect(rec.stream.samples[0].rz).toBe(1);
  });

  it("substitutes zero for null components so the codec never sees a NaN", () => {
    const r = recorder();
    r.start();
    target.dispatchEvent(
      motionEvent({
        acceleration: { x: 1, y: null, z: null },
        rotationRate: { alpha: null, beta: null, gamma: null },
      }),
    );
    const [s] = r.stop().stream.samples;

    for (const v of [s.ax, s.ay, s.az, s.rx, s.ry, s.rz]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("measures the actual sample rate rather than assuming 60Hz", () => {
    // A device throttled to 20Hz must report 20Hz.
    const c = clock(50);
    const r = recorder(c);
    r.start();

    for (let i = 0; i < 21; i++) {
      target.dispatchEvent(
        motionEvent({ acceleration: { x: 0, y: 0, z: 0 }, rotationRate: { alpha: 0, beta: 0, gamma: 0 } }),
      );
      c.advance();
    }

    expect(r.stop().rateHzObserved).toBeCloseTo(20, 6);
  });

  it("reports the recording window duration", () => {
    const c = clock(1000 / 60);
    const r = recorder(c);
    r.start();
    c.set(17_200);
    expect(r.stop().durationMs).toBe(17_200);
  });

  it("refuses to start twice or stop when not started", () => {
    const r = recorder();
    r.start();
    expect(() => r.start()).toThrow(/already recording/i);
    r.stop();
    expect(() => r.stop()).toThrow(/not recording/i);
  });

  it("detaches its listener on abort and discards samples", () => {
    const r = recorder();
    r.start();
    target.dispatchEvent(
      motionEvent({ acceleration: { x: 1, y: 1, z: 1 }, rotationRate: { alpha: 1, beta: 1, gamma: 1 } }),
    );
    r.abort();
    expect(r.isRecording).toBe(false);

    // Restarting yields a clean stream rather than resuming the aborted one.
    r.start();
    expect(r.stop().samples).toBe(0);
  });
});

describe("observedRate", () => {
  it("returns zero for fewer than two samples", () => {
    expect(observedRate([])).toBe(0);
    expect(observedRate([{ t: 0, ax: 0, ay: 0, az: 0, rx: 0, ry: 0, rz: 0 }])).toBe(0);
  });

  it("returns zero when every sample shares a timestamp", () => {
    const s = { ax: 0, ay: 0, az: 0, rx: 0, ry: 0, rz: 0 };
    expect(observedRate([{ t: 5, ...s }, { t: 5, ...s }])).toBe(0);
  });
});

describe("requestMotionPermission", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "DeviceMotionEvent");

  function setCtor(value: unknown) {
    Object.defineProperty(globalThis, "DeviceMotionEvent", {
      value,
      configurable: true,
      writable: true,
    });
  }

  function restore() {
    if (original) Object.defineProperty(globalThis, "DeviceMotionEvent", original);
    else delete (globalThis as { DeviceMotionEvent?: unknown }).DeviceMotionEvent;
  }

  it("reports unsupported when the device has no motion events", async () => {
    setCtor(undefined);
    await expect(requestMotionPermission()).resolves.toBe("unsupported");
    restore();
  });

  it("reports not_required on platforms without a permission gate", async () => {
    setCtor(class {});
    await expect(requestMotionPermission()).resolves.toBe("not_required");
    restore();
  });

  it("reports granted when iOS grants", async () => {
    setCtor({ requestPermission: async () => "granted" });
    await expect(requestMotionPermission()).resolves.toBe("granted");
    restore();
  });

  it("reports denied when iOS denies", async () => {
    setCtor({ requestPermission: async () => "denied" });
    await expect(requestMotionPermission()).resolves.toBe("denied");
    restore();
  });

  it("reports denied when iOS rejects for lack of a user gesture", async () => {
    // Calling outside a gesture rejects rather than resolving, and must not
    // surface as an unhandled error mid-capture.
    setCtor({
      requestPermission: async () => {
        throw new Error("requires a user gesture");
      },
    });
    await expect(requestMotionPermission()).resolves.toBe("denied");
    restore();
  });
});
