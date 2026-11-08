/**
 * Small core utilities: seeded randomness (rng.ts), canonical params hash (hash.ts, ADR-12) and
 * the shared animation easing (easing.ts, ADR-2).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_BLAST_PARAMETERS } from '../defaults';
import { animatedCentroid, animatedScale, BLOCK_ANIMATION_DURATION, blockProgress, smoothstep01 } from '../easing';
import { canonicalJson, canonicalParams, canonicalParamsString, fnv1a64, hashParams, PARAM_KEYS, round2 } from '../hash';
import { createRng, createSeededNoise3D, deriveSeed, mulberry32 } from '../rng';

describe('rng', () => {
  it('mulberry32 is deterministic and in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v >= 0 && v < 1).toBe(true);
    }
    expect(mulberry32(43)()).not.toBe(mulberry32(42)());
  });

  it('deriveSeed gives different streams per salt and per seed', () => {
    expect(deriveSeed(42, 'a')).not.toBe(deriveSeed(42, 'b'));
    expect(deriveSeed(42, 'a')).not.toBe(deriveSeed(43, 'a'));
    expect(deriveSeed(42, 'a')).toBe(deriveSeed(42, 'a'));
  });

  it('normal() has mean ≈ 0 and sd ≈ 1', () => {
    const rng = createRng(7);
    let s = 0;
    let s2 = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const v = rng.normal();
      s += v;
      s2 += v * v;
    }
    expect(Math.abs(s / n)).toBeLessThan(0.03);
    expect(Math.sqrt(s2 / n)).toBeCloseTo(1, 1);
  });

  it('seeded simplex noise is reproducible and in [-1, 1]', () => {
    const a = createSeededNoise3D(5);
    const b = createSeededNoise3D(5);
    const c = createSeededNoise3D(6);
    let differs = false;
    for (let i = 0; i < 100; i++) {
      const p = [i * 0.37, i * 0.11, i * 0.73] as const;
      expect(a(...p)).toBe(b(...p));
      expect(Math.abs(a(...p))).toBeLessThanOrEqual(1);
      if (a(...p) !== c(...p)) differs = true;
    }
    expect(differs).toBe(true);
  });
});

describe('hash (ADR-12)', () => {
  it('canonical params: fixed key order, 2 dp, integer seed', () => {
    const shuffled = Object.fromEntries(Object.entries({ ...DEFAULT_BLAST_PARAMETERS, maxThrow: 10.004, seed: 42.7 }).reverse());
    const c = canonicalParams(shuffled as typeof DEFAULT_BLAST_PARAMETERS);
    expect(Object.keys(c)).toEqual([...PARAM_KEYS]);
    expect(c.maxThrow).toBe(10);
    expect(c.seed).toBe(42);
    expect(round2(1.005)).toBe(1.01); // decimal-safe (1.005 * 100 = 100.49999… in binary)
    expect(round2(2.675)).toBe(2.68);
    expect(round2(1e-7)).toBe(0);
    expect(round2(-0.001)).toBe(0);
    expect(Object.is(round2(-0.001), 0)).toBe(true);
  });

  it('canonical string is a query string in the fixed key order', () => {
    expect(canonicalParamsString(DEFAULT_BLAST_PARAMETERS)).toBe(
      'freeFace=east&initiation=v&rowDelayMs=42&holeDelayMs=25&maxThrow=10&backRowRatio=0.2&throwExponent=1.5&toeRatio=0.4&lateralSigma=1&lateralFan=1&swellFactor=1.3&reposeAngleDeg=37&randomness=0.5&noiseLength=8&seed=42',
    );
  });

  it('FNV-1a 64 matches the reference vectors', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325');
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c');
    expect(fnv1a64('foobar')).toBe('85944171f73967e8');
  });

  it('hash is stable under key order and sub-2dp noise, and changes with params or context', () => {
    const h = hashParams(DEFAULT_BLAST_PARAMETERS, 'ctx');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(hashParams({ ...DEFAULT_BLAST_PARAMETERS, swellFactor: 1.3001 }, 'ctx')).toBe(h);
    expect(hashParams({ ...DEFAULT_BLAST_PARAMETERS, swellFactor: 1.31 }, 'ctx')).not.toBe(h);
    expect(hashParams(DEFAULT_BLAST_PARAMETERS, 'other')).not.toBe(h);
  });

  it('canonicalJson sorts keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } })).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });

  it('canonicalJson normalises -0, drops undefined keys and rejects unstable values', () => {
    expect(canonicalJson({ x: -0, y: undefined, z: null, t: true })).toBe('{"t":true,"x":0,"z":null}');
    expect(canonicalJson(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(() => canonicalJson({ x: NaN })).toThrow(RangeError);
    expect(() => canonicalJson({ x: Infinity })).toThrow(RangeError);
    expect(() => canonicalJson([1, undefined])).toThrow(TypeError);
    expect(() => canonicalJson({ a: new Float32Array(2) })).toThrow(TypeError);
    expect(() => canonicalJson({ f: () => 1 })).toThrow(TypeError);
  });

  it('canonicalJson rejects sparse arrays explicitly (holes would emit invalid JSON)', () => {
    expect(() => canonicalJson([1, , 3])).toThrow(/sparse array \(hole at index 1\)/);
    expect(() => canonicalJson({ a: new Array(2) })).toThrow(TypeError);
    expect(canonicalJson([])).toBe('[]');
    expect(canonicalJson([null, 0])).toBe('[null,0]');
  });
});

describe('easing (ADR-2, shared with the shader)', () => {
  it('smoothstep01 = t²(3 − 2t), clamped', () => {
    expect(smoothstep01(0)).toBe(0);
    expect(smoothstep01(1)).toBe(1);
    expect(smoothstep01(0.5)).toBe(0.5);
    expect(smoothstep01(0.25)).toBeCloseTo(0.15625, 12);
    expect(smoothstep01(-1)).toBe(0);
    expect(smoothstep01(2)).toBe(1);
  });

  it('blockProgress waits for the delay and lands by progress 1 (delay ≤ 0.5)', () => {
    expect(BLOCK_ANIMATION_DURATION).toBe(0.5);
    expect(blockProgress(0.2, 0.3)).toBe(0);
    expect(blockProgress(1, 0.5)).toBe(1);
    expect(blockProgress(0.55, 0.3)).toBeCloseTo(0.5, 12);
  });

  it('animatedCentroid mirrors the vertex shader (start at 0, end at 1, arc peaks mid-way)', () => {
    const start = Float32Array.from([0, 0, 0, 1, 2, 3]);
    const end = Float32Array.from([0, 0, 0, 4, 6, 1]);
    expect(animatedCentroid(start, end, 1, 0, 0.3)).toEqual([1, 2, 3]);
    expect(animatedCentroid(start, end, 1, 1, 0.3)).toEqual([4, 6, 1]);
    const mid = animatedCentroid(start, end, 1, 0.5, 0.3);
    expect(mid[0]).toBe(2.5);
    expect(mid[1]).toBe(4);
    expect(mid[2]).toBeCloseTo(2 + 0.3 * 4 * 0.25 * 5, 12); // horizontal distance = 5
    expect(animatedScale(0, 1.091)).toBe(1);
    expect(animatedScale(1, 1.091)).toBe(1.091);
  });
});
