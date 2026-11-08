/**
 * Blast footprint (core/footprint.ts): bench-local frames, outline column masks, per-strip faces.
 */
import { describe, expect, it } from 'vitest';
import { getBlastConfig } from '../blasts';
import { generateBlockModel } from '../blockModel';
import { benchFrame, createFootprint, FLOOR_WIDTH, modelColumnMask, outlineColumnMask, SIDE_OPEN, type FreeFace } from '../footprint';
import type { GridSpec } from '../types';

const grid: GridSpec = { origin: [100, 200, 1000], blockSize: [2, 2, 2], nx: 5, ny: 4, nz: 3 };

describe('benchFrame', () => {
  it.each(['east', 'west', 'north', 'south'] as FreeFace[])('%s: toLocal/toWorld invert, columnOf names the column under (a, b)', (face) => {
    const f = benchFrame(grid, face);
    expect(f.nAlong * f.nLat).toBe(grid.nx * grid.ny);
    expect([f.A, f.W]).toEqual(face === 'east' || face === 'west' ? [10, 8] : [8, 10]);
    for (let ai = 0; ai < f.nAlong; ai++) {
      for (let bi = 0; bi < f.nLat; bi++) {
        const [x, y] = f.toWorld((ai + 0.5) * f.ca, (bi + 0.5) * f.cb);
        const [a, b] = f.toLocal(x, y);
        expect(a).toBeCloseTo((ai + 0.5) * f.ca, 10);
        expect(b).toBeCloseTo((bi + 0.5) * f.cb, 10);
        const i = Math.floor((x - 100) / 2);
        const j = Math.floor((y - 200) / 2);
        expect(f.columnOf(ai, bi)).toBe(i + grid.nx * j);
      }
    }
  });

  it('a = toward the free face: the face-side edge of the box has a = A', () => {
    expect(benchFrame(grid, 'east').toLocal(110, 201)[0]).toBe(10);
    expect(benchFrame(grid, 'west').toLocal(100, 201)[0]).toBe(10);
    expect(benchFrame(grid, 'north').toLocal(101, 208)[0]).toBe(8);
    expect(benchFrame(grid, 'south').toLocal(101, 200)[0]).toBe(8);
  });
});

describe('outlineColumnMask', () => {
  it('without an outline every column is in', () => {
    expect(Array.from(outlineColumnMask(grid))).toEqual(new Array(20).fill(1));
  });

  it('keeps the columns whose centre is inside the ring', () => {
    // Triangle over the lower-left half: centre (101, 201) in, (109, 207) out.
    const mask = outlineColumnMask(grid, [
      [100, 200],
      [110, 200],
      [100, 208],
    ]);
    expect(mask[0]).toBe(1);
    expect(mask[4 + 5 * 3]).toBe(0);
    expect(mask.reduce((s, v) => s + v, 0)).toBeGreaterThan(5);
    expect(mask.reduce((s, v) => s + v, 0)).toBeLessThan(15);
  });
});

