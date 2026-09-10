"use client";

/**
 * What the model guessed, replayed after the take.
 *
 * `prediction-panel.tsx` shows this live, one frame at a time, then unmounts
 * the moment recording stops — this is the only place it can be seen again.
 * Same honest framing as the live panel: each thumbnail is "of what the
 * model had seen so far in this take, the frame closest to where the motion
 * said you were heading," not a genuine future frame.
 */

import { useEffect, useState } from "react";

interface PredictionEntry {
  t: number;
  distance: number;
  warming: boolean;
  thumbnail: string;
}

export function PredictionStrip({ episodeId }: { episodeId: string }) {
  const [predictions, setPredictions] = useState<PredictionEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/episodes/${episodeId}/predictions`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { predictions?: PredictionEntry[] } | null) => {
        if (!cancelled) setPredictions(data?.predictions ?? []);
      })
      .catch(() => {
        if (!cancelled) setPredictions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [episodeId]);

  if (!predictions || predictions.length === 0) return null;

  return (
    <div className="settle settle-2 mt-3 rounded-panel bg-paper px-5 py-5 shadow-lift">
      <p className="text-sm font-medium">World model, live during this take</p>
      <p className="mt-1 text-xs leading-relaxed text-subtle">
        What the model guessed came next, moment to moment — of the frames it had already
        seen this take, the one closest to where your motion said you were heading.
      </p>
      <div className="mt-3 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {predictions.map((p, i) => (
          <div key={i} className="shrink-0 overflow-hidden rounded-inner bg-lilac p-1">
            <img
              src={p.thumbnail}
              alt=""
              className="block h-[64px] w-[64px] rounded-[10px] object-cover"
            />
            <p className="mt-0.5 text-center text-[9px] font-medium leading-tight text-lilac-ink/80">
              {p.warming ? "learning…" : `${(p.t / 1000).toFixed(1)}s`}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
