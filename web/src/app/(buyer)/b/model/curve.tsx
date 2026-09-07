"use client";

import { useId, useState } from "react";

/**
 * Held-out prediction error against how many episodes were trained on.
 *
 * product-spec §8.2 asks for a curve rather than one before/after number, "with
 * the noise visible", so every point carries its spread across seeds and the
 * band is drawn rather than smoothed away.
 *
 * One series, so no legend — the title names it. The baseline is a reference
 * line in recessive ink with a direct label, not a second colour: it is the
 * threshold the model has to cross, not a thing being compared like-for-like.
 */

export interface CurvePoint {
  episodes: number;
  mean_error: number;
  std_error: number;
  seeds: number;
}

const SERIES = "#3987e5";

const WIDTH = 640;
const HEIGHT = 300;
const PAD = { top: 20, right: 68, bottom: 40, left: 56 };

function niceCeil(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

export function ScalingCurve({
  curve,
  baseline,
}: {
  curve: CurvePoint[];
  baseline: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId();

  if (curve.length < 2) {
    return (
      <p className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-subtle">
        A curve needs at least two training sizes. Collect more episodes and re-run
        the trainer.
      </p>
    );
  }

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const maxEpisodes = Math.max(...curve.map((p) => p.episodes));
  const maxError = niceCeil(
    Math.max(baseline, ...curve.map((p) => p.mean_error + p.std_error)) * 1.05,
  );

  const x = (episodes: number) =>
    PAD.left + (maxEpisodes === 1 ? plotW / 2 : ((episodes - 1) / (maxEpisodes - 1)) * plotW);
  const y = (error: number) => PAD.top + plotH - (error / maxError) * plotH;

  const line = curve.map((p) => `${x(p.episodes)},${y(p.mean_error)}`).join(" ");
  const band = [
    ...curve.map((p) => `${x(p.episodes)},${y(p.mean_error + p.std_error)}`),
    ...[...curve].reverse().map((p) => `${x(p.episodes)},${y(Math.max(0, p.mean_error - p.std_error))}`),
  ].join(" ");

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxError);
  const active = hover === null ? null : curve[hover];

  return (
    <figure className="rounded-2xl border border-line bg-surface p-4">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={`Held-out error falling from ${curve[0].mean_error.toFixed(2)} at ${curve[0].episodes} episode to ${curve[curve.length - 1].mean_error.toFixed(2)} at ${maxEpisodes} episodes, against a no-change baseline of ${baseline.toFixed(2)}.`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
          </clipPath>
        </defs>

        {/* Recessive grid — present enough to read a value against, no more. */}
        {ticks.map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              x2={PAD.left + plotW}
              y1={y(value)}
              y2={y(value)}
              stroke="currentColor"
              strokeOpacity={0.08}
            />
            <text
              x={PAD.left - 10}
              y={y(value) + 4}
              textAnchor="end"
              className="fill-current text-[11px] tabular"
              opacity={0.45}
            >
              {value.toFixed(1)}
            </text>
          </g>
        ))}

        {/* The bar to clear, in ink rather than a competing hue. */}
        <line
          x1={PAD.left}
          x2={PAD.left + plotW}
          y1={y(baseline)}
          y2={y(baseline)}
          stroke="currentColor"
          strokeOpacity={0.5}
          strokeWidth={2}
          strokeDasharray="6 5"
        />
        <text
          x={PAD.left + plotW + 8}
          y={y(baseline) + 4}
          className="fill-current text-[11px]"
          opacity={0.6}
        >
          baseline
        </text>

        <g clipPath={`url(#${clipId})`}>
          <polygon points={band} fill={SERIES} fillOpacity={0.16} />
          <polyline
            points={line}
            fill="none"
            stroke={SERIES}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>

        {curve.map((point, index) => (
          <g key={point.episodes}>
            {/* Hit target far larger than the mark. */}
            <rect
              x={x(point.episodes) - 22}
              y={PAD.top}
              width={44}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            />
            <circle
              cx={x(point.episodes)}
              cy={y(point.mean_error)}
              r={hover === index ? 6 : 4.5}
              fill={SERIES}
              stroke="var(--surface)"
              strokeWidth={2}
            />
            <text
              x={x(point.episodes)}
              y={HEIGHT - 14}
              textAnchor="middle"
              className="fill-current text-[11px] tabular"
              opacity={0.5}
            >
              {point.episodes}
            </text>
          </g>
        ))}

        {/* Only the final point is labelled — a number on every point is noise. */}
        <text
          x={x(maxEpisodes) + 10}
          y={y(curve[curve.length - 1].mean_error) + 4}
          className="fill-current text-[11px] tabular font-medium"
        >
          {curve[curve.length - 1].mean_error.toFixed(2)}
        </text>

        <text
          x={PAD.left + plotW / 2}
          y={HEIGHT - 2}
          textAnchor="middle"
          className="fill-current text-[11px]"
          opacity={0.45}
        >
          episodes trained on
        </text>
      </svg>

      {active ? (
        <p className="mt-1 text-sm">
          <span className="tabular font-medium">{active.episodes} episodes</span>
          <span className="text-muted"> · error </span>
          <span className="tabular font-medium">{active.mean_error.toFixed(3)}</span>
          <span className="text-muted"> ± {active.std_error.toFixed(3)} over {active.seeds} seeds</span>
        </p>
      ) : (
        <p className="mt-1 text-sm text-subtle">
          Lower is better. Hover a point for its spread across seeds.
        </p>
      )}
    </figure>
  );
}
