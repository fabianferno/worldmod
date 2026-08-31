/**
 * Coarse location and device orientation.
 *
 * product-spec §3.1 lists both as [MVP]: GPS at "low precision by default,
 * opt-in", and orientation as the OS's fused estimate.
 *
 * Location is deliberately degraded before it is recorded. A head-mounted
 * camera already captures the inside of someone's home; pairing that with
 * street-level coordinates makes a dataset that can locate a contributor's
 * front door. Rounding happens here, at capture, so full-precision
 * coordinates never enter the manifest, never reach the network, and cannot
 * be recovered from what was published.
 */

/** Degrees of latitude per kilometre, near enough for a privacy floor. */
const DEG_PER_KM = 1 / 111;

export type GeoPrecision = "coarse" | "off";

export interface CoarseLocation {
  /** Latitude rounded to the configured grid. */
  lat: number;
  lon: number;
  /** Size of the grid cell the position was snapped to, kilometres. */
  grid_km: number;
  /** Accuracy the device reported, metres, before rounding. */
  device_accuracy_m: number | null;
}

/**
 * Snap a position to a grid.
 *
 * Longitude degrees shrink toward the poles, so the longitude step is scaled
 * by cos(latitude); rounding both axes by the same amount would give a cell
 * far narrower than intended at high latitudes.
 */
export function coarsen(
  lat: number,
  lon: number,
  gridKm: number,
  accuracyM: number | null = null,
): CoarseLocation {
  const latStep = gridKm * DEG_PER_KM;
  const snappedLat = Math.round(lat / latStep) * latStep;

  // The longitude step is derived from the SNAPPED latitude, not the raw one.
  // Deriving it from the input gave every position a slightly different step,
  // so two points a metre apart landed in different cells and the grid failed
  // to anonymise anything.
  const cos = Math.cos((snappedLat * Math.PI) / 180);
  const lonStep = latStep / Math.max(0.01, Math.abs(cos));

  return {
    lat: snappedLat,
    lon: Math.round(lon / lonStep) * lonStep,
    grid_km: gridKm,
    device_accuracy_m: accuracyM,
  };
}

export interface GeoOptions {
  gridKm?: number;
  timeoutMs?: number;
}

const DEFAULT_GRID_KM = 10;

/**
 * Read a coarse position, or null.
 *
 * Never throws and never blocks capture: location is an enrichment, and an
 * episode without it is worth more than no episode at all.
 */
export async function readCoarseLocation(
  options: GeoOptions = {},
): Promise<CoarseLocation | null> {
  const gridKm = options.gridKm ?? DEFAULT_GRID_KM;
  const timeoutMs = options.timeoutMs ?? 5_000;

  if (!("geolocation" in navigator)) return null;

  return new Promise<CoarseLocation | null>((resolve) => {
    let settled = false;
    const finish = (value: CoarseLocation | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer);
        finish(
          coarsen(
            position.coords.latitude,
            position.coords.longitude,
            gridKm,
            position.coords.accuracy ?? null,
          ),
        );
      },
      () => {
        clearTimeout(timer);
        finish(null);
      },
      // High accuracy is pointless when the result is rounded to kilometres,
      // and it costs battery and time.
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

export interface OrientationSample {
  /** Compass heading, degrees. */
  alpha: number;
  /** Front-to-back tilt, degrees. */
  beta: number;
  /** Left-to-right tilt, degrees. */
  gamma: number;
  /** Whether the platform reported this as absolute rather than relative. */
  absolute: boolean;
}

interface OrientationLike {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  absolute?: boolean;
}

/**
 * Records the OS's fused orientation estimate.
 *
 * Separate from ImuRecorder on purpose: this is a derived attitude estimate,
 * not raw sensor output, and conflating the two would let a consumer treat a
 * filtered value as an independent measurement.
 */
export class OrientationRecorder {
  private readonly target: EventTarget;
  private readonly now: () => number;
  private samples: Array<OrientationSample & { t: number }> = [];
  private t0 = 0;
  private recording = false;

  constructor(target: EventTarget = globalThis, now: () => number = () => performance.now()) {
    this.target = target;
    this.now = now;
  }

  private readonly onOrientation = (event: Event): void => {
    if (!this.recording) return;
    const e = event as unknown as OrientationLike;
    if (e.alpha === null && e.beta === null && e.gamma === null) return;

    this.samples.push({
      t: this.now() - this.t0,
      alpha: e.alpha ?? 0,
      beta: e.beta ?? 0,
      gamma: e.gamma ?? 0,
      absolute: e.absolute === true,
    });
  };

  start(): void {
    this.samples = [];
    this.t0 = this.now();
    this.recording = true;
    this.target.addEventListener("deviceorientation", this.onOrientation);
  }

  stop(): { samples: Array<OrientationSample & { t: number }>; count: number; absolute: boolean } {
    this.target.removeEventListener("deviceorientation", this.onOrientation);
    this.recording = false;

    return {
      samples: this.samples,
      count: this.samples.length,
      absolute: this.samples.some((s) => s.absolute),
    };
  }
}
