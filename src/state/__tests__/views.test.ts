/**
 * P1 / P3 view derivations (state/views.ts) and palettes (state/palette.ts, ADR-8).
 */
import { describe, expect, it } from 'vitest';
import { LocalDataSource } from '@/data';
import type { BlockModel, DigPolygon, MovementResult, ScenarioKey } from '@/core/types';
import { computeDerived } from '../derive';
import { OUTCOME_PALETTE, VIRIDIS_STOPS, viridisSrgb } from '../palette';
import {
  classifyOutcomes,
  classTonnes,
  distanceRange,
  Outcome,
  outcomeClasses,
  outcomeScenario,
  outcomeTonnes,
  rampT,
  scenarioInputs,
  sectionPlane,
  sectionRange,
  sumTonnes,
} from '../views';

const data = new LocalDataSource();
const model = await data.getModel('b1040-017');
const movement = await data.getMovement('b1040-017', (await data.getBlast('b1040-017')).defaultParams);
const derived = computeDerived(model, movement);

describe('outcome classification (P1, ADR-5)', () => {
  it('mill mask × (grade ≥ cut-off) → the four classes (fixture: one block of each)', () => {
    const mill = new Uint8Array([1, 0, 1, 0, 1]);
    const grade = new Float32Array([2.0, 0.9, 0.1, 0.2, 0.5]); // last: exactly at cut-off = ore
    expect(Array.from(classifyOutcomes(mill, grade, 0.5))).toEqual([
      Outcome.OreToMill,
      Outcome.OreLost,
      Outcome.Dilution,
      Outcome.WasteToWaste,
      Outcome.OreToMill,
    ]);
  });

  it('rejects mismatched lengths', () => {
    expect(() => classifyOutcomes(new Uint8Array(2), new Float32Array(3), 0.5)).toThrow();
  });

  it('before the blast (or without a movement) uses in-situ vs original; after it, the chosen line', () => {
    expect(outcomeScenario(false, 0.7, 'adjusted')).toBe('insitu_original');
    expect(outcomeScenario(true, 0, 'adjusted')).toBe('insitu_original');
    expect(outcomeScenario(true, 0.001, 'original')).toBe('post_original');
    expect(outcomeScenario(true, 0.5, 'adjusted')).toBe('post_adjusted');
    expect(outcomeScenario(true, 1, 'original')).toBe('post_original');
  });

  it('scenario inputs are the ones core reconcileScenarios uses', () => {
    const p = derived.polygons;
    expect(scenarioInputs(model, movement, p, 'insitu_original')).toEqual({ positions: model.centroid, polygon: p.original });
    expect(scenarioInputs(model, movement, p, 'post_original')).toEqual({ positions: movement.end, polygon: p.original });
    expect(scenarioInputs(model, movement, p, 'post_adjusted')).toEqual({ positions: movement.end, polygon: p.adjusted });
  });

  it.each<ScenarioKey>(['insitu_original', 'post_original', 'post_adjusted'])(
    '%s: per-block class tonnes agree with the reconciliation column (colours = table)',
    (scenario) => {
      const classes = outcomeClasses(model, movement, derived.polygons, scenario);
      const t = classTonnes(classes, model.tonnes, 4);
      const r = derived.reconciliation[scenario];
      expect(t[Outcome.OreToMill]).toBeCloseTo(r.oreToMill.tonnes, 3);
      expect(t[Outcome.OreLost]).toBeCloseTo(r.oreToWaste.tonnes, 3);
      expect(t[Outcome.Dilution]).toBeCloseTo(r.wasteToMill.tonnes, 3);
      const fromTable = outcomeTonnes(r, sumTonnes(model.tonnes));
      for (const o of [Outcome.OreToMill, Outcome.OreLost, Outcome.Dilution, Outcome.WasteToWaste]) {
        expect(fromTable[o]).toBeCloseTo(t[o], 2);
      }
    },
  );

  it('the post-blast / original view shows ore lost and dilution (the story the mode tells)', () => {
    const t = classTonnes(outcomeClasses(model, movement, derived.polygons, 'post_original'), model.tonnes, 4);
    for (const v of t) expect(v).toBeGreaterThan(0);
  });

  it('an empty polygon sends everything to waste', () => {
    const empty: DigPolygon = { ...derived.polygons.original, polygons: [] };
    const classes = outcomeClasses(model, movement, { original: empty, adjusted: empty }, 'post_original');
    const t = classTonnes(classes, model.tonnes, 4);
    expect(t[Outcome.OreToMill]).toBe(0);
    expect(t[Outcome.Dilution]).toBe(0);
  });
});

