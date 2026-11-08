/**
 * P2 CPU picking (docs/02-plan.md ADR-2 consequence 2): ray–AABB over every block at its ANIMATED
 * position, using the same easing as the vertex shader (core/easing.ts ↔ shaders/chunks/ease), so
 * a click hits what is on screen at any scrub position. Blocks the shader discards (section plane,
 * ore-only) are skipped, so a click through a cut face hits the block behind it.
 *
 * Pure maths, no three.js objects: O(N) slab tests, about 1 ms at 30k blocks, run once per click.
 */
import { animatedCentroid, animatedScale, blockProgress } from '@/core/easing';

export interface PickRay {
  /** m, world (mine grid) */
  origin: readonly [number, number, number];
  /** Need not be normalised; hit distances are in units of |direction|. */
  direction: readonly [number, number, number];
}

export interface PickScene {
  count: number;
  /** 3·count, m */
  start: Float32Array;
  /** 3·count, m */
  end: Float32Array;
  /** count, timeline fraction */
  delay: Float32Array;
  /** m, grid block size */
  blockSize: readonly [number, number, number];
  /** uScaleEnd (swell^⅓) */
  scaleEnd: number;
  /** uProgress */
  progress: number;
  /** uDur */
  duration: number;
  /** uArc */
  arc: number;
  /** uSection (nx, ny, nz, d): hidden when dot(n, centroid) < d. */
  section: readonly [number, number, number, number];
  /** uOreOnly with aOre: when true, blocks whose ore flag is 0 are hidden. */
  oreOnly: boolean;
  /** count, 1 = ore (aOre) */
  ore: Float32Array;
}

/**
 * Clip the ray-parameter interval `span` by one axis slab [min, max]. A zero direction component
 * is handled explicitly (inside the slab, edges included → no constraint; outside → empty), so a
 * ray lying exactly in a block face never produces 0·∞ = NaN.
 */
function clipSlab(o: number, d: number, min: number, max: number, span: [number, number]): boolean {
  if (d === 0) return o >= min && o <= max;
  const inv = 1 / d;
  let t1 = (min - o) * inv;
  let t2 = (max - o) * inv;
  if (t1 > t2) [t1, t2] = [t2, t1];
  if (t1 > span[0]) span[0] = t1;
  if (t2 < span[1]) span[1] = t2;
  return span[0] <= span[1];
}

/** Nearest visible block the ray enters (or starts inside), or null. */
export function pickBlock(ray: PickRay, s: PickScene): number | null {
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.direction;
  const [nx, ny, nz, nd] = s.section;
  const p: [number, number, number] = [0, 0, 0];
  const span: [number, number] = [0, Infinity];
  let best = Infinity;
  let hit: number | null = null;

  for (let b = 0; b < s.count; b++) {
    if (s.oreOnly && s.ore[b] < 0.5) continue;
    const t = blockProgress(s.progress, s.delay[b], s.duration);
    animatedCentroid(s.start, s.end, b, t, s.arc, p);
    if (nx * p[0] + ny * p[1] + nz * p[2] < nd) continue; // cut away by the section plane

    const k = animatedScale(t, s.scaleEnd) / 2;
    const hx = s.blockSize[0] * k;
    const hy = s.blockSize[1] * k;
    const hz = s.blockSize[2] * k;

    // Slab test on t ∈ [0, ∞): only hits in front of (or around) the origin count.
    span[0] = 0;
    span[1] = Infinity;
    if (
      clipSlab(ox, dx, p[0] - hx, p[0] + hx, span) &&
      clipSlab(oy, dy, p[1] - hy, p[1] + hy, span) &&
      clipSlab(oz, dz, p[2] - hz, p[2] + hz, span) &&
      span[0] < best
    ) {
      best = span[0];
      hit = b;
    }
  }
  return hit;
}
