/**
 * Hand skeleton topology and drawing.
 *
 * The 21-landmark hand model is a tree rooted at the wrist. Drawing the bones
 * rather than a cloud of dots is what makes the overlay readable at a glance
 * while someone is wearing the phone — you can see a hand, and see when the
 * tracker has lost it.
 */

import type { Landmark } from "./framing";

/** Wrist and the knuckle row — the joints a hand actually rotates about. */
export const PIVOT_INDICES = [0, 1, 2, 5, 9, 13, 17] as const;

/**
 * Bones of the standard 21-point hand model.
 *
 *        8   12  16  20      fingertips
 *        7   11  15  19
 *        6   10  14  18
 *    4   5    9  13  17      knuckles
 *    3
 *    2    \   |   |   /
 *    1  ------- 0 -------    wrist
 */
export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  // Thumb
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  // Index
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  // Middle
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  // Ring
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  // Pinky
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  // Palm closure
  [0, 17],
];

export const HAND_LANDMARK_COUNT = 21;

export interface SkeletonStyle {
  boneColor: string;
  jointColor: string;
  pivotColor: string;
  boneWidth: number;
  jointRadius: number;
  pivotRadius: number;
}

export const DEFAULT_SKELETON_STYLE: SkeletonStyle = {
  boneColor: "rgba(56, 189, 248, 0.9)",
  jointColor: "rgba(255, 255, 255, 0.85)",
  pivotColor: "#f97316",
  boneWidth: 2,
  jointRadius: 2.5,
  pivotRadius: 4.5,
};

/**
 * Draw one hand onto a 2D context.
 *
 * Landmarks are normalised; width and height scale them to the target
 * surface, so the same data draws correctly onto the viewfinder overlay and
 * onto a still review canvas without conversion at the call site.
 */
export function drawHand(
  ctx: CanvasRenderingContext2D,
  hand: readonly Landmark[],
  width: number,
  height: number,
  style: SkeletonStyle = DEFAULT_SKELETON_STYLE,
): void {
  if (hand.length === 0) return;

  const x = (i: number) => hand[i].x * width;
  const y = (i: number) => hand[i].y * height;

  ctx.lineWidth = style.boneWidth;
  ctx.strokeStyle = style.boneColor;
  ctx.lineCap = "round";

  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    if (!hand[a] || !hand[b]) continue;
    ctx.moveTo(x(a), y(a));
    ctx.lineTo(x(b), y(b));
  }
  ctx.stroke();

  ctx.fillStyle = style.jointColor;
  for (let i = 0; i < hand.length; i++) {
    ctx.beginPath();
    ctx.arc(x(i), y(i), style.jointRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = style.pivotColor;
  for (const i of PIVOT_INDICES) {
    if (!hand[i]) continue;
    ctx.beginPath();
    ctx.arc(x(i), y(i), style.pivotRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}
