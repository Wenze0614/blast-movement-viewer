/**
 * Valid ranges for BlastParameters (docs/02-plan.md ADR-12). One table shared by the API's zod
 * schema (src/server/schemas.ts → 400 outside it) and the parameter panel sliders, so the UI can
 * never ask for something the API rejects.
 */
import { DEFAULT_BLAST_PARAMETERS } from './defaults';
import type { BlastParameters } from './types';

export type NumericParamKey = Exclude<keyof BlastParameters, 'freeFace' | 'initiation'>;

export interface ParamRange {
  min: number;
  /** Infinity = unbounded above (seed). */
  max: number;
  /** true: integers only (seed). */
  integer?: boolean;
}

export const PARAM_RANGES: Readonly<Record<NumericParamKey, ParamRange>> = Object.freeze({
  /** > 0 so the throw always has a component toward the face. */
  rowDelayMs: { min: 5, max: 200 },
  holeDelayMs: { min: 0, max: 200 },
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
export const INITIATIONS = ['row', 'v', 'echelon-left', 'echelon-right'] as const satisfies readonly BlastParameters['initiation'][];

/**
 * Complete a parameter set that may predate newer keys (e.g. a blast detail cached before the
 * timing params existed): every key missing, or of the wrong type, takes its default. Known keys
 * keep their values; unknown keys are dropped. Range checks stay with the API and computeMovement.
 */
export function completeParams(p: Partial<BlastParameters> | null | undefined): BlastParameters {
  const out = { ...DEFAULT_BLAST_PARAMETERS } as BlastParameters;
  if (!p) return out;
  const set = out as unknown as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_BLAST_PARAMETERS) as (keyof BlastParameters)[]) {
    const v = p[key];
    if (typeof v === typeof DEFAULT_BLAST_PARAMETERS[key] && (typeof v !== 'number' || Number.isFinite(v))) set[key] = v;
  }
  if (!(FREE_FACES as readonly string[]).includes(out.freeFace)) out.freeFace = DEFAULT_BLAST_PARAMETERS.freeFace;
  if (!(INITIATIONS as readonly string[]).includes(out.initiation)) out.initiation = DEFAULT_BLAST_PARAMETERS.initiation;
  return out;
}
