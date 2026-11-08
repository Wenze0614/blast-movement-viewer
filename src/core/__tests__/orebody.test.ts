/**
 * Synthetic ore bodies (core/orebody.ts): vein geometry (trace distance, dip, halo, shoots,
 * pinch-out) and the demo vein systems.
 */
import { describe, expect, it } from 'vitest';
import { getBlastConfig } from '../blasts';
import { blockIdAt, completeGrades, generateBlockModel } from '../blockModel';
import { DEFAULT_GRADE_SETTINGS } from '../defaults';
import { createSeededNoise3D } from '../rng';
import { traceDistance, VEIN_PINCH_OUT, veinContribution, type VeinFeature, type VeinNoise } from '../orebody';
import { OreClass } from '../types';

const vein: VeinFeature = {
  kind: 'vein',
  trace: [
    [0, 0],
    [0, 100],
  ], // runs north, so "right" (the dip side) is east
  zRef: 1000,
  dipDeg: 60,
  halfThickness: 2,
  peakGrade: 5,
  halo: { halfWidth: 6, grade: 0.8 },
  wander: 0,
  wanderLength: 15,
  patchiness: 0,
};
const zero = () => 0;
const flat: VeinNoise = { wander: zero, shoot: () => 1 };

describe('traceDistance', () => {
  it('signed plan distance (positive to the right of the direction), arc length, overshoot past the ends', () => {
    const t: [number, number][] = [
      [0, 0],
      [0, 10],
      [10, 10],
    ];
    expect(traceDistance(t, 3, 5)).toEqual({ d: 3, along: 5, overshoot: 0 }); // east of a north-going leg = right
    expect(traceDistance(t, -2, 5).d).toBe(-2);
    expect(traceDistance(t, 5, 12)).toEqual({ d: -2, along: 15, overshoot: 0 }); // north of an east-going leg = left
    expect(traceDistance(t, 0, -4).overshoot).toBeCloseTo(4, 12);
    expect(traceDistance(t, 13, 10).overshoot).toBeCloseTo(3, 12);
    // past an end, d is measured across the extended end segment
    expect(traceDistance(t, 1, -4).d).toBeCloseTo(1, 12);
    expect(traceDistance(t, 13, 11).d).toBeCloseTo(-1, 12);
  });
});

describe('veinContribution', () => {
  const c = (x: number, y: number, z: number, f: VeinFeature = vein, n: VeinNoise = flat) => veinContribution(f, n, x, y, z);

  it('peaks on the trace at zRef (core + halo) and falls off across the sheet: narrow core, wide halo', () => {
    expect(c(0, 50, 1000)).toBeCloseTo(5 + 0.8, 10);
    const across = (dx: number) => dx * Math.sin((60 * Math.PI) / 180);
    expect(c(3, 50, 1000)).toBeCloseTo(5 * Math.exp(-((across(3) / 2) ** 2)) + 0.8 * Math.exp(-((across(3) / 6) ** 2)), 10);
    // beyond the core only the halo is left: low grade, still above the 0.5 cut-off near the vein
    const far = c(6, 50, 1000);
    expect(far).toBeLessThan(0.8);
    expect(far).toBeGreaterThan(0.3);
    expect(c(20, 50, 1000)).toBeLessThan(0.01);
  });

  it('dips to the right: deeper, the sheet sits further east by (zRef − z)/tan(dip)', () => {
    const shift = 10 / Math.tan((60 * Math.PI) / 180);
    expect(c(shift, 50, 990)).toBeCloseTo(5.8, 10);
    expect(c(0, 50, 990)).toBeLessThan(c(shift, 50, 990));
    const vertical = { ...vein, dipDeg: 90 };
    expect(c(0, 50, 990, vertical)).toBeCloseTo(5.8, 10);
  });

  it('pinches out past the trace ends', () => {
    expect(c(0, 100 + VEIN_PINCH_OUT, 1000)).toBeCloseTo(5.8 * Math.exp(-1), 10);
    expect(c(0, -3 * VEIN_PINCH_OUT, 1000)).toBeLessThan(0.001);
  });

  it('patchiness makes ore shoots and barren gaps along strike; the halo stays', () => {
    const noise: VeinNoise = { wander: zero, shoot: createSeededNoise3D(7) };
    const patchy = { ...vein, patchiness: 1 };
    const cores = Array.from({ length: 101 }, (_, y) => c(0, y, 1000, patchy, noise));
    expect(Math.max(...cores)).toBeGreaterThan(5);
    expect(Math.min(...cores)).toBeCloseTo(0.8, 6); // a barren gap: halo only
    const continuous = Array.from({ length: 101 }, (_, y) => c(0, y, 1000, vein, noise));
    expect(Math.min(...continuous)).toBeCloseTo(5.8, 6);
  });

  it('meanders: the sheet moves sideways by up to `wander` with seeded noise', () => {
    const noise: VeinNoise = { wander: createSeededNoise3D(3), shoot: () => 1 };
    const wandering = { ...vein, wander: 4 };
    const peakX = (y: number) => {
      let best = -Infinity;
      let bx = 0;
      for (let x = -8; x <= 8; x += 0.05) {
        const v = c(x, y, 1000, wandering, noise);
        if (v > best) [best, bx] = [v, x];
      }
      return bx;
    };
    const xs = [10, 30, 50, 70, 90].map(peakX);
    expect(Math.max(...xs.map(Math.abs))).toBeLessThanOrEqual(4.05);
    expect(new Set(xs.map((x) => x.toFixed(1))).size).toBeGreaterThan(2);
  });
});

