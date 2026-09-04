"use client";

/**
 * The two traces, overlaid.
 *
 * product-spec §6.3 asks for exactly this picture, and demo scene 3 turns on
 * it: for a genuine head-mounted take the optical flow and the gyroscope trace
 * each other; for a screen replay they wander independently. The percentage
 * beside it is a claim, and this is the evidence someone can check without
 * taking the claim on trust.
 *
 * Drawn as an inline SVG rather than with a charting library: two polylines
 * over a fixed viewBox is less code than the import, and it keeps a page a
 * judge will open on a phone free of a 100KB dependency.
 */

import { useEffect, useState } from "react";

interface Trace {
  t: number;
  flowYaw: number;
  gyroYaw: number;
  flowPitch: number;
  gyroPitch: number;
}

const W = 640;
const H = 120;

function path(values: number[]): string {
  if (values.length < 2) return "";
  const step = W / (values.length - 1);
  // Values arrive scaled to [-1, 1]; map to the box with a little headroom.
  return values
    .map((v, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(H / 2 - v * (H / 2 - 6)).toFixed(1)}`)
    .join(" ");
}

function Axis({
  label,
  flow,
  gyro,
}: {
  label: string;
  flow: number[];
  gyro: number[];
}) {
  return (
    <figure className="mt-3">
      <figcaption className="flex items-baseline justify-between text-xs text-subtle">
        <span>{label}</span>
        <span className="flex gap-3">
          <span className="text-accent">optical flow</span>
          <span className="text-caution">gyroscope</span>
        </span>
      </figcaption>
      <div className="mt-1 overflow-x-auto rounded-xl border border-line bg-surface">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-24 w-full min-w-[280px]"
          role="img"
          aria-label={`${label}: optical flow against gyroscope over the episode`}
        >
          <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="currentColor" strokeOpacity="0.12" />
          <path d={path(gyro)} fill="none" stroke="var(--caution)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <path d={path(flow)} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    </figure>
  );
}

export function Traces({ episodeId, correlation }: { episodeId: string; correlation: number | null }) {
  const [traces, setTraces] = useState<Trace[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "empty">("idle");

  useEffect(() => {
    if (state !== "loading") return;
    let live = true;

    fetch(`/api/episodes/${episodeId}/traces`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("none"))))
      .then((data: { traces: Trace[] }) => {
        if (!live) return;
        if (data.traces?.length) setTraces(data.traces);
        else setState("empty");
      })
      .catch(() => live && setState("empty"));

    return () => {
      live = false;
    };
  }, [episodeId, state]);

  if (state === "idle") {
    return (
      <button
        onClick={() => setState("loading")}
        className="interactive mt-3 w-full rounded-xl border border-line py-2 text-xs font-medium text-muted"
      >
        Show the motion check
      </button>
    );
  }

  if (state === "empty") {
    return (
      <p className="mt-3 text-xs text-subtle">
        No traces for this episode — it was scored before they were recorded, or the
        take had too little motion to pair.
      </p>
    );
  }

  if (!traces) return <p className="mt-3 text-xs text-subtle">Loading…</p>;

  return (
    <div className="mt-3">
      <p className="text-xs leading-relaxed text-subtle">
        What the camera saw against how the phone moved
        {correlation === null ? "" : `, agreeing ${Math.round(correlation * 100)}%`}. Genuine
        head-mounted capture makes these track each other; footage played off a screen
        does not. Each is scaled on its own — the check is whether they move together,
        not by how much.
      </p>
      <Axis label="Turning left and right" flow={traces.map((t) => t.flowYaw)} gyro={traces.map((t) => t.gyroYaw)} />
      <Axis label="Looking up and down" flow={traces.map((t) => t.flowPitch)} gyro={traces.map((t) => t.gyroPitch)} />
    </div>
  );
}
