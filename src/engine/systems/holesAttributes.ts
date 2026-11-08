/**
 * Pure packing for the P9 blasthole layer (no three.js): BlastHole[] → per-instance attributes
 * for one instanced cylinder mesh. The vertex shader builds each cylinder from `aCenter` and
 * `aAxis` (bottom → top vector: orientation AND length), so any collar → toe direction works.
 */
import { smoothstep01 } from '@/core/easing';
import { classifyGrade } from '@/core/blockModel';
import type { BlastHole } from '@/core/api-types';
import type { GradeSettings } from '@/core/types';
import { GRADE_PALETTE, plasmaSrgb } from '@/state/palette';
import { hexToLinearRgb, srgbToLinear } from './blocksAttributes';

/**
 * m. Drawn radius. A real 115 mm hole (r = 0.0575 m) is invisible at bench scale, so the layer
 * exaggerates it about 5×; it is an illustrative pattern, not a to-scale drawing.
 */
export const HOLE_DISPLAY_RADIUS = 0.3;
/**
 * m the cylinder extends ABOVE the collar. The column itself (collar → toe) sits inside the
 * opaque bench before the blast; the stick-up keeps the pattern readable from above.
 */
export const HOLE_STICKUP = 1.5;
/** Progress at which the holes have faded out completely (front rows fire at progress 0). */
export const HOLES_FADE_END = 0.2;

export interface HolePack {
  count: number;
  /** 3 * count, m: midpoint of the drawn cylinder (toe → collar + stick-up). */
  center: Float32Array;
  /** 3 * count, m: bottom (toe) → top (collar + stick-up) vector. */
  axis: Float32Array;
  /** 3 * count, linear RGB: grade palette class of `sampledGrade`. */
  color: Float32Array;
}

export const EMPTY_HOLE_PACK: HolePack = {
  count: 0,
  center: new Float32Array(0),
  axis: new Float32Array(0),
  color: new Float32Array(0),
};

export function packHoles(holes: readonly BlastHole[], grades: GradeSettings, stickUp = HOLE_STICKUP): HolePack {
  const n = holes.length;
  const center = new Float32Array(3 * n);
  const axis = new Float32Array(3 * n);
  const color = new Float32Array(3 * n);
  const rgb = new Map<string, [number, number, number]>();
  holes.forEach((h, i) => {
    const [cx, cy, cz] = h.collar;
    const [tx, ty, tz] = h.toe;
    const dx = cx - tx;
    const dy = cy - ty;
    const dz = cz - tz;
    const len = Math.hypot(dx, dy, dz) || 1;
    // top = collar + stickUp along the toe → collar direction
    const top = [cx + (dx / len) * stickUp, cy + (dy / len) * stickUp, cz + (dz / len) * stickUp];
    center[3 * i] = (top[0] + tx) / 2;
    center[3 * i + 1] = (top[1] + ty) / 2;
    center[3 * i + 2] = (top[2] + tz) / 2;
    axis[3 * i] = top[0] - tx;
    axis[3 * i + 1] = top[1] - ty;
    axis[3 * i + 2] = top[2] - tz;
    const hex = GRADE_PALETTE[classifyGrade(h.sampledGrade, grades)].hex;
    let c = rgb.get(hex);
    if (!c) rgb.set(hex, (c = hexToLinearRgb(hex)));
    color.set(c, 3 * i);
  });
  return { count: n, center, axis, color };
}

/**
 * aColor by firing time (ms, core/timing.ts holeFiringTimes): 0 → first plasma stop, the last hole
 * → the last stop. Writes into `out` when given (a mode or timing change rewrites it in place).
 */
export function packHoleTimingColours(times: Float32Array, out: Float32Array = new Float32Array(times.length * 3)): Float32Array {
  if (out.length !== times.length * 3) throw new Error('packHoleTimingColours: out has the wrong length');
  let max = 0;
  for (const t of times) max = Math.max(max, t);
  for (let i = 0; i < times.length; i++) {
    const c = plasmaSrgb(max > 0 ? times[i] / max : 0);
    out[3 * i] = srgbToLinear(c[0]);
    out[3 * i + 1] = srgbToLinear(c[1]);
    out[3 * i + 2] = srgbToLinear(c[2]);
  }
  return out;
}

/** Layer opacity for a playback progress: 1 before the blast, smoothly 0 by HOLES_FADE_END. */
export function holesOpacity(progress: number): number {
  return 1 - smoothstep01(progress / HOLES_FADE_END);
}
