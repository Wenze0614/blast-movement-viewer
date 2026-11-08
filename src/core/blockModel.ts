/**
 * M1 — synthetic block model (docs/02-plan.md §1.2, §3.1).
 *
 * Grid convention: origin = MIN corner of the first block; id = i + nx * (j + ny * k);
 * centroid = origin + (ijk + ½) · blockSize; k = nz − 1 is the top flitch.
 */
import { canonicalJson, fnv1a64 } from './hash';
import { createOrebodySampler, type OrebodySpec } from './orebody';
import {
  OreClass,
  RockType,
  type Block,
  type BlockModel,
  type GradeSettings,
  type GridSpec,
  type Vec3,
} from './types';

/** Everything `generateBlockModel` needs. `BlastConfig` (blasts.ts) extends this. */
export interface BlockModelConfig {
  grid: GridSpec;
  grades: GradeSettings;
  orebody: OrebodySpec;
  /** Model seed (grade noise). Independent of BlastParameters.seed (movement noise). */
  seed: number;
}

/**
 * Version of the block-model generator (this file + orebody.ts + rng.ts). Bump it whenever a code
 * change alters generated grades/densities for the SAME config, so cached results keyed on
 * `configHash` (ADR-12 immutable CDN responses) are invalidated.
 */
export const MODEL_GENERATOR_VERSION = 1;

/**
 * Canonical hash of everything that determines a block model: generator version, grid, grade
 * settings, the complete ore body definition and the model seed. Display-only fields of a
 * BlastConfig (id, name, pattern, default params) are deliberately excluded.
 */
export function blockModelConfigHash(cfg: BlockModelConfig): string {
  const { grid, grades, orebody, seed } = cfg;
  return fnv1a64(`bmv-model/v${MODEL_GENERATOR_VERSION}|${canonicalJson({ grid, grades, orebody, seed })}`);
}

export const blockCount = (grid: GridSpec): number => grid.nx * grid.ny * grid.nz;

/** m³ */
export const blockVolume = (grid: GridSpec): number => grid.blockSize[0] * grid.blockSize[1] * grid.blockSize[2];

export function blockIndex(grid: GridSpec, i: number, j: number, k: number): number {
  return i + grid.nx * (j + grid.ny * k);
}

export function blockIjk(grid: GridSpec, id: number): [number, number, number] {
  const i = id % grid.nx;
  const rest = (id - i) / grid.nx;
  const j = rest % grid.ny;
  const k = (rest - j) / grid.ny;
  return [i, j, k];
}

/** Pre-blast class by grade: waste < cutoff ≤ low < highGrade ≤ high. */
export function classifyGrade(grade: number, grades: GradeSettings): OreClass {
  if (grade >= grades.highGrade) return OreClass.HighGrade;
  if (grade >= grades.cutoff) return OreClass.LowGrade;
  return OreClass.Waste;
}

/** Deterministic: same config → byte-identical typed arrays. */
export function generateBlockModel(cfg: BlockModelConfig): BlockModel {
  const { grid, grades, orebody, seed } = cfg;
  const { nx, ny, nz } = grid;
  const [ox, oy, oz] = grid.origin;
  const [bx, by, bz] = grid.blockSize;
  const count = nx * ny * nz;
  const vol = bx * by * bz;

  const centroid = new Float32Array(3 * count);
  const grade = new Float32Array(count);
  const density = new Float32Array(count);
  const tonnes = new Float32Array(count);
  const rockType = new Uint8Array(count);
  const oreClass = new Uint8Array(count);

  const sampler = createOrebodySampler(orebody, seed);
  // Iterate in id order so the nugget draws are in a fixed order.
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const id = i + nx * (j + ny * k);
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
      }
    }
  }

  return {
    grid: { origin: [ox, oy, oz], blockSize: [bx, by, bz], nx, ny, nz },
    grades: { ...grades },
    count,
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
    ijk: blockIjk(model.grid, id),
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