describe('createFootprint', () => {
  // East face, 5 × 4 columns. Rows (j) from the bottom:
  //   j=3  . . . . .     (empty strip)
  //   j=2  # # # . .     face at a = 6 (recessed)
  //   j=1  . # # # #     face at a = 10
  //   j=0  . # # # #     face at a = 10
  const cols = new Uint8Array(20);
  for (const [i, j] of [[1, 0], [2, 0], [3, 0], [4, 0], [1, 1], [2, 1], [3, 1], [4, 1], [0, 2], [1, 2], [2, 2]]) cols[i + 5 * j] = 1;
  const fp = createFootprint(grid, cols, 'east');

  it('face per lateral strip; empty strips take the frontmost face', () => {
    expect(Array.from(fp.front)).toEqual([10, 10, 6, NaN]);
    expect([fp.frontMax, fp.backMin, fp.latMin, fp.latMax]).toEqual([10, 0, 0, 6]);
    expect(fp.faceLine(1)).toBe(10);
    expect(fp.faceLine(5)).toBe(6);
    expect(fp.faceLine(7)).toBe(10); // empty strip j = 3
    expect(fp.faceLine(-3)).toBe(10); // beside the box
  });

  it('contains = inside a present column; isOpen = in front of the strip face', () => {
    expect(fp.contains(1, 1)).toBe(false); // (0, 0) is rock
    expect(fp.contains(3, 1)).toBe(true);
    expect(fp.contains(5, 5)).toBe(true);
    expect(fp.contains(7, 5)).toBe(false);
    expect(fp.isOpen(7, 5)).toBe(true); // in front of the recessed face
    expect(fp.isOpen(7, 1)).toBe(false); // inside the blast, behind its face
    expect(fp.isOpen(1, 1)).toBe(false); // rock behind the face
    expect(fp.isOpen(10, 1)).toBe(true);
    expect(fp.isOpen(9.9, 7)).toBe(false); // beside the blast: rock until the frontmost face
    expect(fp.isOpen(10, 7)).toBe(true);
  });

  it('the open floor is bounded: FLOOR_WIDTH past the frontmost face, SIDE_OPEN beyond the sides', () => {
    expect([fp.openEnd, fp.openLatMin, fp.openLatMax]).toEqual([10 + FLOOR_WIDTH, -SIDE_OPEN, 6 + SIDE_OPEN]);
    expect(fp.isOpen(10 + FLOOR_WIDTH - 0.01, 3)).toBe(true);
    expect(fp.isOpen(10 + FLOOR_WIDTH, 3)).toBe(false);
    expect(fp.isOpen(20, -SIDE_OPEN)).toBe(true);
    expect(fp.isOpen(20, -SIDE_OPEN - 0.01)).toBe(false);
    expect(fp.isOpen(20, 6 + SIDE_OPEN)).toBe(false);
    expect(fp.isFree(3, 1)).toBe(true); // footprint
    expect(fp.isFree(20, 1)).toBe(true); // open floor
    expect(fp.isFree(1, 1)).toBe(false); // rock
  });

  it('boxIsFree: the whole square must be free ground (a rock column inside a box is found)', () => {
    expect(fp.boxIsFree(2, 0, 4)).toBe(true); // columns (1..2, 0..1), all present
    expect(fp.boxIsFree(0, 0, 4)).toBe(false); // includes rock column (0, 0)
    expect(fp.boxIsFree(6, 4, 2)).toBe(true); // in front of the recessed face: open
    expect(fp.boxIsFree(5, 4, 2)).toBe(true); // half on column (2, 2), half on the open floor in front of it
    expect(fp.boxIsFree(9, 5, 2)).toBe(false); // straddles row 2 open and row 3 rock behind the frontmost face
    expect(fp.boxIsFree(10, 5, 2)).toBe(true);
    // A single rock column fully inside a larger box is still caught.
    const holed = new Uint8Array(20).fill(1);
    holed[2 + 5 * 1] = 0;
    const h = createFootprint(grid, holed, 'east');
    expect(h.boxIsFree(3, 1, 4)).toBe(false);
    expect(h.boxIsFree(6, 0, 4)).toBe(true);
  });

  it('an empty mask behaves like an empty rectangular bench', () => {
    const empty = createFootprint(grid, new Uint8Array(20), 'east');
    expect([empty.frontMax, empty.backMin, empty.latMin, empty.latMax]).toEqual([10, 0, 0, 8]);
    expect(empty.isOpen(10, 4)).toBe(true);
    expect(empty.contains(5, 4)).toBe(false);
  });

  it('rejects a mask of the wrong size', () => {
    expect(() => createFootprint(grid, new Uint8Array(3), 'east')).toThrow(/wrong length/);
  });

  it('modelColumnMask of a generated model equals its outline mask', () => {
    const cfg = getBlastConfig('b1030-022')!;
    expect(Array.from(modelColumnMask(generateBlockModel(cfg)))).toEqual(Array.from(outlineColumnMask(cfg.grid, cfg.outline)));
  });
});
