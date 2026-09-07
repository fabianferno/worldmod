import { describe, expect, it } from "vitest";
import { leaderboard, PROVISIONAL_BELOW, reputationFor } from "./reputation";
import type { StoredEpisode } from "./types";

function episode(overrides: Partial<StoredEpisode> = {}): StoredEpisode {
  return {
    episode_id: `ep_${Math.random().toString(16).slice(2, 10)}`,
    bounty_id: "bounty_keyboard_001",
    entity_id: "0xA",
    manifest_hash: `0x${"11".repeat(32)}`,
    duration_s: 15,
    plausibility: 0.8,
    framing: 0.9,
    trust_level: "heuristic",
    ua_class: "android_chrome",
    recorded_at: 1_787_000_000,
    status: "scored" as const,
    accepted: true,
    reasons: [],
    paid_usdc: 0.6,
    received_at: 1_787_000_100,
    ...overrides,
  };
}

describe("reputationFor", () => {
  it("summarises a contributor's record", () => {
    const episodes = [episode(), episode(), episode({ accepted: false, paid_usdc: 0 })];
    const rep = reputationFor("0xA", episodes);

    expect(rep.episodes).toBe(3);
    expect(rep.accepted).toBe(2);
    expect(rep.acceptance_rate).toBeCloseTo(2 / 3, 6);
    expect(rep.total_earned_usdc).toBeCloseTo(1.2, 6);
  });

  it("counts only that contributor's episodes", () => {
    const episodes = [episode({ entity_id: "0xA" }), episode({ entity_id: "0xB" })];
    expect(reputationFor("0xA", episodes).episodes).toBe(1);
  });

  it("marks a thin record provisional", () => {
    // A perfect score off two episodes is noise dressed as policy.
    const rep = reputationFor("0xA", [episode(), episode()]);
    expect(rep.provisional).toBe(true);

    const many = Array.from({ length: PROVISIONAL_BELOW }, () => episode());
    expect(reputationFor("0xA", many).provisional).toBe(false);
  });

  it("penalises duplicates harder than mediocre work", () => {
    const mediocre = Array.from({ length: 6 }, () =>
      episode({ framing: 0.5, plausibility: 0.5, accepted: false, paid_usdc: 0 }),
    );

    const duplicating = Array.from({ length: 6 }, (_, i) =>
      episode({
        accepted: i < 3,
        paid_usdc: i < 3 ? 0.6 : 0,
        validation: i >= 3
          ? {
              plausibility_score: 0,
              trust_level: "heuristic",
              failures: ["duplicate"],
              checks: {
                manifest_intact: true,
                streams_intact: true,
                completeness: 1,
                duration_ok: true,
                frame_rate_ok: true,
                imu_rate_ok: true,
                flow_gyro_corr: 0.8,
                framing: 0.9,
                duplicate_of: "ep_earlier",
                duplicate_similarity: 0.97,
              },
            }
          : undefined,
      }),
    );

    // Resubmitting the same footage is an attempt to be paid twice for one
    // contribution, not merely weak work.
    expect(reputationFor("0xA", duplicating).duplicate_rate).toBeCloseTo(0.5, 6);
    expect(reputationFor("0xA", duplicating).score).toBeLessThan(
      reputationFor("0xA", mediocre).score,
    );
  });

  it("ignores unmeasurable scores rather than treating them as zero", () => {
    // A seated task cannot produce motion evidence; scoring it zero would
    // punish someone for the task they were asked to do.
    const rep = reputationFor("0xA", [
      episode({ plausibility: null }),
      episode({ plausibility: null }),
    ]);

    expect(rep.mean_plausibility).toBeNull();
    expect(rep.score).toBeGreaterThan(50);
  });

  it("returns an empty record for an unknown contributor", () => {
    const rep = reputationFor("0xZ", [episode()]);
    expect(rep.episodes).toBe(0);
    expect(rep.score).toBe(0);
    expect(rep.provisional).toBe(true);
  });
});

describe("leaderboard", () => {
  it("ranks contributors strongest first", () => {
    const episodes = [
      ...Array.from({ length: 5 }, () => episode({ entity_id: "0xGood" })),
      ...Array.from({ length: 5 }, () =>
        episode({ entity_id: "0xWeak", accepted: false, paid_usdc: 0, framing: 0.2 }),
      ),
    ];

    const ranked = leaderboard(episodes);
    expect(ranked[0].entity_id).toBe("0xGood");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("includes every contributor who submitted anything", () => {
    const episodes = [episode({ entity_id: "0xA" }), episode({ entity_id: "0xB" })];
    expect(leaderboard(episodes).map((r) => r.entity_id).sort()).toEqual(["0xA", "0xB"]);
  });

  it("handles an empty network", () => {
    expect(leaderboard([])).toEqual([]);
  });
});
