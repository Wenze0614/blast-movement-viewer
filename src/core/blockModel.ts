/**
 * M1 — synthetic block model (docs/02-plan.md §1.2, §3.1).
 *
 * Grid convention: origin = MIN corner of the first block; grid cell = i + nx * (j + ny * k);
 * centroid = origin + (ijk + ½) · blockSize; k = nz − 1 is the top flitch.
 *
 * Sparse: a blast outline (plan polygon) selects the columns that hold blocks; every flitch of a
 * selected column is present. Block id = index into the arrays; `cell[id]` is its grid cell.
 */
import { DEFAULT_GRADE_SETTINGS, DEFAULT_PATTERN } from './defaults';
import { outlineColumnMask } from './footprint';
import { canonicalJson, fnv1a64 } from './hash';
import { createOrebodySampler, type OrebodySpec } from './orebody';
import {
  OreClass,
  RockType,
  type BlastPattern,
  type Block,
  type BlockModel,
  type GradeSettings,
  type GridSpec,
  type Vec2,
  type Vec3,
} from './types';

/** Everything `generateBlockModel` needs. `BlastConfig` (blasts.ts) extends this. */
export interface BlockModelConfig {
  grid: GridSpec;
  grades: GradeSettings;
  orebody: OrebodySpec;
  /** Model seed (grade noise). Independent of BlastParameters.seed (movement noise). */
  seed: number;
  /**
   * Blast outline: a closed plan ring (world x, y, m). Only columns whose centre lies inside it
   * hold blocks. Omitted → every column of the grid (a rectangular blast).
   */
  outline?: readonly Vec2[];
  /** Drill pattern; its burden and spacing shape the firing sequence. Omitted → DEFAULT_PATTERN. */
  pattern?: BlastPattern;
}

/**
 * Version of the block-model generator (this file + orebody.ts + rng.ts). Bump it whenever a code
 * change alters generated grades/densities for the SAME config, so cached results keyed on
 * `configHash` (ADR-12 immutable CDN responses) are invalidated.
 */
export const MODEL_GENERATOR_VERSION = 3;

/**
 * Canonical hash of everything that determines a block model: generator version, grid, grade
 * settings, the complete ore body definition, the outline, the drill pattern (it shapes the firing
 * sequence, so it changes the movement) and the model seed. Display-only fields of a BlastConfig
 * (id, name, description, default params) are deliberately excluded.
 */
export function blockModelConfigHash(cfg: BlockModelConfig): string {
  const { grid, grades, orebody, seed } = cfg;
  const outline = cfg.outline ?? null;
  const pattern = cfg.pattern ?? DEFAULT_PATTERN;
  return fnv1a64(`bmv-model/v${MODEL_GENERATOR_VERSION}|${canonicalJson({ grid, grades, orebody, seed, outline, pattern })}`);
}

/** Cells in the bounding grid (nx·ny·nz); a sparse model holds `count` ≤ this many blocks. */
export const gridCellCount = (grid: GridSpec): number => grid.nx * grid.ny * grid.nz;

/** Blocks a config generates: columns inside the outline × flitches. Cheap (no grades). */
export function configBlockCount(cfg: Pick<BlockModelConfig, 'grid' | 'outline'>): number {
  let columns = 0;
  for (const v of outlineColumnMask(cfg.grid, cfg.outline)) columns += v;
  return columns * cfg.grid.nz;
}

/** m³ */
export const blockVolume = (grid: GridSpec): number => grid.blockSize[0] * grid.blockSize[1] * grid.blockSize[2];

/** Grid cell index of (i, j, k). */
export function cellIndex(grid: GridSpec, i: number, j: number, k: number): number {
  return i + grid.nx * (j + grid.ny * k);
}

/** (i, j, k) of a grid cell index. */
export function cellIjk(grid: GridSpec, cell: number): [number, number, number] {
  const i = cell % grid.nx;
  const rest = (cell - i) / grid.nx;
  const j = rest % grid.ny;
  const k = (rest - j) / grid.ny;
  return [i, j, k];
}

