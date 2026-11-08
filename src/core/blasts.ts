/**
 * The three seeded demo blasts (docs/02-plan.md ADR-10), shared by LocalDataSource and the API.
 *
 * | id        | bounding grid             | outline                    | ore body                         |
 * |-----------|---------------------------|----------------------------|----------------------------------|
 * | b1040-017 | 40×24×4 @ 2.5 m           | irregular, ragged face     | branching vein across the throw  |
 * | b1030-022 | 40×24×4 @ 2.5 m           | L-shape (narrow back)      | two veins, waste parting between |
 * | b1040-031 | 80×48×8 @ 1.25 m          | notched, chamfered corner  | vein network + high-grade shoot  |
 * | b1050-001 | 440×260×20 @ 0.5 m        | ragged, 220 × 130 m        | vein network (~2.07 M blocks)    |
 *
 * Veins (orebody.ts VeinFeature): a high-grade core inside a low-grade halo, patchy along strike,
 * meandering, pinching out past their traces; a splay starting on another vein reads as a branch.
 *
 * Default firing: V from the front centre (017, 031), echelon from the right front corner (022).
 * Each grid is a 100 × 60 × 10 m bounding box; the outline (plan polygon, world x/y) picks the
 * block columns (blockCount in the summary). The free face is on the east side (throw = +x).
 * Bench "1040" has its crest at RL 1040 and its toe (benchRL, grid origin z) at RL 1030.
 */
import type { BlastPattern } from './api-types';
import { blockModelConfigHash, type BlockModelConfig } from './blockModel';
import { fnv1a64 } from './hash';
import { MOVEMENT_MODEL_VERSION } from './movement';
import { DEFAULT_BLAST_PARAMETERS, DEFAULT_GRADE_SETTINGS, DEFAULT_PATTERN } from './defaults';
import type { OrebodySpec } from './orebody';
import type { BlastParameters } from './types';

export interface BlastConfig extends BlockModelConfig {
  id: string;
  name: string;
  description: string;
  freeFace: BlastParameters['freeFace'];
  /** Lays out the hole layer; its burden and spacing shape the firing sequence (timing.ts). */
  pattern: BlastPattern;
  defaultParams: BlastParameters;
}

/** Pattern on a 100 × 60 m bench: 25 rows × 13 holes = 325 positions (inside the outline drilled). */
const PATTERN_100x60: BlastPattern = { ...DEFAULT_PATTERN };

/** Vein defaults the demo veins override (see VeinFeature). */
const VEIN = { kind: 'vein' } as const;

const BASE_OREBODY: Omit<OrebodySpec, 'features'> = {
  background: { median: 0.12, logSigma: 0.5 },
  noise: { length: 9, amplitude: 0.45 },
  nugget: 0.25,
  mineralisedThreshold: 0.15,
  density: { host: 2.65, mineralised: 2.75 },
  minGrade: 0.01,
  maxGrade: 8,
};

