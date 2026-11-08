/**
 * Pure packing helpers for the block instance attributes (ADR-2). No GPU objects here, so they
 * are unit-testable; the blocks system wraps the arrays in InstancedBufferAttributes.
 *
 * Struct-of-arrays end to end: start/end/delay are the MovementResult's own typed arrays
 * (no copies); only aColor is built here.
 */
import type { BlockModel, MovementResult } from '@/core/types';
import type { PaletteEntry } from '@/state/palette';

export interface InstancePack {
  count: number;
  /** 3 * count, m */
  start: Float32Array;
  /** 3 * count, m */
  end: Float32Array;
  /** count, timeline fraction 0..0.5 */
  delay: Float32Array;
  /** uScaleEnd: swell^(1/3), 1 before a movement exists. */
  scaleEnd: number;
  /** uBlockSize, m */
  blockSize: [number, number, number];
}

/** sRGB channel (0..1) → linear, the IEC 61966-2-1 transfer function three.js uses. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** '#rrggbb' → linear RGB triple (the block shader lights in linear space). */
export function hexToLinearRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`hexToLinearRgb: expected #rrggbb, got ${hex}`);
  const n = parseInt(m[1], 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

/**
 * Instance data for a model, before or after the movement exists. Without a movement every
 * block sits at its in-situ centroid (end = start, delay 0), so the movement arriving at
 * progress 0 doesn't move anything (no popping).
 */
export function packInstances(model: BlockModel, movement: MovementResult | null): InstancePack {
  const count = model.count;
  if (movement && movement.start.length !== 3 * count) {
    throw new Error(`packInstances: movement has ${movement.start.length / 3} blocks, model has ${count}`);
  }
  const [bx, by, bz] = model.grid.blockSize;
  return {
    count,
    start: movement ? movement.start : model.centroid,
    end: movement ? movement.end : model.centroid,
    delay: movement ? movement.delay : new Float32Array(count),
    scaleEnd: movement ? movement.looseScale : 1,
    blockSize: [bx, by, bz],
  };
}

/**
 * aColor for a class-indexed palette (grade mode: OreClass per block). Writes into `out` when
 * given (colour-mode change rewrites the attribute in place), else allocates.
 */
export function packClassColours(
  classes: Uint8Array,
  palette: Readonly<Record<number, PaletteEntry>>,
  out: Float32Array = new Float32Array(classes.length * 3),
): Float32Array {
  if (out.length !== classes.length * 3) throw new Error('packClassColours: out has the wrong length');
  const lut = new Map<number, [number, number, number]>();
  for (const [k, entry] of Object.entries(palette)) lut.set(Number(k), hexToLinearRgb(entry.hex));
  const fallback = lut.get(0) ?? [0.5, 0.5, 0.5];
  for (let i = 0; i < classes.length; i++) {
    const c = lut.get(classes[i]) ?? fallback;
    out[3 * i] = c[0];
    out[3 * i + 1] = c[1];
    out[3 * i + 2] = c[2];
  }
  return out;
}
