/**
 * M5/M6 — dig lines (docs/02-plan.md ADR-6): core/grid2d.ts + core/digline.ts.
 */
import { describe, expect, it } from 'vitest';
import { getBlastConfig } from '../blasts';
import { generateBlockModel } from '../blockModel';
import { DEFAULT_BLAST_PARAMETERS } from '../defaults';
import { adjustedDigPolygon, buildDigPolygon, contourGradeField, originalDigPolygon } from '../digline';
import { multiPolygonArea, pointInPolygon } from '../geometry';
import {
  columnMeanGrade,
  columnSums,
  gaussianBlur,
  gaussianKernel,
  inSituPlanGrid,
  smoothedColumnGrade,
  type PlanGrid,
} from '../grid2d';
import { computeMovement } from '../movement';

describe('grid2d (ADR-6 steps 1–2)', () => {
  it('column tonnage-weighted mean grade per plan cell', () => {
    const grid: PlanGrid = { origin: [0, 0], cellSize: 2, nx: 2, ny: 1 };
    // cell 0 holds two blocks (30 t @ 1, 10 t @ 3); cell 1 holds one block; one block off-grid
    const positions = Float32Array.from([1, 1, 0, 1.5, 0.5, 2, 3, 1, 0, 9, 9, 0]);
    const tonnes = Float32Array.from([30, 10, 20, 99]);
    const grade = Float32Array.from([1, 3, 0.4, 5]);
    const sums = columnSums(grid, positions, tonnes, grade);
    expect(Array.from(sums.tonnes)).toEqual([40, 20]);
    const g = columnMeanGrade(sums);
    expect(g[0]).toBeCloseTo((30 * 1 + 10 * 3) / 40, 6); // 1.5, not the plain mean 2
    expect(g[1]).toBeCloseTo(0.4, 6);
  });

  it('gaussian kernel (σ = 1 cell) is normalised with radius 3σ', () => {
    const k = gaussianKernel(1);
    expect(k.length).toBe(7);
    expect(k.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(k[3]).toBeGreaterThan(k[2]);
  });

  it('blur keeps a constant field constant up to the edges (edge weights renormalised)', () => {
    const out = gaussianBlur(new Float64Array(5 * 4).fill(2), 5, 4, 1);
    for (const v of out) expect(v).toBeCloseTo(2, 12);
  });

  it('smoothed grade ignores empty cells (tonnage-weighted blur)', () => {
    const grid: PlanGrid = { origin: [0, 0], cellSize: 1, nx: 5, ny: 1 };
    // one column of 1 g/t in the middle, empty cells around it
    const s = smoothedColumnGrade(columnSums(grid, Float32Array.from([2.5, 0.5, 0]), Float32Array.from([10]), Float32Array.from([1])), 1);
    for (const v of s) expect(v).toBeCloseTo(1, 10);
  });
});

describe('dig-line contour (ADR-6 steps 3–4)', () => {
  const grid: PlanGrid = { origin: [100, 200], cellSize: 2.5, nx: 20, ny: 20 };
  const field = (ore: (ix: number, iy: number) => boolean) => {
    const f = new Float64Array(grid.nx * grid.ny);
    for (let iy = 0; iy < grid.ny; iy++) for (let ix = 0; ix < grid.nx; ix++) f[ix + grid.nx * iy] = ore(ix, iy) ? 2 : 0;
    return f;
  };

  it('contours at the cut-off in metres (cell value at its centre)', () => {
    // 6×6 ore cells (ix, iy in 7..12) at 2 g/t, waste 0. Cell i's value sits at i + 0.5, so the
    // 0.5 contour is at 6.5 + 0.25 = 6.75 on the low side and 12.5 + 0.75 = 13.25 on the high
    // side: a 6.5-cell square less four corner cuts of 0.75²/2 → 41.125 cells.
    const polys = contourGradeField(grid, field((ix, iy) => ix >= 7 && ix <= 12 && iy >= 7 && iy <= 12), 0.5);
    expect(polys.length).toBe(1);
    expect(polys[0].length).toBe(1);
    expect(multiPolygonArea(polys)).toBeCloseTo(41.125 * 6.25, 8);
    const xs = polys[0][0].map((p) => p[0]);
    const ys = polys[0][0].map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(100 + 6.75 * 2.5, 8);
    expect(Math.max(...xs)).toBeCloseTo(100 + 13.25 * 2.5, 8);
    expect(Math.min(...ys)).toBeCloseTo(200 + 6.75 * 2.5, 8);
    // rings are closed implicitly (no repeated first point)
    const ring = polys[0][0];
    expect(ring[0]).not.toEqual(ring[ring.length - 1]);
  });

  it('keeps holes: a waste core inside an ore ring is a hole ring', () => {
    const ore = (ix: number, iy: number) => ix >= 4 && ix <= 15 && iy >= 4 && iy <= 15 && !(ix >= 8 && ix <= 11 && iy >= 8 && iy <= 11);
    const polys = contourGradeField(grid, field(ore), 0.5);
    expect(polys.length).toBe(1);
    expect(polys[0].length).toBe(2); // outer + hole
    expect(pointInPolygon(100 + 10 * 2.5, 200 + 10 * 2.5, polys)).toBe(false); // in the hole
    expect(pointInPolygon(100 + 5.5 * 2.5, 200 + 5.5 * 2.5, polys)).toBe(true);
  });

  it('drops rings smaller than 4 cells (small pods and small holes)', () => {
    // a 1-cell ore spot is dropped; a 1-cell waste hole in a big ore body is filled
    const ore = (ix: number, iy: number) => (ix === 2 && iy === 2) || (ix >= 8 && ix <= 16 && iy >= 8 && iy <= 16 && !(ix === 12 && iy === 12));
    const polys = contourGradeField(grid, field(ore), 0.5);
    expect(polys.length).toBe(1);
    expect(polys[0].length).toBe(1);
    expect(pointInPolygon(100 + 12.5 * 2.5, 200 + 12.5 * 2.5, polys)).toBe(true);
    // with no minimum both survive
    const raw = contourGradeField(grid, field(ore), 0.5, 0);
    expect(raw.length).toBe(2);
  });

  it('empty field → no polygons, area 0', () => {
    const d = buildDigPolygon(grid, new Float32Array(0), new Float32Array(0), new Float32Array(0), {
      id: 'x',
      kind: 'manual',
      cutoff: 0.5,
    });
    expect(d.polygons).toEqual([]);
    expect(d.areaM2).toBe(0);
  });
});

describe('original and adjusted dig lines (M5, M6)', () => {
  const model = generateBlockModel(getBlastConfig('b1040-017')!);
  const movement = computeMovement(model, DEFAULT_BLAST_PARAMETERS);
  const original = originalDigPolygon(model);
  const adjusted = adjustedDigPolygon(model, movement);

  it('carry the DigPolygon metadata', () => {
    expect(original).toMatchObject({ id: 'original', kind: 'original', method: 'grade-contour', cutoff: 0.5, smoothingSigmaCells: 1 });
    expect(adjusted).toMatchObject({ id: 'adjusted', kind: 'adjusted', method: 'grade-contour', cutoff: 0.5, smoothingSigmaCells: 1 });
    expect(original.areaM2).toBeCloseTo(multiPolygonArea(original.polygons), 8);
    expect(adjusted.areaM2).toBeCloseTo(multiPolygonArea(adjusted.polygons), 8);
  });

  it('original line covers roughly the in-situ ore footprint and stays on the bench', () => {
    const grid = inSituPlanGrid(model);
    expect(original.areaM2).toBeGreaterThan(0.1 * 100 * 60);
    expect(original.areaM2).toBeLessThan(0.4 * 100 * 60);
    for (const p of original.polygons)
      for (const ring of p)
        for (const [x, y] of ring) {
          expect(x).toBeGreaterThanOrEqual(grid.origin[0]);
          expect(x).toBeLessThanOrEqual(grid.origin[0] + grid.nx * grid.cellSize);
          expect(y).toBeGreaterThanOrEqual(grid.origin[1]);
          expect(y).toBeLessThanOrEqual(grid.origin[1] + grid.ny * grid.cellSize);
        }
  });

  it('adjusted line is shifted toward the free face (+x) relative to the original', () => {
    const centroidX = (polys: typeof original.polygons) => {
      let s = 0;
      let n = 0;
      for (const p of polys)
        for (const [x] of p[0]) {
          s += x;
          n++;
        }
      return s / n;
    };
    expect(centroidX(adjusted.polygons)).toBeGreaterThan(centroidX(original.polygons) + 2);
  });

  it('two pods (b1030-022) give a MultiPolygon with two outer rings', () => {
    const m = generateBlockModel(getBlastConfig('b1030-022')!);
    expect(originalDigPolygon(m).polygons.length).toBe(2);
  });

  it('is deterministic', () => {
    expect(originalDigPolygon(model)).toEqual(original);
    expect(adjustedDigPolygon(model, movement)).toEqual(adjusted);
  });
});
