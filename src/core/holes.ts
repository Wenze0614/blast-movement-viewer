/**
 * Synthetic blastholes + BlastSummary / BlastDetail builders (docs/02-plan.md §3.2, P9).
 *
 * DISPLAY ONLY: the hole pattern is not an input to the movement heuristic. Note the inversion vs
 * reality: on a real mine blasthole samples FEED the grade-control model; here each hole's
 * `sampledGrade` is derived FROM the synthetic model (column tonnage-weighted mean + noise).
 */
import type { BlastDetail, BlastHole, BlastPattern, BlastSummary } from './api-types';
import type { BlastConfig } from './blasts';
import { generateBlockModel } from './blockModel';
import { createRng, deriveSeed } from './rng';
import type { BlastParameters, BlockModel, GridSpec, Vec3 } from './types';

export const BLAST_DISCLAIMER = 'Synthetic data. Heuristic movement model, not physics.';

/** Relative (log-space) noise on the sampled column grade. */
const SAMPLE_LOG_SIGMA = 0.15;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Plan-axis frame for a free face: `along` points from the back wall toward the face. */
function faceFrame(grid: GridSpec, freeFace: BlastParameters['freeFace']) {
  const [ox, oy] = grid.origin;
  const lx = grid.nx * grid.blockSize[0];
  const ly = grid.ny * grid.blockSize[1];
  switch (freeFace) {
    case 'east':
      return { length: lx, width: ly, toXY: (a: number, b: number): [number, number] => [ox + a, oy + b] };
    case 'west':
      return { length: lx, width: ly, toXY: (a: number, b: number): [number, number] => [ox + lx - a, oy + b] };
    case 'north':
      return { length: ly, width: lx, toXY: (a: number, b: number): [number, number] => [ox + b, oy + a] };
    case 'south':
      return { length: ly, width: lx, toXY: (a: number, b: number): [number, number] => [ox + b, oy + ly - a] };
  }
}

/** Tonnage-weighted mean grade of the block column containing plan point (x, y). */
function columnMeanGrade(model: BlockModel, x: number, y: number): number {
  const { origin, blockSize, nx, ny, nz } = model.grid;
  const i = Math.min(nx - 1, Math.max(0, Math.floor((x - origin[0]) / blockSize[0])));
  const j = Math.min(ny - 1, Math.max(0, Math.floor((y - origin[1]) / blockSize[1])));
  let tg = 0;
  let t = 0;
  for (let k = 0; k < nz; k++) {
    const id = i + nx * (j + ny * k);
    tg += model.tonnes[id] * model.grade[id];
    t += model.tonnes[id];
  }
  return t > 0 ? tg / t : 0;
}

/**
 * Holes on the burden × spacing pattern, centred on the bench. Row 0 is nearest the free face.
 * Collar at the crest, toe at the floor minus subdrill. Deterministic per model seed.
 */
export function generateHoles(model: BlockModel, pattern: BlastPattern, freeFace: BlastParameters['freeFace']): BlastHole[] {
  const { grid } = model;
  const frame = faceFrame(grid, freeFace);
  const zToe = grid.origin[2];
  const zCrest = zToe + grid.nz * grid.blockSize[2];
  const rows = pattern.rows;
  const perRow = pattern.holesPerRow;
  // Centre the pattern on the bench footprint.
  const a0 = (frame.length - rows * pattern.burden) / 2 + pattern.burden / 2;
  const b0 = (frame.width - perRow * pattern.spacing) / 2 + pattern.spacing / 2;
  const rng = createRng(deriveSeed(model.seed, 'holes/sample'));
  const holes: BlastHole[] = [];
  for (let r = 0; r < rows; r++) {
    // row 0 = front: largest distance from the back wall
    const a = a0 + (rows - 1 - r) * pattern.burden;
    for (let h = 0; h < perRow; h++) {
      const b = b0 + h * pattern.spacing;
      const [x, y] = frame.toXY(a, b);
      const mean = columnMeanGrade(model, x, y);
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
    blockCount: cfg.grid.nx * cfg.grid.ny * cfg.grid.nz,
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
