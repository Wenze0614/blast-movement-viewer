/**
 * M7 — reconciliation (docs/02-plan.md ADR-5). Fixture tests against hand calculations
 * (core/geometry.ts, core/reconcile.ts), plus the plan §6 property test.
 */
import { describe, expect, it } from 'vitest';
import { getBlastConfig } from '../blasts';
import { generateBlockModel } from '../blockModel';
import { DEFAULT_BLAST_PARAMETERS, GRAMS_PER_TROY_OZ } from '../defaults';
import { adjustedDigPolygon, originalDigPolygon } from '../digline';
import { multiPolygonArea, pointInPolygon } from '../geometry';
import { computeMovement } from '../movement';
import {
  gramsToOz,
  millMask,
  reconcile,
  reconcileScenarios,
  reconciliationDelta,
  SCENARIO_KEYS,
  type ReconcileInput,
} from '../reconcile';
import type { DigPolygon, ReconciliationDelta, Vec2 } from '../types';

const square = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const poly = (polygons: Vec2[][][], id = 'test'): DigPolygon => ({
  id,
  kind: 'manual',
  polygons,
  method: 'manual',
  cutoff: 0.5,
  smoothingSigmaCells: 0,
  areaM2: multiPolygonArea(polygons),
});

describe('pointInPolygon (even–odd, ADR-5)', () => {
  const sq = [[square(0, 0, 10, 10)]];

  it('is inside a simple square and outside beyond it', () => {
    expect(pointInPolygon(5, 5, sq)).toBe(true);
    expect(pointInPolygon(0.01, 9.99, sq)).toBe(true);
    expect(pointInPolygon(10.5, 5, sq)).toBe(false);
    expect(pointInPolygon(-1, 5, sq)).toBe(false);
    expect(pointInPolygon(5, 11, sq)).toBe(false);
  });

  it('treats a point inside a hole ring as outside', () => {
    const withHole = [[square(0, 0, 10, 10), square(4, 4, 6, 6)]];
    expect(pointInPolygon(5, 5, withHole)).toBe(false);
    expect(pointInPolygon(2, 2, withHole)).toBe(true);
    expect(pointInPolygon(5, 8, withHole)).toBe(true);
    expect(multiPolygonArea(withHole)).toBeCloseTo(96, 10);
  });

  it('handles MultiPolygons (several outer rings)', () => {
    const multi = [[square(0, 0, 10, 10)], [square(20, 0, 30, 10), square(24, 4, 26, 6)]];
    expect(pointInPolygon(5, 5, multi)).toBe(true);
    expect(pointInPolygon(22, 5, multi)).toBe(true);
    expect(pointInPolygon(25, 5, multi)).toBe(false); // in the second polygon's hole
    expect(pointInPolygon(15, 5, multi)).toBe(false); // between them
    expect(multiPolygonArea(multi)).toBeCloseTo(196, 10);
  });

  it('is independent of ring orientation', () => {
    const cw = [[square(0, 0, 10, 10).reverse()]];
    expect(pointInPolygon(5, 5, cw)).toBe(true);
    expect(multiPolygonArea(cw)).toBeCloseTo(100, 10);
  });
});

/**
 * Hand-calculated 4-block fixture, cut-off 0.5 g/t, polygon = square (0,0)–(10,10):
 *
 * | block | (x, y)  | t  | g/t | ore? | inside? | outcome       |
 * |-------|---------|----|-----|------|---------|---------------|
 * | A     | (5, 5)  | 40 | 2.0 | yes  | yes     | ore → mill    |
 * | B     | (2, 8)  | 40 | 0.2 | no   | yes     | waste → mill  |
 * | C     | (15, 5) | 50 | 1.0 | yes  | no      | ore → waste   |
 * | D     | (20,20) | 50 | 0.1 | no   | no      | waste → waste |
 *
 * total ore = A + C = 90 t, metal 80 + 50 = 130 g, grade 130/90 = 1.4444 g/t
 * mill      = A + B = 80 t, metal 80 + 8 = 88 g, grade 88/80 = 1.1 g/t
 * ore loss  = 50 / 90 = 55.556 %;  dilution = 40 / 80 = 50 %;  metal to mill = 88/130 = 67.692 %
 * Au to mill = 88 / 31.1035 = 2.8293 oz
 */
const FIX = {
  positions: Float32Array.from([5, 5, 0, 2, 8, 0, 15, 5, 0, 20, 20, 0]),
  tonnes: Float32Array.from([40, 40, 50, 50]),
  grade: Float32Array.from([2.0, 0.2, 1.0, 0.1]),
  cutoff: 0.5,
};
const fixtureInput = (polygon: DigPolygon, scenario: ReconcileInput['scenario'] = 'post_original'): ReconcileInput => ({
  ...FIX,
  scenario,
  polygon,
});
const ORIGINAL = poly([[square(0, 0, 10, 10)]], 'original');
/** "Adjusted" line extended east to take in block C: mill = A + B + C. */
const ADJUSTED = poly([[square(0, 0, 16, 10)]], 'adjusted');

