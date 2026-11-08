/**
 * The three seeded demo blasts (docs/02-plan.md ADR-10), shared by LocalDataSource and the API.
 *
 * | id        | model                         | ore body                                   |
 * |-----------|-------------------------------|--------------------------------------------|
 * | b1040-017 | 40×24×4 @ 2.5 m (3,840)       | single dipping lens crossing the throw     |
 * | b1030-022 | 40×24×4 @ 2.5 m (3,840)       | two pods with a waste parting              |
 * | b1040-031 | 80×48×8 @ 1.25 m (30,720)     | lens + high-grade shoot (performance demo) |
 *
 * All benches are 100 × 60 × 10 m with the free face on the east side (throw = +x).
 * Bench "1040" has its crest at RL 1040 and its toe (benchRL, grid origin z) at RL 1030.
 */
import type { BlastPattern } from './api-types';
import { blockModelConfigHash, type BlockModelConfig } from './blockModel';
import { fnv1a64 } from './hash';
import { MOVEMENT_MODEL_VERSION } from './movement';
import { DEFAULT_BLAST_PARAMETERS, DEFAULT_GRADE_SETTINGS } from './defaults';
import type { OrebodySpec } from './orebody';
import type { BlastParameters } from './types';

export interface BlastConfig extends BlockModelConfig {
  id: string;
  name: string;
  description: string;
  freeFace: BlastParameters['freeFace'];
  /** Display only: drives the synthetic blasthole layer, NOT the movement heuristic. */
  pattern: BlastPattern;
  defaultParams: BlastParameters;
}

/** Display-only pattern on a 100 × 60 m bench: 25 rows × 13 holes = 325 holes. */
const PATTERN_100x60: BlastPattern = {
  burden: 4.0,
  spacing: 4.6,
  holeDiameterMm: 115,
  subdrill: 1.0,
  rows: 25,
  holesPerRow: 13,
};

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
    description: 'Single dipping lens crossing the throw direction',
    freeFace: 'east',
    grid: { origin: [0, 0, 1030], blockSize: [2.5, 2.5, 2.5], nx: 40, ny: 24, nz: 4 },
    grades: { ...DEFAULT_GRADE_SETTINGS },
    seed: 1040017,
    orebody: {
      ...BASE_OREBODY,
      features: [
        {
          kind: 'lens',
          centre: [64, 31, 1035],
          strikeDeg: 12,
          dipDeg: 58,
          halfThickness: 6.5,
          halfStrike: 26,
          halfDip: 30,
          peakGrade: 3.2,
        },
      ],
    },
    pattern: PATTERN_100x60,
    defaultParams: { ...DEFAULT_BLAST_PARAMETERS },
  },
  {
    id: 'b1030-022',
    name: 'Bench 1030 · Blast 022',
    description: 'Two ore pods separated by a waste parting',
    freeFace: 'east',
    grid: { origin: [0, 0, 1020], blockSize: [2.5, 2.5, 2.5], nx: 40, ny: 24, nz: 4 },
    grades: { ...DEFAULT_GRADE_SETTINGS },
    seed: 1030022,
    orebody: {
      ...BASE_OREBODY,
      features: [
        { kind: 'pod', centre: [40, 22, 1025], radii: [8, 11, 9], rotationDeg: 15, peakGrade: 3.0 },
        { kind: 'pod', centre: [72, 37, 1025], radii: [9, 10, 9], rotationDeg: -10, peakGrade: 3.6 },
      ],
    },
    pattern: PATTERN_100x60,
    defaultParams: { ...DEFAULT_BLAST_PARAMETERS },
  },
  {
    id: 'b1040-031',
    name: 'Bench 1040 · Blast 031 (dense)',
    description: 'Dense 1.25 m model of a lens with a high-grade shoot (performance demo)',
    freeFace: 'east',
    grid: { origin: [0, 0, 1030], blockSize: [1.25, 1.25, 1.25], nx: 80, ny: 48, nz: 8 },
    grades: { ...DEFAULT_GRADE_SETTINGS },
    seed: 1040031,
    orebody: {
      ...BASE_OREBODY,
      features: [
        {
          kind: 'lens',
          centre: [58, 28, 1035],
          strikeDeg: -8,
          dipDeg: 62,
          halfThickness: 6.5,
          halfStrike: 25,
          halfDip: 30,
          peakGrade: 2.8,
        },
        { kind: 'pod', centre: [66, 36, 1036], radii: [4, 6, 6], rotationDeg: 0, peakGrade: 5.5 },
      ],
    },
    pattern: PATTERN_100x60,
    defaultParams: { ...DEFAULT_BLAST_PARAMETERS },
  },
];

export const DEFAULT_BLAST_CONFIG_ID = 'b1040-017';

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
