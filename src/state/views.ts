/**
 * View derivations (P1 colour modes, P3 section): pure functions shared by the engine (block
 * colours, shader uniforms) and the UI (legend, section slider). No three, no React.
 *
 * Outcome mode mirrors core reconcile exactly (same millMask, same "ore = grade ≥ cut-off"), so the
 * colours a user sees always agree with a column of the reconciliation table:
 *
 * | View                                   | Positions        | Dig line  | Table column            |
 * |----------------------------------------|------------------|-----------|-------------------------|
 * | before the blast (progress 0)          | in-situ centroid | original  | In-situ / original      |
 * | blast started (progress > 0), default  | post-blast `end` | original  | Post-blast / original   |
 * | blast started, "adjusted" selected     | post-blast `end` | adjusted  | Post-blast / adjusted   |
 *
 * Mid-scrub a block is coloured by its FATE (where it lands), not by where it is mid-flight: the
 * colours switch once as the blast starts and then hold while the blocks move, so per-frame work
 * stays one uniform and the image never flickers as blocks cross the line.
 */
import { millMask } from '@/core/reconcile';
import type { BlockModel, DigPolygon, MovementResult, ReconciliationResult, ScenarioKey } from '@/core/types';
import type { DigPolygons, OutcomeLine, SectionState } from './store';

/** Per-block outcome class (ADR-5 destinations × true class). Values index OUTCOME_PALETTE. */
export enum Outcome {
  OreToMill = 0,
  /** ore → waste */
  OreLost = 1,
  /** waste → mill */
  Dilution = 2,
  WasteToWaste = 3,
}

export const OUTCOME_ORDER: readonly Outcome[] = [
  Outcome.OreToMill,
  Outcome.OreLost,
  Outcome.Dilution,
  Outcome.WasteToWaste,
];

/** Which reconciliation scenario the outcome colours show (table above). */
export function outcomeScenario(hasMovement: boolean, progress: number, line: OutcomeLine): ScenarioKey {
  if (!hasMovement || progress <= 0) return 'insitu_original';
  return line === 'adjusted' ? 'post_adjusted' : 'post_original';
}

/** Positions + polygon for a scenario: the same inputs core reconcileScenarios uses. */
export function scenarioInputs(
  model: BlockModel,
  movement: MovementResult,
  polygons: DigPolygons,
  scenario: ScenarioKey,
): { positions: Float32Array; polygon: DigPolygon } {
  switch (scenario) {
    case 'insitu_original':
      return { positions: model.centroid, polygon: polygons.original };
    case 'post_original':
      return { positions: movement.end, polygon: polygons.original };
    case 'post_adjusted':
      return { positions: movement.end, polygon: polygons.adjusted };
  }
}

/** mill mask (1 = mill) × true class (grade ≥ cut-off) → Outcome per block. */
export function classifyOutcomes(
  mill: Uint8Array,
  grade: Float32Array,
  cutoff: number,
  out: Uint8Array = new Uint8Array(grade.length),
): Uint8Array {
  if (mill.length !== grade.length || out.length !== grade.length) {
    throw new Error('classifyOutcomes: mask, grade and out must have one entry per block');
  }
  for (let b = 0; b < grade.length; b++) {
    const ore = grade[b] >= cutoff;
    const toMill = mill[b] === 1;
    out[b] = ore
      ? toMill
        ? Outcome.OreToMill
        : Outcome.OreLost
      : toMill
        ? Outcome.Dilution
        : Outcome.WasteToWaste;
  }
  return out;
}

/** Outcome per block for one scenario. O(N·V), run once per discrete change, never per frame. */
export function outcomeClasses(
  model: BlockModel,
  movement: MovementResult,
  polygons: DigPolygons,
  scenario: ScenarioKey,
): Uint8Array {
  const { positions, polygon } = scenarioInputs(model, movement, polygons, scenario);
  return classifyOutcomes(millMask(positions, polygon), model.grade, model.grades.cutoff);
}

/** Σ t per class, for classes 0..nClasses-1 (legend tonnes). */
export function classTonnes(classes: Uint8Array, tonnes: Float32Array, nClasses: number): number[] {
  const out = new Array<number>(nClasses).fill(0);
  for (let b = 0; b < classes.length; b++) out[classes[b]] += tonnes[b];
  return out;
}

/** Outcome tonnes straight from a reconciliation result (no per-block pass). */
export function outcomeTonnes(r: ReconciliationResult, totalTonnes: number): Record<Outcome, number> {
  return {
    [Outcome.OreToMill]: r.oreToMill.tonnes,
    [Outcome.OreLost]: r.oreToWaste.tonnes,
    [Outcome.Dilution]: r.wasteToMill.tonnes,
    [Outcome.WasteToWaste]: Math.max(0, totalTonnes - r.totalOre.tonnes - r.wasteToMill.tonnes),
  };
}

export function sumTonnes(tonnes: Float32Array): number {
  let t = 0;
  for (let b = 0; b < tonnes.length; b++) t += tonnes[b];
  return t;
}

/** [min, max] of the displacement distance, m (movement-mode ramp + legend). [0, 0] if empty. */
export function distanceRange(distance: Float32Array): [number, number] {
  if (distance.length === 0) return [0, 0];
  let lo = Infinity;
  let hi = -Infinity;
  for (let b = 0; b < distance.length; b++) {
    const d = distance[b];
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}

/** Ramp parameter 0..1 for a value in [min, max]; a degenerate range maps everything to 0. */
export function rampT(value: number, min: number, max: number): number {
  if (!(max > min)) return 0;
  const t = (value - min) / (max - min);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Section slider range along an axis, m: the in-situ bench plus the muckpile (post-blast
 * centroids ± half a swollen block), so the plane can sweep everything that is drawn.
 */
export function sectionRange(model: BlockModel, movement: MovementResult | null, axis: SectionState['axis']): [number, number] {
  const a = axis === 'x' ? 0 : 1;
  const size = model.grid.blockSize[a];
  const n = axis === 'x' ? model.grid.nx : model.grid.ny;
  let lo = model.grid.origin[a];
  let hi = lo + n * size;
  if (movement) {
    const half = (size * movement.looseScale) / 2;
    for (let b = a; b < movement.end.length; b += 3) {
      const v = movement.end[b];
      if (v - half < lo) lo = v - half;
      if (v + half > hi) hi = v + half;
    }
  }
  return [lo, hi];
}

/**
 * The uSection plane as (nx, ny, nz, d): a block is HIDDEN when dot(n, centroid) < d. Disabled
 * = (0, 0, 0, -1), which never hides anything, so the shader needs no on/off branch.
 * 'y' keeps y ≥ position (hides the south, camera side); 'x' keeps x ≤ position (hides the east).
 */
export function sectionPlane(section: SectionState): [number, number, number, number] {
  if (!section.enabled) return [0, 0, 0, -1];
  return section.axis === 'y' ? [0, 1, 0, section.position] : [-1, 0, 0, -section.position];
}
