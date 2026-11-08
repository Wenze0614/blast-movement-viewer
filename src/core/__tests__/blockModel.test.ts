/**
 * M1 — synthetic block model (docs/02-plan.md §1.2): core/rng.ts, core/orebody.ts,
 * core/blockModel.ts, core/blasts.ts.
 */
import { describe, expect, it } from 'vitest';
import { BLAST_CONFIGS, DEFAULT_BLAST_CONFIG_ID, getBlastConfig } from '../blasts';
import {
  blockIdAt,
  blockModelConfigHash,
  cellIjk,
  cellIndex,
  classifyGrade,
  configBlockCount,
  generateBlockModel,
  getBlock,
  oreTonnesFraction,
} from '../blockModel';
import { DEFAULT_GRADE_SETTINGS } from '../defaults';
import { pointInRing } from '../geometry';
import { OreClass, RockType } from '../types';

const cfg017 = getBlastConfig('b1040-017')!;
/** The same blast without its outline: every column of the bounding grid (dense ids). */
const rect017 = { ...cfg017, outline: undefined };

const bytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const sameBytes = (a: ArrayBufferView, b: ArrayBufferView) => {
  const x = bytes(a);
  const y = bytes(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

describe('generateBlockModel (M1)', () => {
  it('is deterministic: the same seed gives byte-identical typed arrays', () => {
    const a = generateBlockModel(cfg017);
    const b = generateBlockModel(cfg017);
    for (const key of ['cell', 'centroid', 'grade', 'density', 'tonnes', 'rockType', 'oreClass'] as const) {
      expect(sameBytes(a[key], b[key]), key).toBe(true);
    }
    expect(a.seed).toBe(cfg017.seed);
  });

  it('different seeds give different grade arrays', () => {
    const a = generateBlockModel(cfg017);
    const b = generateBlockModel({ ...cfg017, seed: cfg017.seed + 1 });
    expect(sameBytes(a.grade, b.grade)).toBe(false);
  });

  it('default bounding grid is 40×24×4 blocks of 2.5 m (bench 100×60×10 m); the outline keeps 3,200', () => {
    expect(DEFAULT_BLAST_CONFIG_ID).toBe('b1040-017');
    const m = generateBlockModel(cfg017);
    const { nx, ny, nz, blockSize, origin } = m.grid;
    expect([nx, ny, nz]).toEqual([40, 24, 4]);
    expect(blockSize).toEqual([2.5, 2.5, 2.5]);
    expect(m.count).toBe(3200);
    expect(configBlockCount(cfg017)).toBe(3200);
    expect(generateBlockModel(rect017).count).toBe(3840);
    expect([nx * blockSize[0], ny * blockSize[1], nz * blockSize[2]]).toEqual([100, 60, 10]);
    expect(origin).toEqual([0, 0, 1030]);
  });

  it('without an outline ids are dense: id = i + nx * (j + ny * k), centroid = origin (min corner) + (ijk + ½) · blockSize', () => {
    const m = generateBlockModel(rect017);
    const { grid } = m;
    for (const ijk of [
      [0, 0, 0],
      [34, 6, 3],
      [39, 23, 3],
      [7, 11, 2],
    ] as const) {
      const [i, j, k] = ijk;
      const id = blockIdAt(m, i, j, k);
      expect(id).toBe(i + grid.nx * (j + grid.ny * k));
      expect(m.cell[id]).toBe(cellIndex(grid, i, j, k));
      expect(cellIjk(grid, m.cell[id])).toEqual([i, j, k]);
      const expected = [0, 1, 2].map((a) => grid.origin[a] + (ijk[a] + 0.5) * grid.blockSize[a]);
      expect(Array.from(m.centroid.subarray(3 * id, 3 * id + 3))).toEqual(expected);
    }
    // plan §3.1 example: ijk [34, 6, 3] → centroid [86.25, 16.25, 1038.75], top flitch
    const block = getBlock(m, blockIdAt(m, 34, 6, 3));
    expect(block.position).toEqual([86.25, 16.25, 1038.75]);
    expect(block.ijk).toEqual([34, 6, 3]);
    expect(block.size).toEqual([2.5, 2.5, 2.5]);
  });

  it.each(BLAST_CONFIGS.map((c) => c.id))('ore (grade >= cutoff 0.5 g/t) is 15–30%% of total tonnes for %s', (id) => {
    const frac = oreTonnesFraction(generateBlockModel(getBlastConfig(id)!));
    expect(frac).toBeGreaterThanOrEqual(0.15);
    expect(frac).toBeLessThanOrEqual(0.3);
  });

  it('oreClass follows grade: waste < 0.5, low 0.5–1.5, high >= 1.5 g/t', () => {
    const g = DEFAULT_GRADE_SETTINGS;
    expect(classifyGrade(0.49, g)).toBe(OreClass.Waste);
    expect(classifyGrade(0.5, g)).toBe(OreClass.LowGrade);
    expect(classifyGrade(1.49, g)).toBe(OreClass.LowGrade);
    expect(classifyGrade(1.5, g)).toBe(OreClass.HighGrade);
    const m = generateBlockModel(cfg017);
    const seen = new Set<number>();
    for (let n = 0; n < m.count; n++) {
      expect(m.oreClass[n]).toBe(classifyGrade(m.grade[n], m.grades));
      seen.add(m.oreClass[n]);
    }
    expect(seen).toEqual(new Set([OreClass.Waste, OreClass.LowGrade, OreClass.HighGrade]));
  });

  it('every array has the right length (centroid 3N, scalars N)', () => {
    for (const cfg of BLAST_CONFIGS) {
      const m = generateBlockModel(cfg);
      const n = configBlockCount(cfg);
      expect(m.count).toBe(n);
      expect(m.centroid.length).toBe(3 * n);
      for (const a of [m.cell, m.grade, m.density, m.tonnes, m.rockType, m.oreClass]) expect(a.length).toBe(n);
    }
  });

  it.each(BLAST_CONFIGS.map((c) => c.id))(
    'sparse %s: blocks fill exactly the columns inside the outline, every flitch, cells strictly increasing',
    (id) => {
      const cfg = getBlastConfig(id)!;
      const m = generateBlockModel(cfg);
      const { nx, ny, nz } = m.grid;
      const [ox, oy] = m.grid.origin;
      const [bx, by] = m.grid.blockSize;
      let present = 0;
      for (let k = 0; k < nz; k++) {
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < nx; i++) {
            const inside = pointInRing(ox + (i + 0.5) * bx, oy + (j + 0.5) * by, cfg.outline!);
            const bid = blockIdAt(m, i, j, k);
            expect(bid >= 0, `${i},${j},${k}`).toBe(inside);
            if (bid >= 0) {
              present++;
              const c = m.centroid.subarray(3 * bid, 3 * bid + 3);
              expect(Array.from(c)).toEqual([ox + (i + 0.5) * bx, oy + (j + 0.5) * by, m.grid.origin[2] + (k + 0.5) * m.grid.blockSize[2]]);
              expect(getBlock(m, bid).ijk).toEqual([i, j, k]);
            }
          }
        }
      }
      expect(present).toBe(m.count);
      expect(m.count).toBeLessThan(nx * ny * nz); // the outline really cuts the box
      for (let b = 1; b < m.count; b++) expect(m.cell[b]).toBeGreaterThan(m.cell[b - 1]);
    },
  );

  it('blockIdAt returns -1 for cells outside the grid or outside the outline', () => {
    const m = generateBlockModel(cfg017);
    expect(blockIdAt(m, -1, 0, 0)).toBe(-1);
    expect(blockIdAt(m, 40, 0, 0)).toBe(-1);
    expect(blockIdAt(m, 0, 0, 4)).toBe(-1);
    expect(blockIdAt(m, 0, 0, 0)).toBe(-1); // corner (1.25, 1.25) lies outside the outline
  });

  it('the outline is part of the config hash', () => {
    expect(blockModelConfigHash(cfg017)).not.toBe(blockModelConfigHash(rect017));
    const shifted = { ...cfg017, outline: cfg017.outline!.map(([x, y]) => [x + 1, y] as [number, number]) };
    expect(blockModelConfigHash(shifted)).not.toBe(blockModelConfigHash(cfg017));
  });

  it('grades are positive and finite; density is 2.65 (host) or 2.75 (mineralised) t/m³', () => {
    const m = generateBlockModel(cfg017);
    for (let n = 0; n < m.count; n++) {
      expect(Number.isFinite(m.grade[n]) && m.grade[n] > 0).toBe(true);
      const expected = m.rockType[n] === RockType.Mineralised ? 2.75 : 2.65;
      expect(m.density[n]).toBeCloseTo(expected, 6);
    }
  });
});

