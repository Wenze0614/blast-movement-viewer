/**
 * Core domain contracts (docs/02-plan.md §3.1).
 *
 * All lengths in metres. Mine grid, Z-up: x = East, y = North, z = Elevation (RL).
 * Tonnes in t, density in t/m³, grade in g/t Au, metal in grams (oz = g / 31.1035).
 *
 * CONTRACT FILE: changes need an explicit note in the PR description (see CLAUDE.md).
 */

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export enum OreClass {
  Waste = 0,
  LowGrade = 1,
  HighGrade = 2,
}

/** Synthetic; display only. */
export enum RockType {
  Host = 0,
  Mineralised = 1,
}

export interface GridSpec {
  /** MIN CORNER of the first block (Datamine convention), e.g. [0, 0, 1030]. */
  origin: Vec3;
  /** m, e.g. [2.5, 2.5, 2.5]. */
  blockSize: Vec3;
  /** e.g. 40 × 24 × 4 → bench 100 × 60 × 10 m. */
  nx: number;
  ny: number;
  nz: number;
}

export interface GradeSettings {
  element: 'Au';
  unit: 'g/t';
  /** g/t; ore if grade >= cutoff. 0.5 */
  cutoff: number;
  /** g/t; display class split. 1.5 */
  highGrade: number;
}

/** Storage: struct-of-arrays. Index: id = i + nx * (j + ny * k) */
export interface BlockModel {
  grid: GridSpec;
  grades: GradeSettings;
  /** e.g. 3840 */
  count: number;
  /** 3 * count, m (block centres). */
  centroid: Float32Array;
  /** g/t Au, e.g. 0.12 .. 6.0 */
  grade: Float32Array;
  /** t/m³ in situ, e.g. 2.65 waste, 2.75 mineralised. */
  density: Float32Array;
  /** t; = blockVolume * density, e.g. 15.625 * 2.75 = 42.97 t. */
  tonnes: Float32Array;
  /** RockType per block. */
  rockType: Uint8Array;
  /** OreClass per block: pre-blast classification by grade. */
  oreClass: Uint8Array;
  seed: number;
  /**
   * Canonical hash of EVERYTHING that determined this model (grid, grades, ore body definition,
   * seed, generator version), as 16 hex chars. Part of the movement cache key (ADR-12), so a
   * changed ore body never reuses a cached movement result. Travels with the model (codec header).
   */
  configHash: string;
}

/** Logical view of one block (inspector, export). Built on demand. */
export interface Block {
  id: number;
  /** k = nz - 1 is the top flitch. */
  ijk: [number, number, number];
  /** Centroid, m. */
  position: Vec3;
  size: Vec3;
  rockType: RockType;
  /** g/t */
  grade: number;
  /** t/m³ */
  density: number;
  /** t */
  tonnes: number;
  oreClass: OreClass;
}

export interface BlastParameters {
  /** MVP fixed: 'east'. */
  freeFace: 'east' | 'west' | 'north' | 'south';
  /** m, horizontal throw at front row, crest. 10 */
  maxThrow: number;
  /** 0..1, throw at back row as fraction of max. 0.2 */
  backRowRatio: number;
  /** p in (1 - s)^p. 1.5 */
  throwExponent: number;
  /** 0..1, throw at toe as fraction of crest. 0.4 */
  toeRatio: number;
  /** m, lateral noise. 1.0 */
  lateralSigma: number;
  /** m, outward fan near face. 1.0 */
  lateralFan: number;
  /** loose / bank volume. 1.3 */
  swellFactor: number;
  /** degrees. 37 */
  reposeAngleDeg: number;
  /** 0..1 noise amplitude. 0.5 */
  randomness: number;
  /** m, spatial correlation length. 8 */
  noiseLength: number;
  /** integer >= 0. 42 */
  seed: number;
}
// Burden/spacing/powder factor are NOT inputs to the heuristic (see BlastPattern: display only).

export interface Heightfield {
  origin: Vec2;
  /** m */
  cellSize: number;
  nx: number;
  ny: number;
  /** m above floor per cell, nx * ny. */
  height: Float32Array;
}

