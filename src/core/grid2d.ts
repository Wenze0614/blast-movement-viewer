/**
 * Plan-view grids for dig-line contouring (docs/02-plan.md ADR-6 steps 1–2).
 *
 * A PlanGrid cell (ix, iy) covers [origin + ix·cellSize, origin + (ix+1)·cellSize) in x and the
 * same in y; values are stored at index ix + nx·iy.
 */
import type { BlockModel, MovementResult, Vec2 } from './types';

export interface PlanGrid {
  /** m, min corner of cell (0, 0) */
  origin: Vec2;
  /** m */
  cellSize: number;
  nx: number;
  ny: number;
}

/** Per-cell column sums: Σ t and Σ t·g (g/t × t = g Au). */
export interface ColumnSums {
  grid: PlanGrid;
  /** t per cell */
  tonnes: Float64Array;
  /** g Au per cell */
  metal: Float64Array;
}

/** In-situ plan grid of a model (one cell per block column). Assumes square plan blocks. */
export function inSituPlanGrid(model: BlockModel): PlanGrid {
  const g = model.grid;
  return { origin: [g.origin[0], g.origin[1]], cellSize: g.blockSize[0], nx: g.nx, ny: g.ny };
}

/** Post-blast plan grid (the movement's re-grid, cell = c·k). */
export function postBlastPlanGrid(movement: MovementResult): PlanGrid {
  const p = movement.postGrid;
  return { origin: [p.origin[0], p.origin[1]], cellSize: p.cellSize, nx: p.nx, ny: p.ny };
}

/**
 * Accumulate block tonnes and metal into plan cells by each block's (x, y). `positions` is a 3N
 * centroid array (model.centroid for in situ, movement.end for post-blast). Blocks outside the
 * grid are ignored.
 */
export function columnSums(
  grid: PlanGrid,
  positions: Float32Array,
  tonnes: Float32Array,
  grade: Float32Array,
): ColumnSums {
  const { nx, ny, cellSize } = grid;
  const [ox, oy] = grid.origin;
  const t = new Float64Array(nx * ny);
  const m = new Float64Array(nx * ny);
  const n = tonnes.length;
  for (let b = 0; b < n; b++) {
    const ix = Math.floor((positions[3 * b] - ox) / cellSize);
    const iy = Math.floor((positions[3 * b + 1] - oy) / cellSize);
    if (ix < 0 || ix >= nx || iy < 0 || iy >= ny) continue;
    const c = ix + nx * iy;
    t[c] += tonnes[b];
    m[c] += tonnes[b] * grade[b];
  }
  return { grid, tonnes: t, metal: m };
}

/** Column tonnage-weighted mean grade per cell (g/t); 0 where a cell holds no material. */
export function columnMeanGrade(sums: ColumnSums): Float64Array {
  const out = new Float64Array(sums.tonnes.length);
  for (let c = 0; c < out.length; c++) out[c] = sums.tonnes[c] > 0 ? sums.metal[c] / sums.tonnes[c] : 0;
  return out;
}

/** Normalised 1D Gaussian kernel, radius ceil(3σ). */
export function gaussianKernel(sigma: number): Float64Array {
  if (sigma <= 0) return Float64Array.of(1);
  const r = Math.ceil(3 * sigma);
  const k = new Float64Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/**
 * Separable Gaussian blur (σ in cells). Cells outside the grid are treated as missing (weights
 * renormalised), so the bench edge is not artificially diluted.
 */
export function gaussianBlur(values: ArrayLike<number>, nx: number, ny: number, sigma: number): Float64Array {
  const k = gaussianKernel(sigma);
  const r = (k.length - 1) / 2;
  const tmp = new Float64Array(nx * ny);
  const out = new Float64Array(nx * ny);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      let s = 0;
      let w = 0;
      for (let d = -r; d <= r; d++) {
        const jx = ix + d;
        if (jx < 0 || jx >= nx) continue;
        s += k[d + r] * values[jx + nx * iy];
        w += k[d + r];
      }
      tmp[ix + nx * iy] = s / w;
    }
  }
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      let s = 0;
      let w = 0;
      for (let d = -r; d <= r; d++) {
        const jy = iy + d;
        if (jy < 0 || jy >= ny) continue;
        s += k[d + r] * tmp[ix + nx * jy];
        w += k[d + r];
      }
      out[ix + nx * iy] = s / w;
    }
  }
  return out;
}

/**
 * Smoothed column grade for contouring (ADR-6 steps 1–2): the Gaussian blur is applied to the
 * column metal and tonnes separately and divided, i.e. a TONNAGE-WEIGHTED blur of the column mean
 * grade. On the in-situ grid (equal columns) this equals blurring the grade; on the post-blast
 * grid it stops empty floor cells (0 t) from pulling the grade of a thin muckpile toe to zero.
 * Cells with no material nearby get 0 g/t.
 */
export function smoothedColumnGrade(sums: ColumnSums, sigma: number): Float64Array {
  const { nx, ny } = sums.grid;
  const bt = gaussianBlur(sums.tonnes, nx, ny, sigma);
  const bm = gaussianBlur(sums.metal, nx, ny, sigma);
  const out = new Float64Array(nx * ny);
  // Tonnes below this (relative to a typical column) count as "no material".
  let maxT = 0;
  for (let c = 0; c < bt.length; c++) if (bt[c] > maxT) maxT = bt[c];
  const eps = maxT * 1e-9;
  for (let c = 0; c < out.length; c++) out[c] = bt[c] > eps ? bm[c] / bt[c] : 0;
  return out;
}
