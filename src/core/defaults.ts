/**
 * Default values quoted in docs/02-plan.md (ADR-3, §3.1). Values only — shapes live in types.ts.
 * The store needs initial params before a BlastDetail arrives; core/blasts.ts reuses these.
 */
import type { BlastParameters, BlastPattern, GradeSettings } from './types';

export const DEFAULT_BLAST_PARAMETERS: Readonly<BlastParameters> = Object.freeze({
  freeFace: 'east',
  initiation: 'v',
  rowDelayMs: 42,
  holeDelayMs: 25,
  maxThrow: 10,
  backRowRatio: 0.2,
  throwExponent: 1.5,
  toeRatio: 0.4,
  lateralSigma: 1,
  lateralFan: 1,
  swellFactor: 1.3,
  reposeAngleDeg: 37,
  randomness: 0.5,
  noiseLength: 8,
  seed: 42,
});

/** Drill pattern of a 100 × 60 m bench: 25 rows × 13 holes, burden 4.0 m × spacing 4.6 m. */
export const DEFAULT_PATTERN: Readonly<BlastPattern> = Object.freeze({
  burden: 4.0,
  spacing: 4.6,
  holeDiameterMm: 115,
  subdrill: 1.0,
  rows: 25,
  holesPerRow: 13,
});

export const DEFAULT_GRADE_SETTINGS: Readonly<GradeSettings> = Object.freeze({
  element: 'Au',
  unit: 'g/t',
  cutoff: 0.5,
  highGrade: 1.5,
});

/** grams per troy ounce */
export const GRAMS_PER_TROY_OZ = 31.1035;
