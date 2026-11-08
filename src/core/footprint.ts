/**
 * Blast footprint: which in-situ block columns a blast contains, seen in a bench-local frame
 * aligned with the free face. One source of truth for the movement heuristic (where blasted rock
 * may go), the hole layout and the pit terrain (where the bench face and the open floor are).
 *
 * Bench-local frame: `a` = distance from the back of the grid's bounding box toward the free face
 * (throw = +a), `b` = lateral distance. A = box length along the throw, W = box width across it.
 *
 * A blast outline is irregular, so the free face is too: for each lateral strip (one block column
 * wide) the face sits at the front of that strip's frontmost present column. In front of the face
 * the ground is open (the floor left by the previous cut); outside the footprint and behind the
 * face it is unblasted rock. Strips with no blocks (beside the blast) take the frontmost face of
 * the whole blast, so the open floor continues past the blast's sides.
 *
 * The open floor is bounded: it reaches `FLOOR_WIDTH` m past the frontmost face (where the pit
 * terrain steps down to the bench below) and `SIDE_OPEN` m beyond the blast's sides. Movement may
 * land rock only on free ground (footprint ∪ open floor) and the terrain is floor over all of it,
 * so a settled block always rests on drawn floor.
 */
import { pointInRing } from './geometry';
import type { BlastParameters, BlockModel, GridSpec, Vec2 } from './types';

export type FreeFace = BlastParameters['freeFace'];

/** m of open floor in front of the frontmost face, before the drop to the bench below. */
export const FLOOR_WIDTH = 45;
/** m the open floor extends beyond the footprint's sides (the width of the previous cut). */
export const SIDE_OPEN = 30;

export interface BenchFrame {
  /** m, bounding-box length along the throw and width across it. */
  A: number;
  W: number;
  /** m, block size along / across the throw. */
  ca: number;
  cb: number;
  /** Block columns along / across the throw. */
  nAlong: number;
  nLat: number;
  toLocal(x: number, y: number): Vec2;
  toWorld(a: number, b: number): Vec2;
  /** World column index i + nx·j of the bench-local column (ai, bi). */
  columnOf(ai: number, bi: number): number;
}

export function benchFrame(grid: GridSpec, face: FreeFace): BenchFrame {
  const [ox, oy] = grid.origin;
  const [bx, by] = grid.blockSize;
  const { nx, ny } = grid;
  const lx = nx * bx;
  const ly = ny * by;
  switch (face) {
    case 'east':
      return {
        A: lx, W: ly, ca: bx, cb: by, nAlong: nx, nLat: ny,
        toLocal: (x, y) => [x - ox, y - oy],
        toWorld: (a, b) => [ox + a, oy + b],
        columnOf: (ai, bi) => ai + nx * bi,
      };
    case 'west':
      return {
        A: lx, W: ly, ca: bx, cb: by, nAlong: nx, nLat: ny,
        toLocal: (x, y) => [ox + lx - x, y - oy],
        toWorld: (a, b) => [ox + lx - a, oy + b],
        columnOf: (ai, bi) => nx - 1 - ai + nx * bi,
      };
    case 'north':
      return {
        A: ly, W: lx, ca: by, cb: bx, nAlong: ny, nLat: nx,
        toLocal: (x, y) => [y - oy, x - ox],
        toWorld: (a, b) => [ox + b, oy + a],
        columnOf: (ai, bi) => bi + nx * ai,
      };
    case 'south':
      return {
        A: ly, W: lx, ca: by, cb: bx, nAlong: ny, nLat: nx,
        toLocal: (x, y) => [oy + ly - y, x - ox],
        toWorld: (a, b) => [ox + b, oy + ly - a],
        columnOf: (ai, bi) => bi + nx * (ny - 1 - ai),
      };
  }
}

/**
 * 1 for every plan column (index i + nx·j) whose centre lies inside `outline` (a closed ring in
 * world x, y; even-odd rule), else 0. Without an outline every column is in.
 */
export function outlineColumnMask(grid: GridSpec, outline?: readonly Vec2[] | null): Uint8Array {
  const { nx, ny } = grid;
  const mask = new Uint8Array(nx * ny);
  if (!outline) return mask.fill(1);
  const [ox, oy] = grid.origin;
  const [bx, by] = grid.blockSize;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (pointInRing(ox + (i + 0.5) * bx, oy + (j + 0.5) * by, outline)) mask[i + nx * j] = 1;
    }
  }
  return mask;
}

/** 1 for every plan column that holds at least one of the model's blocks. */
export function modelColumnMask(model: BlockModel): Uint8Array {
  const plan = model.grid.nx * model.grid.ny;
  const mask = new Uint8Array(plan);
  for (let n = 0; n < model.count; n++) mask[model.cell[n] % plan] = 1;
  return mask;
}

