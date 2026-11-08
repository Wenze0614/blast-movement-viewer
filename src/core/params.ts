/**
 * Valid ranges for BlastParameters (docs/02-plan.md ADR-12). One table shared by the API's zod
 * schema (src/server/schemas.ts → 400 outside it) and the parameter panel sliders, so the UI can
 * never ask for something the API rejects.
 */
import type { BlastParameters } from './types';

export type NumericParamKey = Exclude<keyof BlastParameters, 'freeFace'>;

export interface ParamRange {
  min: number;
  /** Infinity = unbounded above (seed). */
  max: number;
  /** true: integers only (seed). */
  integer?: boolean;
}

export const PARAM_RANGES: Readonly<Record<NumericParamKey, ParamRange>> = Object.freeze({
  maxThrow: { min: 0, max: 25 },
  backRowRatio: { min: 0, max: 1 },
  throwExponent: { min: 0.5, max: 3 },
  toeRatio: { min: 0, max: 1 },
  lateralSigma: { min: 0, max: 5 },
  lateralFan: { min: 0, max: 5 },
  swellFactor: { min: 1, max: 1.6 },
  reposeAngleDeg: { min: 25, max: 45 },
  randomness: { min: 0, max: 1 },
  noiseLength: { min: 2, max: 30 },
  /** uint32 (canonicalParams applies `>>> 0`). */
  seed: { min: 0, max: 0xffffffff, integer: true },
});

export const FREE_FACES = ['east', 'west', 'north', 'south'] as const satisfies readonly BlastParameters['freeFace'][];
