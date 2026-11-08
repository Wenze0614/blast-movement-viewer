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
 * The open floor is bounded: it reaches about `FLOOR_WIDTH` m past the frontmost face (where the
 * pit terrain steps down to the bench below) and `SIDE_OPEN` m beyond the blast's sides, both
 * rounded up to whole blocks. Every edge of free ground (footprint ∪ open floor) therefore lies on
 * a block boundary, so free-ness is uniform within each block-grid cell and `rectIsFree` is exact.
 *
 * The pit terrain is floor over free ground plus a margin of `floorMargin(grid)` m all round.
 * Movement lands rock only on free ground and keeps every animated box within that margin of it
 * (`pathIsFree`), so no block ever meets the terrain, settled or in flight.
 */
import { pointInRing } from './geometry';
import type { BlastParameters, BlockModel, GridSpec, Vec2 } from './types';

export type FreeFace = BlastParameters['freeFace'];

/** m of open floor in front of the frontmost face, before the drop to the bench below. */
export const FLOOR_WIDTH = 45;
/** m the open floor extends beyond the footprint's sides (the width of the previous cut). */
export const SIDE_OPEN = 30;
/** m, target terrain vertex spacing (terrain.ts). */
export const TERRAIN_SPACING_TARGET = 1.25;

/**
 * m: the pit terrain's vertex spacing, which is also its floor margin around free ground. Near
 * TERRAIN_SPACING_TARGET and commensurate with the block grid: the block size divided by a whole
 * number (blocks ≥ the target: terrain cells nest inside block cells) or multiplied by one (small
 * blocks: each terrain cell is a whole number of block cells, so a 0.5 m model gets a 1.5 m
 * terrain instead of a 0.5 m one).
 */