export const BLAST_CONFIGS: readonly BlastConfig[] = [
  {
    id: 'b1040-017',
    name: 'Bench 1040 · Blast 017',
    description: 'Branching gold vein crossing the throw direction',
    freeFace: 'east',
    grid: { origin: [0, 0, 1030], blockSize: [2.5, 2.5, 2.5], nx: 40, ny: 24, nz: 4 },
    grades: { ...DEFAULT_GRADE_SETTINGS },
    seed: 1040017,
    outline: [[6, 8], [30, 2], [62, 5], [100, 1], [98, 22], [100, 44], [96, 59], [64, 56], [38, 60], [12, 54], [2, 34]],
    orebody: {
      ...BASE_OREBODY,
      features: [
        { ...VEIN, trace: [[52, -5], [60, 20], [63, 40], [70, 65]], zRef: 1035, dipDeg: 65, halfThickness: 2.5, peakGrade: 4.5, halo: { halfWidth: 7, grade: 0.75 }, wander: 3, wanderLength: 18, patchiness: 0.6 },
        { ...VEIN, trace: [[61, 30], [48, 48], [40, 62]], zRef: 1035, dipDeg: 70, halfThickness: 1.8, peakGrade: 3.5, halo: { halfWidth: 5, grade: 0.6 }, wander: 2, wanderLength: 15, patchiness: 0.5 },
      ],
    },
    pattern: PATTERN_100x60,
    defaultParams: { ...DEFAULT_BLAST_PARAMETERS },
  },
  {
    id: 'b1030-022',
    name: 'Bench 1030 · Blast 022',
    description: 'Two veins separated by a waste parting',
    freeFace: 'east',
    grid: { origin: [0, 0, 1020], blockSize: [2.5, 2.5, 2.5], nx: 40, ny: 24, nz: 4 },
    grades: { ...DEFAULT_GRADE_SETTINGS },
    seed: 1030022,
    outline: [[0, 0], [100, 0], [100, 60], [52, 60], [50, 40], [24, 38], [0, 30]],
    orebody: {
      ...BASE_OREBODY,
      features: [
        { ...VEIN, trace: [[30, -5], [40, 20], [44, 38]], zRef: 1025, dipDeg: 72, halfThickness: 2.6, peakGrade: 4.2, halo: { halfWidth: 6, grade: 0.75 }, wander: 2.5, wanderLength: 16, patchiness: 0.5 },
        { ...VEIN, trace: [[70, -5], [74, 30], [78, 65]], zRef: 1025, dipDeg: 68, halfThickness: 2.8, peakGrade: 4.8, halo: { halfWidth: 6.5, grade: 0.8 }, wander: 3, wanderLength: 18, patchiness: 0.6 },
      ],
    },
    pattern: PATTERN_100x60,
    defaultParams: { ...DEFAULT_BLAST_PARAMETERS, initiation: 'echelon-right' },
  },
  {
    id: 'b1040-031',
    name: 'Bench 1040 · Blast 031 (dense)',
    description: 'Dense 1.25 m model of a vein network with a high-grade shoot (performance demo)',
    freeFace: 'east',
    grid: { origin: [0, 0, 1030], blockSize: [1.25, 1.25, 1.25], nx: 80, ny: 48, nz: 8 },
    grades: { ...DEFAULT_GRADE_SETTINGS },
    seed: 1040031,
    outline: [[10, 0], [88, 0], [100, 8], [100, 60], [46, 60], [40, 50], [18, 48], [0, 36], [0, 14]],
    orebody: {
      ...BASE_OREBODY,
      features: [
        { ...VEIN, trace: [[50, -5], [57, 25], [60, 45], [66, 65]], zRef: 1035, dipDeg: 62, halfThickness: 2.2, peakGrade: 4, halo: { halfWidth: 6, grade: 0.7 }, wander: 3, wanderLength: 16, patchiness: 0.7 },
        { ...VEIN, trace: [[57, 22], [78, 30], [95, 34]], zRef: 1035, dipDeg: 75, halfThickness: 1.5, peakGrade: 3.2, halo: { halfWidth: 4, grade: 0.6 }, wander: 2, wanderLength: 12, patchiness: 0.5 },
        { ...VEIN, trace: [[60, 45], [40, 52], [25, 60]], zRef: 1035, dipDeg: 70, halfThickness: 1.6, peakGrade: 3.2, halo: { halfWidth: 4.5, grade: 0.6 }, wander: 2, wanderLength: 12, patchiness: 0.5 },
        { kind: 'pod', centre: [66, 36, 1036], radii: [4, 6, 6], rotationDeg: 0, peakGrade: 6.5 },
      ],
    },
    pattern: PATTERN_100x60,
    defaultParams: { ...DEFAULT_BLAST_PARAMETERS },
  },
  {
    id: 'b1050-001',
    name: 'Bench 1050 · Blast 001 (scale)',
    description: 'Large blast in 0.5 m blocks (about 2 million): a vein network across a 220 m bench',
    freeFace: 'east',
    grid: { origin: [0, 0, 1040], blockSize: [0.5, 0.5, 0.5], nx: 440, ny: 260, nz: 20 },
    grades: { ...DEFAULT_GRADE_SETTINGS },
    seed: 1050001,
    outline: [[8, 6], [70, 0], [150, 4], [220, 2], [216, 40], [220, 92], [212, 130], [140, 124], [96, 130], [40, 122], [4, 96], [0, 50]],
    orebody: {
      ...BASE_OREBODY,
      features: [
        { ...VEIN, trace: [[110, -10], [124, 40], [130, 85], [146, 140]], zRef: 1045, dipDeg: 64, halfThickness: 2.6, peakGrade: 4.5, halo: { halfWidth: 7, grade: 0.75 }, wander: 4, wanderLength: 22, patchiness: 0.65 },
        { ...VEIN, trace: [[124, 40], [170, 52], [212, 60]], zRef: 1045, dipDeg: 72, halfThickness: 1.8, peakGrade: 3.6, halo: { halfWidth: 5, grade: 0.65 }, wander: 3, wanderLength: 18, patchiness: 0.55 },
        { ...VEIN, trace: [[130, 85], [90, 100], [40, 118]], zRef: 1045, dipDeg: 70, halfThickness: 1.9, peakGrade: 3.6, halo: { halfWidth: 5, grade: 0.65 }, wander: 3, wanderLength: 18, patchiness: 0.55 },
        { ...VEIN, trace: [[40, -5], [52, 40], [60, 80]], zRef: 1045, dipDeg: 66, halfThickness: 2.2, peakGrade: 4, halo: { halfWidth: 6, grade: 0.7 }, wander: 3, wanderLength: 20, patchiness: 0.6 },
        { kind: 'pod', centre: [128, 62, 1046], radii: [5, 8, 6], rotationDeg: 10, peakGrade: 6.5 },
      ],
    },
    pattern: { burden: 5, spacing: 5.8, holeDiameterMm: 165, subdrill: 1.2, rows: 44, holesPerRow: 22 },
    defaultParams: { ...DEFAULT_BLAST_PARAMETERS, maxThrow: 14 },
  },
];

export const DEFAULT_BLAST_CONFIG_ID = 'b1040-017';

/** The ~2 million-block scale demo (README "Performance"): heavy, so tests use it on purpose only. */
export const SCALE_BLAST_ID = 'b1050-001';

/** The everyday demo blasts (thousands to tens of thousands of blocks). */
export const STANDARD_BLASTS: readonly BlastConfig[] = BLAST_CONFIGS.filter((c) => c.id !== SCALE_BLAST_ID);

export function getBlastConfig(id: string): BlastConfig | undefined {
  return BLAST_CONFIGS.find((c) => c.id === id);
}

/**
 * Data version of a blast: changes whenever its model or movement output could change (config,
 * generator version, movement heuristic version). Clients append it as `?v=` to the immutable
 * model and movement URLs (ADR-12), so a deploy that changes the data never hits a stale CDN entry.
 * Cheap: hashes the config, does not generate the model.
 */
export function blastDataVersion(cfg: BlastConfig): string {
  return fnv1a64(`${blockModelConfigHash(cfg)}|movement/v${MOVEMENT_MODEL_VERSION}`).slice(0, 8);
}