describe('demo blasts (ADR-10)', () => {
  it('has the three demo blasts with the planned grids', () => {
    expect(BLAST_CONFIGS.map((c) => c.id)).toEqual(['b1040-017', 'b1030-022', 'b1040-031']);
    const boxes = BLAST_CONFIGS.map((c) => c.grid.nx * c.grid.ny * c.grid.nz);
    expect(boxes).toEqual([3840, 3840, 30720]);
    expect(BLAST_CONFIGS.map((c) => configBlockCount(c))).toEqual([3200, 3088, 27088]);
    const dense = getBlastConfig('b1040-031')!.grid;
    expect([dense.nx, dense.ny, dense.nz, ...dense.blockSize]).toEqual([80, 48, 8, 1.25, 1.25, 1.25]);
    expect(getBlastConfig('nope')).toBeUndefined();
  });

  it('b1030-022 has two pods with a waste parting between them', () => {
    const m = generateBlockModel(getBlastConfig('b1030-022')!);
    const { nz } = m.grid;
    const colMax = (x: number, y: number) => {
      const i = Math.floor(x / 2.5);
      const j = Math.floor(y / 2.5);
      let g = 0;
      for (let k = 0; k < nz; k++) g = Math.max(g, m.grade[blockIdAt(m, i, j, k)]);
      return g;
    };
    // pod cores are high grade; the midpoint between them is waste in every flitch
    expect(colMax(40, 22)).toBeGreaterThan(1.5);
    expect(colMax(72, 37)).toBeGreaterThan(1.5);
    expect(colMax(56, 29.5)).toBeLessThan(0.5);
  });
});