/** Storage: SoA, same index as BlockModel. */
export interface MovementResult {
  params: BlastParameters;
  /** Canonical hash of (blast config, params); also the HTTP ETag. */
  paramsHash: string;
  /** 3 * count (= model.centroid). */
  start: Float32Array;
  /** 3 * count final centroid, m. */
  end: Float32Array;
  /** 3 * count; derived on decode: end - start. */
  displacement: Float32Array;
  /** count; derived on decode: |displacement|, e.g. 0.8 .. 13.5 m. */
  distance: Float32Array;
  /** count; 0..0.5 animation stagger (visual only). */
  delay: Float32Array;
  /** swell^(1/3), e.g. 1.091 */
  looseScale: number;
  postGrid: { origin: Vec2; cellSize: number; nx: number; ny: number };
  surface: Heightfield;
}

export type Destination = 'mill' | 'waste';

/** Logical per-block movement view (inspector / export). */
export interface BlockMovement {
  blockId: number;
  /** m, e.g. [8.7, -0.6, -3.2] */
  displacement: Vec3;
  finalPosition: Vec3;
  /** m */
  distance: number;
  /** in situ vs original polygon */
  preDestination: Destination;
  /** post-blast vs original polygon */
  postDestination: Destination;
  /** post-blast vs adjusted polygon */
  adjustedDestination: Destination;
}

/** Plan-view polygon. polygons[p][0] = outer ring, [1..] = holes. Rings closed implicitly. */
export interface DigPolygon {
  /**
   * 'original' | 'adjusted' | any id. Written as `string & {}` (not plain `string`) so the
   * literal members survive for editor autocomplete; assignability is identical to the plan.
   */
  id: 'original' | 'adjusted' | (string & {});
  kind: 'original' | 'adjusted' | 'manual';
  /** m, e.g. [[[[60,10],[95,10],[95,48],[60,48]]]] */
  polygons: Vec2[][][];
  method: 'grade-contour' | 'manual';
  /** g/t, 0.5 */
  cutoff: number;
  /** 1 */
  smoothingSigmaCells: number;
  /** m² */
  areaM2: number;
}

export interface MaterialSummary {
  /** t */
  tonnes: number;
  /** g/t, tonnage-weighted */
  grade: number;
  /** g Au (oz = g / 31.1035) */
  metalGrams: number;
}

export type ScenarioKey = 'insitu_original' | 'post_original' | 'post_adjusted';

export interface ReconciliationResult {
  scenario: ScenarioKey;
  polygonId: string;
  /** truth: all blocks grade >= cutoff */
  totalOre: MaterialSummary;
  /** everything inside polygon */
  mill: MaterialSummary;
  oreToMill: MaterialSummary;
  /** dilution */
  wasteToMill: MaterialSummary;
  /** ore loss */
  oreToWaste: MaterialSummary;
  /** oreToWaste.t / totalOre.t * 100 */
  oreLossPct: number;
  /** wasteToMill.t / mill.t * 100 */
  dilutionPct: number;
  /** mill.metal / totalOre.metal * 100. Can exceed 100 %: mill metal includes metal in dilution waste. */
  metalToMillPct: number;
  /** oreToMill.metal / totalOre.metal * 100: share of the ore's metal recovered to the mill (≤ 100 %). */
  oreMetalRecoveryPct: number;
}

/**
 * M7 delta row: `to` minus `from`, field by field (e.g. post_adjusted − post_original, the value of
 * adjusting the dig line for movement). Percentages are differences in percentage points.
 */
export interface ReconciliationDelta {
  from: ScenarioKey;
  to: ScenarioKey;
  /** t */
  millTonnes: number;
  /** g/t */
  millGrade: number;
  /** percentage points; negative = less ore lost */
  oreLossPct: number;
  /** percentage points; negative = less dilution */
  dilutionPct: number;
  /** g Au to the mill (UI shows oz = g / 31.1035); positive = more metal recovered */
  metalToMillGrams: number;
}
