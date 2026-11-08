/**
 * M7 — reconciliation: ore loss and dilution per scenario (docs/02-plan.md ADR-5).
 *
 * - True class per block = grade ≥ cut-off, carried with the block.
 * - Destination = mill if the block's plan centroid is inside the dig polygon (full-block rule,
 *   even–odd over all rings). Single dig horizon: the whole column is judged by one polygon.
 * - ore loss % = ore→waste t ÷ total ore t;  dilution % = waste→mill t ÷ mill t;
 *   mill grade = Σ t·g ÷ Σ t;  oz = g ÷ 31.1035;
 *   ore metal recovery % = ore→mill metal ÷ total ore metal (excludes metal carried by dilution).
 * Runs on the client (cheap, O(N·V)) so it can update live when a dig line is edited.
 */
import { GRAMS_PER_TROY_OZ } from './defaults';
import { pointInPolygon, polygonBounds } from './geometry';
import type {
  BlockModel,
  DigPolygon,
  MaterialSummary,
  MovementResult,
  ReconciliationDelta,
  ReconciliationResult,
  ScenarioKey,
} from './types';

export const SCENARIO_KEYS: readonly ScenarioKey[] = ['insitu_original', 'post_original', 'post_adjusted'];

export const gramsToOz = (grams: number): number => grams / GRAMS_PER_TROY_OZ;

/** Inputs for one scenario. `positions` is a 3N centroid array (in situ or post-blast). */
export interface ReconcileInput {
  scenario: ScenarioKey;
  positions: Float32Array;
  tonnes: Float32Array;
  grade: Float32Array;
  polygon: DigPolygon;
  /** g/t */
  cutoff: number;
}

/** 1 = mill, 0 = waste, per block. */
export function millMask(positions: Float32Array, polygon: DigPolygon): Uint8Array {
  const n = positions.length / 3;
  const mask = new Uint8Array(n);
  const bounds = polygonBounds(polygon.polygons);
  if (!bounds) return mask;
  const [minX, minY, maxX, maxY] = bounds;
  for (let b = 0; b < n; b++) {
    const x = positions[3 * b];
    const y = positions[3 * b + 1];
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    if (pointInPolygon(x, y, polygon.polygons)) mask[b] = 1;
  }
  return mask;
}

class Acc {
  t = 0;
  m = 0;
  add(t: number, g: number) {
    this.t += t;
    this.m += t * g;
  }
  summary(): MaterialSummary {
    return { tonnes: this.t, grade: this.t > 0 ? this.m / this.t : 0, metalGrams: this.m };
  }
}

const pct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0);

export function reconcile(input: ReconcileInput): ReconciliationResult {
  const { tonnes, grade, cutoff } = input;
  const mask = millMask(input.positions, input.polygon);
  const totalOre = new Acc();
  const mill = new Acc();
  const oreToMill = new Acc();
  const wasteToMill = new Acc();
  const oreToWaste = new Acc();
  for (let b = 0; b < tonnes.length; b++) {
    const t = tonnes[b];
    const g = grade[b];
    const ore = g >= cutoff;
    if (ore) totalOre.add(t, g);
    if (mask[b]) {
      mill.add(t, g);
      if (ore) oreToMill.add(t, g);
      else wasteToMill.add(t, g);
    } else if (ore) {
      oreToWaste.add(t, g);
    }
  }
  return {
    scenario: input.scenario,
    polygonId: input.polygon.id,
    totalOre: totalOre.summary(),
    mill: mill.summary(),
    oreToMill: oreToMill.summary(),
    wasteToMill: wasteToMill.summary(),
    oreToWaste: oreToWaste.summary(),
    oreLossPct: pct(oreToWaste.t, totalOre.t),
    dilutionPct: pct(wasteToMill.t, mill.t),
    metalToMillPct: pct(mill.m, totalOre.m),
    oreMetalRecoveryPct: pct(oreToMill.m, totalOre.m),
  };
}

/** The three M7 columns: in-situ/original, post-blast/original, post-blast/adjusted. */
export function reconcileScenarios(
  model: BlockModel,
  movement: MovementResult,
  polygons: { original: DigPolygon; adjusted: DigPolygon },
  cutoff = model.grades.cutoff,
): Record<ScenarioKey, ReconciliationResult> {
  const base = { tonnes: model.tonnes, grade: model.grade, cutoff };
  return {
    insitu_original: reconcile({ ...base, scenario: 'insitu_original', positions: model.centroid, polygon: polygons.original }),
    post_original: reconcile({ ...base, scenario: 'post_original', positions: movement.end, polygon: polygons.original }),
    post_adjusted: reconcile({ ...base, scenario: 'post_adjusted', positions: movement.end, polygon: polygons.adjusted }),
  };
}

/** M7 delta row: `to − from` field by field; loss and dilution in percentage points. */
export function reconciliationDelta(from: ReconciliationResult, to: ReconciliationResult): ReconciliationDelta {
  return {
    from: from.scenario,
    to: to.scenario,
    millTonnes: to.mill.tonnes - from.mill.tonnes,
    millGrade: to.mill.grade - from.mill.grade,
    oreLossPct: to.oreLossPct - from.oreLossPct,
    dilutionPct: to.dilutionPct - from.dilutionPct,
    metalToMillGrams: to.mill.metalGrams - from.mill.metalGrams,
  };
}
