/**
 * Synthetic blastholes + BlastSummary / BlastDetail builders (docs/02-plan.md §3.2, P9).
 *
 * DISPLAY ONLY: the hole pattern is not an input to the movement heuristic. Note the inversion vs
 * reality: on a real mine blasthole samples FEED the grade-control model; here each hole's
 * `sampledGrade` is derived FROM the synthetic model (column tonnage-weighted mean + noise).
 */
import type { BlastDetail, BlastHole, BlastPattern, BlastSummary } from './api-types';
import type { BlastConfig } from './blasts';
import { configBlockCount, generateBlockModel } from './blockModel';
import { benchFrame } from './footprint';
import { createRng, deriveSeed } from './rng';
import type { BlastParameters, BlockModel, Vec3 } from './types';

export const BLAST_DISCLAIMER = 'Synthetic data. Heuristic movement model, not physics.';

/** Relative (log-space) noise on the sampled column grade. */
const SAMPLE_LOG_SIGMA = 0.15;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Per plan column (i + nx·j): tonnage-weighted mean grade of its blocks; NaN for an empty column. */
function columnMeanGrades(model: BlockModel): Float64Array {
  const plan = model.grid.nx * model.grid.ny;
  const tg = new Float64Array(plan);
  const t = new Float64Array(plan);
  for (let n = 0; n < model.count; n++) {
    const c = model.cell[n] % plan;
    tg[c] += model.tonnes[n] * model.grade[n];
    t[c] += model.tonnes[n];
  }
  const out = new Float64Array(plan);
  for (let c = 0; c < plan; c++) out[c] = t[c] > 0 ? tg[c] / t[c] : NaN;
  return out;
}

/**
 * Holes on the burden × spacing pattern, centred on the grid's bounding box and kept only where
 * the collar lies over a present block column (inside the blast outline). Row 0 is nearest the
 * free face. Collar at the crest, toe at the floor minus subdrill. Deterministic per model seed.
 */
export function generateHoles(model: BlockModel, pattern: BlastPattern, freeFace: BlastParameters['freeFace']): BlastHole[] {
  const { grid } = model;
  const frame = benchFrame(grid, freeFace);
  const zToe = grid.origin[2];
  const zCrest = zToe + grid.nz * grid.blockSize[2];
  const [ox, oy] = grid.origin;
  const [bx, by] = grid.blockSize;
  const colGrade = columnMeanGrades(model);
  const rows = pattern.rows;
  const perRow = pattern.holesPerRow;
  // Centre the pattern on the bench footprint.
  const a0 = (frame.A - rows * pattern.burden) / 2 + pattern.burden / 2;
  const b0 = (frame.W - perRow * pattern.spacing) / 2 + pattern.spacing / 2;
  const rng = createRng(deriveSeed(model.seed, 'holes/sample'));
  const holes: BlastHole[] = [];
  for (let r = 0; r < rows; r++) {
    // row 0 = front: largest distance from the back wall
    const a = a0 + (rows - 1 - r) * pattern.burden;
    for (let h = 0; h < perRow; h++) {
      const b = b0 + h * pattern.spacing;
      const [x, y] = frame.toWorld(a, b);
      const i = Math.floor((x - ox) / bx);
      const j = Math.floor((y - oy) / by);
      const mean = i >= 0 && i < grid.nx && j >= 0 && j < grid.ny ? colGrade[i + grid.nx * j] : NaN;
      if (Number.isNaN(mean)) continue; // outside the blast outline: not drilled
      const sampledGrade = Math.round(mean * Math.exp(SAMPLE_LOG_SIGMA * rng.normal()) * 100) / 100;
      const collar: Vec3 = [x, y, zCrest];
      const toe: Vec3 = [x, y, zToe - pattern.subdrill];
      holes.push({ id: `R${pad2(r)}-H${pad2(h)}`, row: r, collar, toe, sampledGrade });
    }
  }
  return holes;
}

export function buildBlastSummary(cfg: BlastConfig): BlastSummary {
  return {
    id: cfg.id,
    name: cfg.name,
    description: cfg.description,
    blockCount: configBlockCount(cfg),
    benchRL: cfg.grid.origin[2],
    freeFace: cfg.freeFace,
  };
}

/** Full detail incl. holes. Pass `model` if already generated to avoid regenerating it. */
export function buildBlastDetail(cfg: BlastConfig, model: BlockModel = generateBlockModel(cfg)): BlastDetail {
  const g = cfg.grid;
  return {
    ...buildBlastSummary(cfg),
    grid: { origin: [...g.origin], blockSize: [...g.blockSize], nx: g.nx, ny: g.ny, nz: g.nz },
    grades: { ...cfg.grades },
    pattern: { ...cfg.pattern },
    holes: generateHoles(model, cfg.pattern, cfg.freeFace),
    defaultParams: { ...cfg.defaultParams },
    disclaimer: BLAST_DISCLAIMER,
  };
}
