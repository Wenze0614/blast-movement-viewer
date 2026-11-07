/**
 * M5/M6 — dig lines as grade-threshold contours (docs/02-plan.md ADR-6). Label in the UI:
 * "grade-threshold contour, not an optimised dig limit".
 *
 * 1. Column tonnage-weighted mean grade per plan cell (in-situ grid → original line,
 *    post-blast grid → adjusted line). Same algorithm for both, so the comparison is fair.
 * 2. Gaussian blur, σ = 1 cell (stands in for a minimum mining width).
 * 3. d3-contour (marching squares) at the cut-off → MultiPolygon with holes, in metres.
 * 4. Drop rings smaller than 4 cells (outer rings take their holes with them; small holes are
 *    filled, i.e. dug as ore).
 */
import { contours } from 'd3-contour';
import { multiPolygonArea, ringSignedArea } from './geometry';
import {
  columnSums,
  inSituPlanGrid,
  postBlastPlanGrid,
  smoothedColumnGrade,
  type PlanGrid,
} from './grid2d';
import type { BlockModel, DigPolygon, MovementResult, Vec2 } from './types';

export const DIG_LINE_SIGMA_CELLS = 1;
export const DIG_LINE_MIN_RING_CELLS = 4;

export interface ContourOptions {
  id: DigPolygon['id'];
  kind: DigPolygon['kind'];
  /** g/t */
  cutoff: number;
  /** default 1 */
  sigmaCells?: number;
  /** default 4 */
  minRingCells?: number;
}

/**
 * Contour a per-cell grade field (index ix + nx·iy) at `cutoff`. d3-contour places the value of
 * cell i at grid coordinate i + 0.5, so world = origin + coord · cellSize maps it to the cell
 * centre.
 */
export function contourGradeField(
  grid: PlanGrid,
  field: ArrayLike<number>,
  cutoff: number,
  minRingCells = DIG_LINE_MIN_RING_CELLS,
): Vec2[][][] {
  const { nx, ny, cellSize } = grid;
  const [ox, oy] = grid.origin;
  const gen = contours().size([nx, ny]).smooth(true);
  const mp = gen.contour(Array.from(field), cutoff);
  const minArea = minRingCells * cellSize * cellSize;
  const out: Vec2[][][] = [];
  for (const poly of mp.coordinates) {
    const rings: Vec2[][] = [];
    for (let r = 0; r < poly.length; r++) {
      const src = poly[r];
      // GeoJSON rings repeat the first point; DigPolygon rings are closed implicitly.
      const last = src.length - 1;
      const closed = last > 0 && src[0][0] === src[last][0] && src[0][1] === src[last][1];
      const ring: Vec2[] = [];
      for (let i = 0; i < (closed ? last : src.length); i++) {
        ring.push([ox + src[i][0] * cellSize, oy + src[i][1] * cellSize]);
      }
      if (ring.length < 3 || Math.abs(ringSignedArea(ring)) < minArea) {
        if (r === 0) break; // outer ring too small: drop the polygon with its holes
        continue; // small hole: fill it
      }
      rings.push(ring);
    }
    if (rings.length > 0) out.push(rings);
  }
  return out;
}

/** ADR-6 steps 1–4 for any block positions on any plan grid. */
export function buildDigPolygon(
  grid: PlanGrid,
  positions: Float32Array,
  tonnes: Float32Array,
  grade: Float32Array,
  opts: ContourOptions,
): DigPolygon {
  const sigma = opts.sigmaCells ?? DIG_LINE_SIGMA_CELLS;
  const field = smoothedColumnGrade(columnSums(grid, positions, tonnes, grade), sigma);
  const polygons = contourGradeField(grid, field, opts.cutoff, opts.minRingCells ?? DIG_LINE_MIN_RING_CELLS);
  return {
    id: opts.id,
    kind: opts.kind,
    polygons,
    method: 'grade-contour',
    cutoff: opts.cutoff,
    smoothingSigmaCells: sigma,
    areaM2: multiPolygonArea(polygons),
  };
}

/** M5: original dig line, contoured from the in-situ model. */
export function originalDigPolygon(model: BlockModel, cutoff = model.grades.cutoff): DigPolygon {
  return buildDigPolygon(inSituPlanGrid(model), model.centroid, model.tonnes, model.grade, {
    id: 'original',
    kind: 'original',
    cutoff,
  });
}

/** M6: adjusted dig line, contoured from the post-blast model with the same algorithm. */
export function adjustedDigPolygon(model: BlockModel, movement: MovementResult, cutoff = model.grades.cutoff): DigPolygon {
  return buildDigPolygon(postBlastPlanGrid(movement), movement.end, model.tonnes, model.grade, {
    id: 'adjusted',
    kind: 'adjusted',
    cutoff,
  });
}