export interface Footprint {
  frame: BenchFrame;
  /** World plan-column mask (i + nx·j). */
  columns: Uint8Array;
  /** m along the throw: the face of each lateral strip; NaN where the strip holds no blocks. */
  front: Float64Array;
  /** m: frontmost face, rearmost back edge, lateral extent [latMin, latMax) of the footprint. */
  frontMax: number;
  backMin: number;
  latMin: number;
  latMax: number;
  /** m: the open floor ends at a = openEnd (frontMax + FLOOR_WIDTH) and spans b ∈ [openLatMin, openLatMax). */
  openEnd: number;
  openLatMin: number;
  openLatMax: number;
  /** Is the bench-local point inside a present block column? */
  contains(a: number, b: number): boolean;
  /** m along the throw: where the free face is for lateral position b. */
  faceLine(b: number): number;
  /** On the open floor: in front of the free face, within its bounds? */
  isOpen(a: number, b: number): boolean;
  /** Free ground (rock may land here): inside the footprint or on the open floor. */
  isFree(a: number, b: number): boolean;
  /**
   * Is the whole square [a0, a0 + size] × [b0, b0 + size] free ground? Sampled on a lattice finer
   * than half a block (free ground is a union of block-column squares and an axis-aligned strip
   * region, so no rock column can hide between samples), inset by a hair so shared edges count.
   */
  boxIsFree(a0: number, b0: number, size: number): boolean;
}

export function createFootprint(grid: GridSpec, columns: Uint8Array, face: FreeFace): Footprint {
  const frame = benchFrame(grid, face);
  const { nAlong, nLat, ca, cb, A } = frame;
  if (columns.length !== grid.nx * grid.ny) throw new Error('createFootprint: column mask has the wrong length');
  const front = new Float64Array(nLat).fill(NaN);
  let frontMax = -Infinity;
  let backMin = Infinity;
  let latLo = Infinity;
  let latHi = -Infinity;
  for (let bi = 0; bi < nLat; bi++) {
    for (let ai = 0; ai < nAlong; ai++) {
      if (!columns[frame.columnOf(ai, bi)]) continue;
      front[bi] = (ai + 1) * ca; // ascending ai: the last hit is the frontmost
      backMin = Math.min(backMin, ai * ca);
      latLo = Math.min(latLo, bi);
      latHi = Math.max(latHi, bi);
    }
    if (front[bi] > frontMax) frontMax = front[bi];
  }
  if (!Number.isFinite(frontMax)) {
    // No blocks: behave like an empty rectangular bench.
    frontMax = A;
    backMin = 0;
    latLo = 0;
    latHi = nLat - 1;
  }

  const contains = (a: number, b: number) => {
    const ai = Math.floor(a / ca);
    const bi = Math.floor(b / cb);
    return ai >= 0 && ai < nAlong && bi >= 0 && bi < nLat && columns[frame.columnOf(ai, bi)] === 1;
  };
  const faceLine = (b: number) => {
    const bi = Math.floor(b / cb);
    const f = bi >= 0 && bi < nLat ? front[bi] : NaN;
    return Number.isNaN(f) ? frontMax : f;
  };
  const latMin = latLo * cb;
  const latMax = (latHi + 1) * cb;
  const openEnd = frontMax + FLOOR_WIDTH;
  const openLatMin = latMin - SIDE_OPEN;
  const openLatMax = latMax + SIDE_OPEN;
  const isOpen = (a: number, b: number) => a >= faceLine(b) && a < openEnd && b >= openLatMin && b < openLatMax;
  const isFree = (a: number, b: number) => contains(a, b) || isOpen(a, b);
  const step = Math.min(ca, cb) / 2;
  const boxIsFree = (a0: number, b0: number, size: number) => {
    const inset = 1e-6 * size;
    const n = Math.max(1, Math.ceil(size / step));
    for (let u = 0; u <= n; u++) {
      const a = a0 + inset + ((size - 2 * inset) * u) / n;
      for (let v = 0; v <= n; v++) if (!isFree(a, b0 + inset + ((size - 2 * inset) * v) / n)) return false;
    }
    return true;
  };
  return {
    frame,
    columns,
    front,
    frontMax,
    backMin,
    latMin,
    latMax,
    openEnd,
    openLatMin,
    openLatMax,
    contains,
    faceLine,
    isOpen,
    isFree,
    boxIsFree,
  };
}

/** Footprint of a model's own blocks. */
export function modelFootprint(model: BlockModel, face: FreeFace): Footprint {
  return createFootprint(model.grid, modelColumnMask(model), face);
}