describe('demo vein systems', () => {
  /** Max grade over the column under (x, y). */
  const colMax = (id: string, x: number, y: number) => {
    const cfg = getBlastConfig(id)!;
    const m = generateBlockModel(cfg);
    const b = cfg.grid.blockSize[0];
    let g = 0;
    for (let k = 0; k < m.grid.nz; k++) {
      const n = blockIdAt(m, Math.floor(x / b), Math.floor(y / b), k);
      if (n >= 0) g = Math.max(g, m.grade[n]);
    }
    return g;
  };

  it('b1040-017: the main vein and its branch both carry ore; between them is waste', () => {
    expect(colMax('b1040-017', 60.5, 22)).toBeGreaterThan(1.5); // main vein
    expect(colMax('b1040-017', 50, 46)).toBeGreaterThan(0.5); // branch
    expect(colMax('b1040-017', 25, 20)).toBeLessThan(0.5); // far from both
  });

  it('every demo blast has all four grade classes, with high grade rarest', () => {
    for (const id of ['b1040-017', 'b1030-022', 'b1040-031']) {
      const m = generateBlockModel(getBlastConfig(id)!);
      const t = [0, 0, 0, 0];
      for (let n = 0; n < m.count; n++) t[m.oreClass[n]] += m.tonnes[n];
      for (const cls of [OreClass.Waste, OreClass.LowGrade, OreClass.MediumGrade, OreClass.HighGrade]) expect(t[cls], `${id} ${cls}`).toBeGreaterThan(0);
      expect(t[OreClass.LowGrade]).toBeGreaterThan(t[OreClass.HighGrade]);
    }
  });

  it('is deterministic per seed and changes with it', () => {
    const cfg = getBlastConfig('b1040-031')!;
    expect(Array.from(generateBlockModel(cfg).grade)).toEqual(Array.from(generateBlockModel(cfg).grade));
    expect(Array.from(generateBlockModel({ ...cfg, seed: 1 }).grade)).not.toEqual(Array.from(generateBlockModel(cfg).grade));
  });
});

describe('completeGrades', () => {
  it('fills a missing mediumGrade (a detail cached before four classes) and keeps the breaks ordered', () => {
    const old: Partial<typeof DEFAULT_GRADE_SETTINGS> = { ...DEFAULT_GRADE_SETTINGS };
    delete old.mediumGrade;
    expect(completeGrades(old)).toEqual(DEFAULT_GRADE_SETTINGS);
    expect(completeGrades(undefined)).toEqual(DEFAULT_GRADE_SETTINGS);
    // an old detail whose highGrade was the low/high split (1.5): medium clamps into [cutoff, high]
    const legacy = completeGrades({ element: 'Au', unit: 'g/t', cutoff: 0.5, highGrade: 1.5 });
    expect(legacy).toEqual({ element: 'Au', unit: 'g/t', cutoff: 0.5, mediumGrade: 1.5, highGrade: 1.5 });
    expect(completeGrades({ cutoff: Number.NaN, mediumGrade: 9, highGrade: 2 })).toEqual({ ...DEFAULT_GRADE_SETTINGS, mediumGrade: 2, highGrade: 2 });
  });
});
