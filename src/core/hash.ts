/**
 * Canonical blast parameters and their hash (docs/02-plan.md ADR-12).
 *
 * Movement is a pure function of (blast config, params), so it is cacheable by a canonical key:
 * the model's `configHash` (canonical JSON of the complete config, see blockModel.ts) plus the
 * params in fixed key order, numbers rounded to 2 dp, seed as a non-negative integer. `computeMovement`
 * computes with the canonical params, so two inputs with the same hash give the same result.
 * The hash is also the HTTP ETag of the movement endpoint.
 */
import type { BlastParameters } from './types';

/** Fixed key order for the canonical form (= the order in types.ts). */
export const PARAM_KEYS = [
  'freeFace',
  'maxThrow',
  'backRowRatio',
  'throwExponent',
  'toeRatio',
  'lateralSigma',
  'lateralFan',
  'swellFactor',
  'reposeAngleDeg',
  'randomness',
  'noiseLength',
  'seed',
] as const satisfies readonly (keyof BlastParameters)[];

/**
 * Round half away from zero to 2 dp, on the DECIMAL value as written (1.005 → 1.01, although
 * 1.005 * 100 is 100.4999… in binary); normalises -0 to 0.
 */
export function round2(x: number): number {
  if (!Number.isFinite(x)) return x;
  const r = (Math.sign(x) * Math.round(Number(`${Math.abs(x).toFixed(10)}e2`))) / 100;
  return r === 0 ? 0 : r;
}

/** Canonical params: keys in PARAM_KEYS order, numbers rounded to 2 dp, seed a uint32 integer. */
export function canonicalParams(params: BlastParameters): BlastParameters {
  return {
    freeFace: params.freeFace,
    maxThrow: round2(params.maxThrow),
    backRowRatio: round2(params.backRowRatio),
    throwExponent: round2(params.throwExponent),
    toeRatio: round2(params.toeRatio),
    lateralSigma: round2(params.lateralSigma),
    lateralFan: round2(params.lateralFan),
    swellFactor: round2(params.swellFactor),
    reposeAngleDeg: round2(params.reposeAngleDeg),
    randomness: round2(params.randomness),
    noiseLength: round2(params.noiseLength),
    seed: Math.max(0, Math.floor(params.seed)) >>> 0,
  };
}

/** `freeFace=east&maxThrow=10&…&seed=42` — also a valid canonical query string. */
export function canonicalParamsString(params: BlastParameters): string {
  const c = canonicalParams(params);
  return PARAM_KEYS.map((k) => `${k}=${String(c[k])}`).join('&');
}

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** FNV-1a 64-bit over the UTF-8 bytes of `s`, as 16 lowercase hex chars. Not cryptographic. */
export function fnv1a64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let h = FNV64_OFFSET;
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * FNV64_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, '0');
}

/**
 * Canonical JSON: object keys sorted (UTF-16 code-unit order) at every depth, `undefined`-valued
 * keys omitted, -0 written as 0, numbers in JS shortest round-trip form. Equal values give equal
 * strings regardless of key insertion order. Throws on values with no stable JSON form
 * (NaN/±Infinity, undefined array items, functions, typed arrays, bigint).
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'number':
      if (!Number.isFinite(value)) throw new RangeError(`canonicalJson: non-finite number ${value}`);
      return JSON.stringify(value === 0 ? 0 : value);
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
      if (ArrayBuffer.isView(value)) throw new TypeError('canonicalJson: typed arrays are not supported');
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported ${typeof value}`);
  }
}

/**
 * Hash of (context, canonical params). `context` identifies the blast model: computeMovement
 * passes the model's `configHash` (complete blast config) plus the movement algorithm version,
 * so the same params on two different models give different hashes.
 */
export function hashParams(params: BlastParameters, context = ''): string {
  return fnv1a64(`${context}|${canonicalParamsString(params)}`);
}
