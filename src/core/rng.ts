/**
 * Seeded randomness for core (CLAUDE.md convention 5: no `Math.random` in core).
 *
 * - `mulberry32`: tiny, fast 32-bit PRNG; same seed → same sequence on every JS engine.
 * - `deriveSeed`: derive independent sub-seeds (e.g. one per noise field) from one integer seed.
 * - `createRng`: convenience wrapper (uniform, normal, int).
 * - `createSeededNoise3D`: `simplex-noise` 3D noise whose permutation table comes from a seed.
 */
import { createNoise3D, type NoiseFunction3D } from 'simplex-noise';

export type RandomFn = () => number;

/** Mulberry32 PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): RandomFn {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Murmur3 32-bit finaliser: avalanches all input bits. */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Derive a well-mixed uint32 sub-seed from `seed` and a salt, so that e.g. the throw noise and the
 * lateral noise of one blast are independent fields.
 */
export function deriveSeed(seed: number, salt: string | number): number {
  let h = fmix32((seed >>> 0) ^ 0x9e3779b9);
  const s = String(salt);
  for (let i = 0; i < s.length; i++) {
    h = fmix32(h ^ Math.imul(s.charCodeAt(i) + 1, 0x01000193));
  }
  return h;
}

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** [min, max) */
  uniform(min: number, max: number): number;
  /** Standard normal N(0, 1) (Box–Muller). */
  normal(): number;
  /** Integer in [0, n). */
  int(n: number): number;
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    uniform: (min, max) => min + (max - min) * next(),
    normal: () => {
      // 1 - next() is in (0, 1], so the log is finite.
      const u = 1 - next();
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    int: (n) => Math.floor(next() * n),
  };
}

/** Seeded 3D simplex noise, values in [-1, 1]. */
export function createSeededNoise3D(seed: number): NoiseFunction3D {
  return createNoise3D(mulberry32(seed));
}

/**
 * Fractal sum of `octaves` noise layers (lacunarity 2, gain 0.5), normalised back to about [-1, 1].
 * Coordinates are in noise units (divide metres by a correlation length first).
 */
export function fbm3(noise: NoiseFunction3D, x: number, y: number, z: number, octaves = 3): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, y * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
