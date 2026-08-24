/**
 * The bounty the demo is built around.
 *
 * Typing at a keyboard is a good first task for this network and a revealing
 * one. It is what a phone in a head strap is genuinely good at: the hands sit
 * in the lower field of view where a narrow-FOV rear camera can see them, the
 * scene is well lit and textured, and the action is repeatable by anyone with
 * a desk.
 *
 * It also exposes the limit of the anti-spoof check honestly. Seated typing
 * barely rotates the head — a real capture on an S24 Ultra measured 0.8 deg/s
 * — so the flow-vs-gyro correlation has nothing to work with. Rather than
 * quietly failing every honest submission, the bounty declares
 * `motion_policy: "allow_static"`, and episodes accepted that way are recorded
 * as carrying no motion evidence. They are the cheapest episodes in the
 * network to fake, and the network should say so rather than pretend
 * otherwise.
 */

import type { Bounty } from "./types";

const DAY = 86_400;

export const KEYBOARD_BOUNTY: Bounty = {
  bounty_id: "bounty_keyboard_001",
  title: "Typing at a keyboard",
  task_spec:
    "Sit at a desk with the phone head-mounted and type on a keyboard for the full episode. " +
    "Keep both hands in view. Normal typing is fine — no need to perform.",
  task: "keyboard_typing",
  required_modalities: ["rgb", "imu"],
  min_episodes: 100,
  duration_range_s: [8, 30],
  min_plausibility: 0.7,
  motion_policy: "allow_static",
  min_framing: 0.7,
  min_trust_level: "heuristic",

  // 100 x 0.60 = 60 to contributors, 30 to the utility pool, 5 validator,
  // 5 treasury. Adds to the 100 budget — see budgetBreakdown.
  budget_usdc: 100,
  per_episode_usdc: 0.6,
  utility_pool_usdc: 30,
  validator_fee_usdc: 5,
  treasury_fee_usdc: 5,

  license: "commercial_ai_training",
  deadline: Math.floor(Date.now() / 1000) + 30 * DAY,
  created_at: Math.floor(Date.now() / 1000),
  status: "open",
};
