/**
 * Zod schemas for the API (docs/02-plan.md §3.2, ADR-12). Ranges come from core/params.ts, the
 * same table the parameter panel uses.
 */
import { z } from 'zod';
import { canonicalParams } from '@/core/hash';
import { FREE_FACES, PARAM_RANGES, type NumericParamKey } from '@/core/params';
import type { BlastParameters } from '@/core/types';

/** A query-string number: a finite decimal inside [min, max] ('' and 'abc' are rejected). */
function numberParam(key: NumericParamKey) {
  const r = PARAM_RANGES[key];
  const range = `${key} must be in [${r.min}, ${r.max}]`;
  // z.number() rejects NaN and ±Infinity, so Number('abc') fails here.
  const n = z.number({ error: `${key} must be a number` }).min(r.min, range).max(r.max, range);
  return z
    .string({ error: `${key} is required (one value)` })
    .trim()
    .min(1, `${key} is required`)
    .transform(Number)
    .pipe(r.integer ? n.int(`${key} must be an integer`) : n);
}

/**
 * `GET /api/blasts/:id/movement?freeFace=east&maxThrow=10&…&seed=42[&v=<data version>]`.
 * Every parameter is required (an immutable URL must name its full input, ADR-12); `v` is the
 * client's cache-busting data version and does not affect the result. Unknown keys → 400.
 * Output: canonical BlastParameters (fixed key order, 2 dp, uint32 seed).
 */
export const MovementQuery = z
  .strictObject({
    freeFace: z.enum(FREE_FACES, { error: `freeFace must be one of ${FREE_FACES.join(', ')}` }),
    maxThrow: numberParam('maxThrow'),
    backRowRatio: numberParam('backRowRatio'),
    throwExponent: numberParam('throwExponent'),
    toeRatio: numberParam('toeRatio'),
    lateralSigma: numberParam('lateralSigma'),
    lateralFan: numberParam('lateralFan'),
    swellFactor: numberParam('swellFactor'),
    reposeAngleDeg: numberParam('reposeAngleDeg'),
    randomness: numberParam('randomness'),
    noiseLength: numberParam('noiseLength'),
    seed: numberParam('seed'),
    v: z.string().max(64).optional(),
  })
  // canonicalParams copies only the BlastParameters keys, so `v` is dropped here.
  .transform((q): BlastParameters => canonicalParams(q));

/** `searchParams` → plain object; a repeated key keeps every value so it fails validation. */
export function queryObject(searchParams: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(searchParams.keys())) {
    const all = searchParams.getAll(key);
    out[key] = all.length === 1 ? all[0] : all;
  }
  return out;
}

/** Route param `:id`: the demo ids are short kebab-case strings. */
export const BlastId = z.string().regex(/^[a-z0-9-]{1,64}$/);

/** Flattened zod issues for the ApiError `details` field: `[{ path: 'maxThrow', message }]`. */
export function issueDetails(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}