export function floorMargin(grid: GridSpec): number {
  const bs = Math.min(grid.blockSize[0], grid.blockSize[1]);
  return bs >= TERRAIN_SPACING_TARGET
    ? bs / Math.round(bs / TERRAIN_SPACING_TARGET)
    : bs * Math.max(1, Math.round(TERRAIN_SPACING_TARGET / bs));
}

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
   * Is the whole rectangle [a0, a1] × [b0, b1] free ground? Exact: every block-grid cell it
   * overlaps (edges touching count as not overlapping) is tested at its centre, and free-ness is
   * uniform within a cell. An empty rectangle (a1 < a0) is a point test at its centre.
   */
  rectIsFree(a0: number, a1: number, b0: number, b1: number): boolean;
  /** rectIsFree for the square [a0, a0 + size] × [b0, b0 + size]. */
  boxIsFree(a0: number, b0: number, size: number): boolean;
  /**
   * Does a block's animated box stay within `tolerance` m (Chebyshev) of free ground all the way
   * from (as, bs) to (ae, be)? The box's centre and half-extents (ha0, hb0 at the start, scaled by
   * mix(1, k, s)) are both linear in the eased progress s, so the box between two sampled poses
   * lies inside the bounding box of the two poses: checking those bounding boxes (shrunk by the
   * tolerance) is conservative, never misses.
   */
  pathIsFree(as: number, bs: number, ae: number, be: number, ha0: number, hb0: number, k: number, tolerance: number): boolean;
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
  // Rounded to whole blocks so every edge of free ground is a block boundary.
  const openEnd = frontMax + Math.ceil(FLOOR_WIDTH / ca - 1e-9) * ca;
  const openLatMin = latMin - Math.ceil(SIDE_OPEN / cb - 1e-9) * cb;
  const openLatMax = latMax + Math.ceil(SIDE_OPEN / cb - 1e-9) * cb;
  const isOpen = (a: number, b: number) => a >= faceLine(b) && a < openEnd && b >= openLatMin && b < openLatMax;
  const isFree = (a: number, b: number) => contains(a, b) || isOpen(a, b);
  // All free ground lies in a ∈ [0, openEnd), b ∈ [openLatMin, openLatMax), on block cells.
  // A summed-area table of the rock cells there answers any rectangle in O(1); everything outside
  // that window is rock.
  const nI = Math.round(openEnd / ca);
  const jMin = Math.round(openLatMin / cb);
  const nJ = Math.round((openLatMax - openLatMin) / cb);
  const sat = new Int32Array((nI + 1) * (nJ + 1)); // sat[(i) * (nJ + 1) + j]: rock cells in [0, i) × [0, j)
  for (let i = 0; i < nI; i++) {
    let row = 0;
    for (let j = 0; j < nJ; j++) {
      row += isFree((i + 0.5) * ca, (j + jMin + 0.5) * cb) ? 0 : 1;
      sat[(i + 1) * (nJ + 1) + (j + 1)] = sat[i * (nJ + 1) + (j + 1)] + row;
    }
  }
  const eps = 1e-7 * Math.max(ca, cb);
  const rectIsFree = (a0: number, a1: number, b0: number, b1: number) => {
    if (a1 < a0) a0 = a1 = (a0 + a1) / 2;
    if (b1 < b0) b0 = b1 = (b0 + b1) / 2;
    const i0 = Math.floor((a0 + eps) / ca);
    const i1 = Math.max(i0, Math.floor((a1 - eps) / ca));
    const j0 = Math.floor((b0 + eps) / cb) - jMin;
    const j1 = Math.max(j0, Math.floor((b1 - eps) / cb) - jMin);
    if (i0 < 0 || j0 < 0 || i1 >= nI || j1 >= nJ) return false; // reaches outside: rock
    const w = nJ + 1;
    return sat[(i1 + 1) * w + (j1 + 1)] - sat[i0 * w + (j1 + 1)] - sat[(i1 + 1) * w + j0] + sat[i0 * w + j0] === 0;
  };
  const boxIsFree = (a0: number, b0: number, size: number) => rectIsFree(a0, a0 + size, b0, b0 + size);
  const step = Math.min(ca, cb) / 2;
  const pathIsFree = (as: number, bs: number, ae: number, be: number, ha0: number, hb0: number, k: number, tol: number) => {
    // Fast path: the bounding box of the whole sweep (start and end poses, both shrunk) is free.
    {
      const ha1 = Math.max(0, ha0 * k - tol);
      const hb1 = Math.max(0, hb0 * k - tol);
      const ha = Math.max(0, ha0 - tol);
      const hb = Math.max(0, hb0 - tol);
      if (rectIsFree(Math.min(as - ha, ae - ha1), Math.max(as + ha, ae + ha1), Math.min(bs - hb, be - hb1), Math.max(bs + hb, be + hb1))) return true;
    }
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(ae - as), Math.abs(be - bs), (k - 1) * Math.max(ha0, hb0)) / step));
    // Shrunk pose at eased progress s: centre ± max(0, half(s) − tol).
    const pose = (s: number): [number, number, number, number] => {
      const a = as + (ae - as) * s;
      const b = bs + (be - bs) * s;
      const g = 1 + (k - 1) * s;
      const ha = Math.max(0, ha0 * g - tol);
      const hb = Math.max(0, hb0 * g - tol);
      return [a - ha, a + ha, b - hb, b + hb];
    };
    let prev = pose(0);
    for (let q = 1; q <= n; q++) {
      const cur = pose(q / n);
      const ok = rectIsFree(
        Math.min(prev[0], cur[0]),
        Math.max(prev[1], cur[1]),
        Math.min(prev[2], cur[2]),
        Math.max(prev[3], cur[3]),
      );
      if (!ok) return false;
      prev = cur;
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
    rectIsFree,
    boxIsFree,
    pathIsFree,
  };
}

/** Footprint of a model's own blocks. */
export function modelFootprint(model: BlockModel, face: FreeFace): Footprint {
  return createFootprint(model.grid, modelColumnMask(model), face);
}
