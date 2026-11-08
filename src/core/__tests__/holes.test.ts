/**
 * Synthetic blastholes and the BlastSummary / BlastDetail builders (plan §3.2, P9). Display only.
 */
import { describe, expect, it } from 'vitest';
import { BLAST_CONFIGS, getBlastConfig } from '../blasts';
import { blockIdAt, generateBlockModel } from '../blockModel';
import { pointInRing } from '../geometry';
import { BLAST_DISCLAIMER, buildBlastDetail, buildBlastSummary, generateHoles } from '../holes';

const cfg = getBlastConfig('b1040-017')!;
const model = generateBlockModel(cfg);
const holes = generateHoles(model, cfg.pattern, cfg.freeFace);
const rect = { ...cfg, outline: undefined };
const rectHoles = generateHoles(generateBlockModel(rect), rect.pattern, rect.freeFace);

describe('generateHoles', () => {
  it('a rectangular blast gets the full rows × holesPerRow pattern (25 × 13 = 325) with R07-H03 style ids', () => {
    expect(rectHoles.length).toBe(325);
    expect(new Set(rectHoles.map((h) => h.id)).size).toBe(325);
    expect(rectHoles[0].id).toBe('R00-H00');
    expect(rectHoles.find((h) => h.row === 7 && h.id.endsWith('H03'))?.id).toBe('R07-H03');
  });

  it('an outlined blast drills only the pattern positions over its blocks (ids keep their pattern slot)', () => {
    expect(holes.length).toBe(258);
    const kept = new Set(holes.map((h) => h.id));
    for (const h of rectHoles) {
      const [x, y] = h.collar;
      const i = Math.floor(x / 2.5);
      const j = Math.floor(y / 2.5);
      expect(kept.has(h.id), h.id).toBe(blockIdAt(model, i, j, 0) >= 0);
    }
    // collars sit over columns whose centres are inside the outline
    for (const h of holes) {
      const cx = (Math.floor(h.collar[0] / 2.5) + 0.5) * 2.5;
      const cy = (Math.floor(h.collar[1] / 2.5) + 0.5) * 2.5;
      expect(pointInRing(cx, cy, cfg.outline!), h.id).toBe(true);
    }
  });

  it('row 0 is nearest the free face (east) and rows are one burden apart', () => {
    const rowX = (r: number) => rectHoles.find((h) => h.row === r)!.collar[0];
    expect(rowX(0)).toBeGreaterThan(rowX(1));
    expect(rowX(0) - rowX(1)).toBeCloseTo(cfg.pattern.burden, 10);
    expect(rowX(0)).toBeLessThan(100);
    expect(rowX(24)).toBeGreaterThan(0);
  });

  it('collars at the crest, toes at the floor minus subdrill, all inside the footprint', () => {
    for (const h of holes) {
      expect(h.collar[2]).toBe(1040);
      expect(h.toe[2]).toBe(1030 - cfg.pattern.subdrill);
      expect([h.toe[0], h.toe[1]]).toEqual([h.collar[0], h.collar[1]]);
      expect(h.collar[0] > 0 && h.collar[0] < 100 && h.collar[1] > 0 && h.collar[1] < 60).toBe(true);
    }
  });

  it('sampledGrade = column mean of the model + noise (correlates with the ore body)', () => {
    const { nz } = model.grid;
    let errSum = 0;
    for (const h of holes) {
      const i = Math.floor(h.collar[0] / 2.5);
      const j = Math.floor(h.collar[1] / 2.5);
      let tg = 0;
      let t = 0;
      for (let k = 0; k < nz; k++) {
        const id = blockIdAt(model, i, j, k);
        tg += model.tonnes[id] * model.grade[id];
        t += model.tonnes[id];
      }
      const mean = tg / t;
      expect(h.sampledGrade).toBeGreaterThanOrEqual(0);
      // ±15 % log-noise: within a factor of e^(5σ) ≈ 2.1 of the column mean (rounded to 0.01)
      expect(h.sampledGrade).toBeLessThanOrEqual(mean * 2.12 + 0.01);
      expect(h.sampledGrade).toBeGreaterThanOrEqual(mean / 2.12 - 0.01);
      errSum += Math.abs(Math.log((h.sampledGrade + 0.01) / (mean + 0.01)));
    }
    expect(errSum / holes.length).toBeLessThan(0.2);
  });

  it('is deterministic', () => {
    expect(generateHoles(model, cfg.pattern, cfg.freeFace)).toEqual(holes);
  });
});

describe('BlastSummary / BlastDetail builders', () => {
  it('summaries match the demo table', () => {
    const s = BLAST_CONFIGS.map(buildBlastSummary);
    expect(s[0]).toEqual({
      id: 'b1040-017',
      name: 'Bench 1040 · Blast 017',
      description: 'Branching gold vein crossing the throw direction',
      blockCount: 3200,
      benchRL: 1030,
      freeFace: 'east',
    });
    expect(s.map((x) => x.blockCount)).toEqual([3200, 3088, 27088]);
    // the summary's count (computed from the outline) is the generated model's
    expect(s.map((x) => x.blockCount)).toEqual(BLAST_CONFIGS.map((c) => generateBlockModel(c).count));
    expect(s[1].benchRL).toBe(1020);
  });

  it('detail adds grid, grades, pattern, holes, default params and the disclaimer', () => {
    const d = buildBlastDetail(cfg, model);
    expect(d.grid).toEqual(cfg.grid);
    expect(d.grid).not.toBe(cfg.grid);
    expect(d.grades).toEqual(cfg.grades);
    expect(d.pattern).toEqual({ burden: 4, spacing: 4.6, holeDiameterMm: 115, subdrill: 1, rows: 25, holesPerRow: 13 });
    expect(d.holes).toEqual(holes);
    expect(d.defaultParams).toEqual(cfg.defaultParams);
    expect(d.disclaimer).toBe(BLAST_DISCLAIMER);
    expect(d.disclaimer).toBe('Synthetic data. Heuristic movement model, not physics.');
    // generates the model itself when not given one
    expect(buildBlastDetail(cfg).holes).toEqual(holes);
  });
});