/** Id of the block in grid cell (i, j, k), or -1 when that cell holds none (binary search). */
export function blockIdAt(model: BlockModel, i: number, j: number, k: number): number {
  const { nx, ny, nz } = model.grid;
  if (i < 0 || i >= nx || j < 0 || j >= ny || k < 0 || k >= nz) return -1;
  const target = i + nx * (j + ny * k);
  const cells = model.cell;
  let lo = 0;
  let hi = cells.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cells[mid];
    if (c === target) return mid;
    if (c < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/**
 * Complete grade settings that may predate newer keys (a blast detail cached before `mediumGrade`
 * existed): a missing or non-finite threshold takes its default, then the breaks are made
 * monotonic (mediumGrade clamped into [cutoff, highGrade]) so every class stays well defined.
 */
export function completeGrades(g: Partial<GradeSettings> | null | undefined): GradeSettings {
  const d = DEFAULT_GRADE_SETTINGS;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const cutoff = num(g?.cutoff, d.cutoff);
  const highGrade = Math.max(cutoff, num(g?.highGrade, d.highGrade));
  const mediumGrade = Math.min(highGrade, Math.max(cutoff, num(g?.mediumGrade, d.mediumGrade)));
  return { element: 'Au', unit: 'g/t', cutoff, mediumGrade, highGrade };
}

/** Pre-blast class by grade: waste < cutoff ≤ low < mediumGrade ≤ medium < highGrade ≤ high. */
export function classifyGrade(grade: number, grades: GradeSettings): OreClass {
  if (grade >= grades.highGrade) return OreClass.HighGrade;
  if (grade >= grades.mediumGrade) return OreClass.MediumGrade;
  if (grade >= grades.cutoff) return OreClass.LowGrade;
  return OreClass.Waste;
}

/** Deterministic: same config → byte-identical typed arrays. */
export function generateBlockModel(cfg: BlockModelConfig): BlockModel {
  const { grid, grades, orebody, seed } = cfg;
  const { nx, ny, nz } = grid;
  const [ox, oy, oz] = grid.origin;
  const [bx, by, bz] = grid.blockSize;
  const vol = bx * by * bz;
  const columns = outlineColumnMask(grid, cfg.outline);
  let perFlitch = 0;
  for (const v of columns) perFlitch += v;
  const count = perFlitch * nz;

  const cell = new Uint32Array(count);
  const centroid = new Float32Array(3 * count);
  const grade = new Float32Array(count);
  const density = new Float32Array(count);
  const tonnes = new Float32Array(count);
  const rockType = new Uint8Array(count);
  const oreClass = new Uint8Array(count);

  const sampler = createOrebodySampler(orebody, seed);
  // Iterate in grid-cell order so ids follow the cells and the nugget draws are in a fixed order.
  let id = 0;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (!columns[i + nx * j]) continue;
        cell[id] = i + nx * (j + ny * k);
        const x = ox + (i + 0.5) * bx;
        const y = oy + (j + 0.5) * by;
        const z = oz + (k + 0.5) * bz;
        centroid[3 * id] = x;
        centroid[3 * id + 1] = y;
        centroid[3 * id + 2] = z;
        const s = sampler.sample(x, y, z);
        const rt = s.indicator >= orebody.mineralisedThreshold ? RockType.Mineralised : RockType.Host;
        const d = rt === RockType.Mineralised ? orebody.density.mineralised : orebody.density.host;
        grade[id] = s.grade;
        rockType[id] = rt;
        density[id] = d;
        tonnes[id] = vol * d;
        // Classify the stored (Float32) grade so class and grade never disagree at the boundary.
        oreClass[id] = classifyGrade(grade[id], grades);
        id++;
      }
    }
  }

  return {
    grid: { origin: [ox, oy, oz], blockSize: [bx, by, bz], nx, ny, nz },
    grades: { ...grades },
    count,
    cell,
    pattern: { ...(cfg.pattern ?? DEFAULT_PATTERN) },
    centroid,
    grade,
    density,
    tonnes,
    rockType,
    oreClass,
    seed,
    configHash: blockModelConfigHash(cfg),
  };
}

/** Logical view of one block, built on demand (inspector, export). */
export function getBlock(model: BlockModel, id: number): Block {
  const o = 3 * id;
  const position: Vec3 = [model.centroid[o], model.centroid[o + 1], model.centroid[o + 2]];
  return {
    id,
    ijk: cellIjk(model.grid, model.cell[id]),
    position,
    size: [...model.grid.blockSize],
    rockType: model.rockType[id] as RockType,
    grade: model.grade[id],
    density: model.density[id],
    tonnes: model.tonnes[id],
    oreClass: model.oreClass[id] as OreClass,
  };
}

/** Σ tonnes of blocks with grade ≥ cutoff ÷ Σ tonnes. */
export function oreTonnesFraction(model: BlockModel): number {
  let ore = 0;
  let total = 0;
  for (let n = 0; n < model.count; n++) {
    total += model.tonnes[n];
    if (model.grade[n] >= model.grades.cutoff) ore += model.tonnes[n];
  }
  return total > 0 ? ore / total : 0;
}