describe('reconcile (M7)', () => {
  const r = reconcile(fixtureInput(ORIGINAL));

  it('fixture: 4-block hand calculation gives exact mill t, mill grade, ore loss % and dilution %', () => {
    expect(r.mill.tonnes).toBe(80);
    expect(r.mill.grade).toBeCloseTo(1.1, 6);
    expect(r.mill.metalGrams).toBeCloseTo(88, 5);
    expect(r.totalOre.tonnes).toBe(90);
    expect(r.totalOre.metalGrams).toBeCloseTo(130, 6);
    expect(r.totalOre.grade).toBeCloseTo(130 / 90, 6);
    expect(r.oreLossPct).toBeCloseTo(55.5556, 3);
    expect(r.dilutionPct).toBeCloseTo(50, 10);
    expect(r.metalToMillPct).toBeCloseTo(67.6923, 3);
    expect(r.polygonId).toBe('original');
    expect(r.scenario).toBe('post_original');
  });

  it('ore loss % = oreToWaste.t / totalOre.t × 100', () => {
    expect(r.oreToWaste.tonnes).toBe(50);
    expect(r.oreLossPct).toBeCloseTo((r.oreToWaste.tonnes / r.totalOre.tonnes) * 100, 12);
  });

  it('dilution % = wasteToMill.t / mill.t × 100', () => {
    expect(r.wasteToMill.tonnes).toBe(40);
    expect(r.dilutionPct).toBeCloseTo((r.wasteToMill.tonnes / r.mill.tonnes) * 100, 12);
  });

  it('mill grade is tonnage-weighted: Σ t·g / Σ t', () => {
    // not the plain mean of (2.0 + 0.2) / 2 = 1.1 — make the tonnes unequal to tell them apart
    const skew = reconcile({ ...fixtureInput(ORIGINAL), tonnes: Float32Array.from([30, 10, 50, 50]) });
    expect(skew.mill.grade).toBeCloseTo((30 * 2 + 10 * 0.2) / 40, 6); // 1.55
  });

  it('Au to mill in oz = metal grams / 31.1035', () => {
    expect(GRAMS_PER_TROY_OZ).toBe(31.1035);
    expect(gramsToOz(r.mill.metalGrams)).toBeCloseTo(88 / 31.1035, 5);
    expect(gramsToOz(31.1035)).toBe(1);
  });

  it('oreToMill + oreToWaste = totalOre (tonnes and metal)', () => {
    expect(r.oreToMill.tonnes + r.oreToWaste.tonnes).toBeCloseTo(r.totalOre.tonnes, 10);
    expect(r.oreToMill.metalGrams + r.oreToWaste.metalGrams).toBeCloseTo(r.totalOre.metalGrams, 10);
    expect(r.oreToMill.tonnes + r.wasteToMill.tonnes).toBeCloseTo(r.mill.tonnes, 10);
  });

  it('empty polygon: mill = 0 t, ore loss = 100 %, dilution defined as 0 % (no divide-by-zero)', () => {
    const e = reconcile(fixtureInput(poly([])));
    expect(e.mill).toEqual({ tonnes: 0, grade: 0, metalGrams: 0 });
    expect(e.oreLossPct).toBe(100);
    expect(e.dilutionPct).toBe(0);
    expect(e.metalToMillPct).toBe(0);
    expect(Number.isFinite(e.mill.grade)).toBe(true);
  });

  it('millMask uses the block plan centroid (full-block rule)', () => {
    expect(Array.from(millMask(FIX.positions, ORIGINAL))).toEqual([1, 1, 0, 0]);
    expect(Array.from(millMask(FIX.positions, ADJUSTED))).toEqual([1, 1, 1, 0]);
  });

  it('produces three scenarios: insitu_original, post_original, post_adjusted', () => {
    const model = generateBlockModel(getBlastConfig('b1040-017')!);
    const movement = computeMovement(model, DEFAULT_BLAST_PARAMETERS);
    const original = originalDigPolygon(model);
    const adjusted = adjustedDigPolygon(model, movement);
    const res = reconcileScenarios(model, movement, { original, adjusted });
    expect(Object.keys(res)).toEqual([...SCENARIO_KEYS]);
    expect(res.insitu_original.polygonId).toBe('original');
    expect(res.post_original.polygonId).toBe('original');
    expect(res.post_adjusted.polygonId).toBe('adjusted');
    for (const k of SCENARIO_KEYS) expect(res[k].scenario).toBe(k);
    // total ore is the same truth in every column
    expect(res.post_original.totalOre).toEqual(res.insitu_original.totalOre);
    expect(res.post_adjusted.totalOre).toEqual(res.insitu_original.totalOre);
    // digging the old line on moved rock is worse than digging it in situ
    const sum = (k: (typeof SCENARIO_KEYS)[number]) => res[k].oreLossPct + res[k].dilutionPct;
    expect(sum('post_original')).toBeGreaterThan(sum('insitu_original'));
    expect(sum('post_adjusted')).toBeLessThan(sum('post_original'));
  });

  it('property: across 20 seeds × 2 blasts, adjusted loss + dilution <= original', () => {
    const failures: string[] = [];
    for (const id of ['b1040-017', 'b1030-022']) {
      const cfg = getBlastConfig(id)!;
      for (let s = 0; s < 20; s++) {
        // vary both the ore body (model seed) and the movement noise (params seed)
        const model = generateBlockModel({ ...cfg, seed: cfg.seed + s });
        const movement = computeMovement(model, { ...DEFAULT_BLAST_PARAMETERS, seed: s });
        const res = reconcileScenarios(model, movement, {
          original: originalDigPolygon(model),
          adjusted: adjustedDigPolygon(model, movement),
        });
        const orig = res.post_original.oreLossPct + res.post_original.dilutionPct;
        const adj = res.post_adjusted.oreLossPct + res.post_adjusted.dilutionPct;
        if (!(adj <= orig)) failures.push(`${id} seed ${s}: adjusted ${adj.toFixed(2)} > original ${orig.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('reconciliation delta row (M7)', () => {
  const from = reconcile(fixtureInput(ORIGINAL, 'post_original'));
  const to = reconcile(fixtureInput(ADJUSTED, 'post_adjusted'));
  const delta = reconciliationDelta(from, to);

  it('fixture: post_adjusted − post_original matches hand-calculated mill t, mill grade, loss, dilution and Au', () => {
    // adjusted: mill = A + B + C = 130 t, metal 138 g, grade 1.061538; loss 0 %; dilution 40/130 = 30.769 %
    expect(to.mill.tonnes).toBe(130);
    expect(to.oreLossPct).toBe(0);
    expect(delta.from).toBe('post_original');
    expect(delta.to).toBe('post_adjusted');
    expect(delta.millTonnes).toBe(50);
    expect(delta.millGrade).toBeCloseTo(138 / 130 - 1.1, 6); // −0.038462 g/t
    expect(delta.oreLossPct).toBeCloseTo(0 - 55.5556, 3);
    expect(delta.dilutionPct).toBeCloseTo((40 / 130) * 100 - 50, 3); // −19.231 pp
    expect(delta.metalToMillGrams).toBeCloseTo(50, 5);
    expect(gramsToOz(delta.metalToMillGrams)).toBeCloseTo(1.6075, 4);
  });

  it('is field-by-field `to − from`, with loss and dilution in percentage points (not relative %)', () => {
    expect(delta.oreLossPct).toBeCloseTo(to.oreLossPct - from.oreLossPct, 12);
    expect(delta.dilutionPct).toBeCloseTo(to.dilutionPct - from.dilutionPct, 12);
    // relative change would be −100 % for loss; percentage points are −55.6
    expect(delta.oreLossPct).not.toBeCloseTo(-100, 0);
    expect(delta.millTonnes).toBe(to.mill.tonnes - from.mill.tonnes);
    expect(delta.millGrade).toBe(to.mill.grade - from.mill.grade);
  });

  it('metalToMillGrams > 0 means adjusting the line sends more Au to the mill', () => {
    expect(to.mill.metalGrams).toBeGreaterThan(from.mill.metalGrams);
    expect(delta.metalToMillGrams).toBeGreaterThan(0);
  });

  it('delta of a scenario against itself is all zeros', () => {
    const d = reconciliationDelta(from, from);
    expect([d.millTonnes, d.millGrade, d.oreLossPct, d.dilutionPct, d.metalToMillGrams]).toEqual([0, 0, 0, 0, 0]);
  });

  it('swapping from/to negates every field', () => {
    const back = reconciliationDelta(to, from);
    const fields: (keyof Omit<ReconciliationDelta, 'from' | 'to'>)[] = [
      'millTonnes',
      'millGrade',
      'oreLossPct',
      'dilutionPct',
      'metalToMillGrams',
    ];
    for (const f of fields) expect(back[f]).toBeCloseTo(-delta[f], 12);
    expect([back.from, back.to]).toEqual([delta.to, delta.from]);
  });
});
