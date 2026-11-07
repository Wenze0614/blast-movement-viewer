/**
 * Default values quoted in docs/02-plan.md (ADR-3, §3.1). Values only — shapes live in types.ts.
 * The store needs initial params before a BlastDetail arrives; core/blasts.ts reuses these.
 */
import type { BlastParameters, GradeSettings } from './types';

export const DEFAULT_BLAST_PARAMETERS: Readonly<BlastParameters> = Object.freeze({
  freeFace: 'east',
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

export const DEFAULT_GRADE_SETTINGS: Readonly<GradeSettings> = Object.freeze({
  element: 'Au',
  unit: 'g/t',
  cutoff: 0.5,
  highGrade: 1.5,
});

/** grams per troy ounce */
export const GRAMS_PER_TROY_OZ = 31.1035;