describe('movement ramp (P1)', () => {
  it('distanceRange finds min/max (m); empty → [0, 0]', () => {
    expect(distanceRange(new Float32Array([3, 0.5, 7.25, 2]))).toEqual([0.5, 7.25]);
    expect(distanceRange(new Float32Array(0))).toEqual([0, 0]);
    const [lo, hi] = distanceRange(movement.distance);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeGreaterThan(lo);
  });

  it('rampT clamps and maps a degenerate range to 0', () => {
    expect(rampT(2, 2, 6)).toBe(0);
    expect(rampT(6, 2, 6)).toBe(1);
    expect(rampT(4, 2, 6)).toBe(0.5);
    expect(rampT(9, 2, 6)).toBe(1);
    expect(rampT(5, 3, 3)).toBe(0);
  });

  it('viridis endpoints are #440154 (t = 0) and #fde725 (t = 1), clamped outside', () => {
    const hex = (c: number[]) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
    expect(hex(viridisSrgb(0))).toBe('#440154');
    expect(hex(viridisSrgb(1))).toBe('#fde725');
    expect(hex(viridisSrgb(-1))).toBe('#440154');
    expect(hex(viridisSrgb(2))).toBe('#fde725');
    expect(hex(viridisSrgb(0.5))).toBe(VIRIDIS_STOPS[4]);
  });

  it('viridis brightens monotonically (perceptual ramp: low → dark, high → bright)', () => {
    const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    let prev = -1;
    for (let i = 0; i <= 32; i++) {
      const l = lum(viridisSrgb(i / 32));
      expect(l).toBeGreaterThan(prev);
      prev = l;
    }
  });
});

describe('palettes (ADR-8)', () => {
  it('outcome palette matches ADR-8 and the four classes are distinct', () => {
    expect(OUTCOME_PALETTE[Outcome.OreToMill].hex).toBe('#14b8a6');
    expect(OUTCOME_PALETTE[Outcome.OreLost].hex).toBe('#d946ef');
    expect(OUTCOME_PALETTE[Outcome.Dilution].hex).toBe('#f97316');
    const hexes = Object.values(OUTCOME_PALETTE).map((e) => e.hex);
    expect(new Set(hexes).size).toBe(4);
  });
});

describe('section (P3)', () => {
  it('disabled plane never hides anything: (0, 0, 0, -1)', () => {
    expect(sectionPlane({ enabled: false, axis: 'y', position: 30 })).toEqual([0, 0, 0, -1]);
  });

  it('y keeps y ≥ position (hides the south, camera side); x keeps x ≤ position (hides the east)', () => {
    const hidden = (plane: number[], p: [number, number, number]) => plane[0] * p[0] + plane[1] * p[1] + plane[2] * p[2] < plane[3];
    const y = sectionPlane({ enabled: true, axis: 'y', position: 30 });
    expect(hidden(y, [50, 29, 1035])).toBe(true);
    expect(hidden(y, [50, 31, 1035])).toBe(false);
    const x = sectionPlane({ enabled: true, axis: 'x', position: 40 });
    expect(hidden(x, [41, 10, 1035])).toBe(true);
    expect(hidden(x, [39, 10, 1035])).toBe(false);
  });

  it('range covers the bench in situ and, after the blast, the muckpile thrown past the free face (+x)', () => {
    const [x0, x1] = sectionRange(model, null, 'x');
    expect([x0, x1]).toEqual([0, 100]);
    expect(sectionRange(model, null, 'y')).toEqual([0, 60]);
    const [, px1] = sectionRange(model, movement, 'x');
    expect(px1).toBeGreaterThan(100);
  });

  it('range uses the model grid origin (other benches / block sizes)', () => {
    const m = { ...model, grid: { ...model.grid, origin: [10, 20, 1020], blockSize: [1.25, 1.25, 1.25], nx: 8, ny: 4 } } as BlockModel;
    expect(sectionRange(m, null, 'x')).toEqual([10, 20]);
    expect(sectionRange(m, null, 'y')).toEqual([20, 25]);
    const tiny = { end: new Float32Array([10.75, 20.75, 1020.5]), looseScale: 1 } as unknown as MovementResult;
    expect(sectionRange(m, tiny, 'x')).toEqual([10, 20]);
  });
});
