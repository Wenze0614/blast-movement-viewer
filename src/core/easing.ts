/**
 * Animation easing shared by the block shader and CPU picking (docs/02-plan.md ADR-2).
 *
 * The vertex shader does:
 *   t = clamp((uProgress - aDelay) / uDur, 0, 1);  t = t*t*(3 - 2t);
 *   p = mix(aStart, aEnd, t);  p.z += uArc * 4 t (1 - t) * |aEnd.xy - aStart.xy|;
 *   size = uBlockSize * mix(1, uScaleEnd, t)
 * These functions are the same maths in TS so picking matches the image at any scrub position.
 * Visual only: none of this feeds reconciliation.
 */

/**
 * Per-block animation duration as a fraction of the 0 → 1 timeline. Delays are in [0, 0.5]
 * (ADR-3 step 5), so with 0.5 every block has landed at progress = 1.
 */
export const BLOCK_ANIMATION_DURATION = 0.5;

/** Cubic smoothstep on [0, 1]: t² (3 − 2t), with t clamped. Matches the GLSL. */
export function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Eased local progress of one block: smoothstep(clamp((progress − delay) / duration)). */
export function blockProgress(progress: number, delay: number, duration = BLOCK_ANIMATION_DURATION): number {
  return smoothstep01((progress - delay) / duration);
}

/**
 * Animated centroid of block `index` (writes into `out`, returns it). `arc` is the throw-arc
 * height factor (uArc). Mirrors the vertex shader exactly.
 */
export function animatedCentroid(
  start: Float32Array,
  end: Float32Array,
  index: number,
  t: number,
  arc: number,
  out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  const o = 3 * index;
  const sx = start[o];
  const sy = start[o + 1];
  const sz = start[o + 2];
  const ex = end[o];
  const ey = end[o + 1];
  const ez = end[o + 2];
  out[0] = sx + (ex - sx) * t;
  out[1] = sy + (ey - sy) * t;
  out[2] = sz + (ez - sz) * t + arc * 4 * t * (1 - t) * Math.hypot(ex - sx, ey - sy);
  return out;
}

/** Block size multiplier at eased progress t: mix(1, looseScale, t). */
export function animatedScale(t: number, looseScale: number): number {
  return 1 + (looseScale - 1) * t;
}
