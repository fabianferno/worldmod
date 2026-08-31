/**
 * Contributor reputation — product-spec §12.
 *
 * Derived, never stored: reputation is a function of the episodes a contributor
 * has already submitted, so there is nothing to keep in sync and nothing that
 * can drift away from the record it summarises.
 *
 * §12 is also explicit that the MVP **computes and displays it but does not
 * gate on it**. With a demo-sized network there is nothing to gate — refusing a
 * contributor on the strength of three episodes would be noise dressed as
 * policy. It is shown so a buyer can rank, and so the mechanism exists before
 * the network is large enough for it to mean something.
 */

import type { StoredEpisode } from "./types";

export interface Reputation {
  entity_id: string;
  episodes: number;
  accepted: number;
  /** Share of submissions accepted, 0–1. */
  acceptance_rate: number;
  /** Mean framing across scored episodes, 0–1. */
  mean_framing: number | null;
  /** Mean motion match across episodes where it could be measured, 0–1. */
  mean_plausibility: number | null;
  /** Share of submissions flagged as near-duplicates of earlier work, 0–1. */
  duplicate_rate: number;
  total_earned_usdc: number;
  /** Combined score, 0–100. */
  score: number;
  /** Below this many episodes the score is not yet meaningful. */
  provisional: boolean;
}

/** Fewer than this and the numbers are noise, however good they look. */
export const PROVISIONAL_BELOW = 5;

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * One score from the four signals §12 names.
 *
 * Duplicates subtract rather than merely failing to add. A contributor
 * resubmitting the same footage is not neutral — it is an attempt to be paid
 * twice for one contribution, and the score should reflect that more sharply
 * than a merely mediocre episode does.
 */
function combine(input: {
  acceptance: number;
  framing: number | null;
  plausibility: number | null;
  duplicateRate: number;
}): number {
  const parts: Array<[number, number]> = [[input.acceptance, 2]];
  if (input.framing !== null) parts.push([input.framing, 1.5]);
  if (input.plausibility !== null) parts.push([input.plausibility, 1.5]);

  const weight = parts.reduce((sum, [, w]) => sum + w, 0);
  const base = parts.reduce((sum, [value, w]) => sum + value * w, 0) / weight;

  const penalised = base * (1 - Math.min(1, input.duplicateRate * 2));
  return Math.round(Math.max(0, Math.min(1, penalised)) * 1000) / 10;
}

export function reputationFor(entityId: string, episodes: readonly StoredEpisode[]): Reputation {
  const mine = episodes.filter((e) => e.entity_id === entityId);
  const accepted = mine.filter((e) => e.accepted);

  const framing = mean(
    mine.map((e) => e.framing).filter((v): v is number => typeof v === "number"),
  );
  const plausibility = mean(
    mine.map((e) => e.plausibility).filter((v): v is number => typeof v === "number"),
  );

  // A duplicate is what the validator found, not what the bounty thought.
  const duplicates = mine.filter((e) => e.validation?.checks.duplicate_of != null).length;
  const duplicateRate = mine.length === 0 ? 0 : duplicates / mine.length;
  const acceptance = mine.length === 0 ? 0 : accepted.length / mine.length;

  return {
    entity_id: entityId,
    episodes: mine.length,
    accepted: accepted.length,
    acceptance_rate: acceptance,
    mean_framing: framing,
    mean_plausibility: plausibility,
    duplicate_rate: duplicateRate,
    total_earned_usdc: accepted.reduce((sum, e) => sum + e.paid_usdc, 0),
    score: combine({ acceptance, framing, plausibility, duplicateRate }),
    provisional: mine.length < PROVISIONAL_BELOW,
  };
}

/** Every contributor who has submitted anything, strongest first. */
export function leaderboard(episodes: readonly StoredEpisode[]): Reputation[] {
  const entities = [...new Set(episodes.map((e) => e.entity_id))];
  return entities
    .map((id) => reputationFor(id, episodes))
    .sort((a, b) => b.score - a.score || b.episodes - a.episodes);
}
