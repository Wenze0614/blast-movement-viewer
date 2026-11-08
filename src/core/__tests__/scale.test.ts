/**
 * The ~2 million-block scale blast end to end in core: generation, movement, dig lines,
 * reconciliation and the compact codec, with their invariants and loose time bounds (the README
 * "Performance" numbers are measured, not asserted; these only catch an order-of-magnitude
 * regression such as reconciliation going back to O(N·V)).
 */
import { describe, expect, it } from 'vitest';
import { getBlastConfig, SCALE_BLAST_ID } from '../blasts';
import { configBlockCount, generateBlockModel } from '../blockModel';
import { decodeModel, decodeMovement, encodeModel, encodeMovement, readHeader } from '../codec';
import { adjustedDigPolygon, originalDigPolygon } from '../digline';
import { computeMovementDetailed } from '../movement';
import { reconcileScenarios } from '../reconcile';

const cfg = getBlastConfig(SCALE_BLAST_ID)!;
/** Bit-for-bit equality of two typed arrays. */
const sameBytes = (a: ArrayBufferView, b: ArrayBufferView) => {
  const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
const time = <T>(fn: () => T): [T, number] => {
  const t0 = performance.now();
  const v = fn();
  return [v, performance.now() - t0];
};

describe('scale blast (b1050-001, about 2 million blocks)', () => {
  it('has 2,074,720 blocks (440 × 260 × 20 cells of 0.5 m, cut by its outline)', () => {
    expect(configBlockCount(cfg)).toBe(2_074_720);
  });

  it('generates, moves, reconciles and round-trips through the codec with every invariant', () => {
    const [model, genMs] = time(() => generateBlockModel(cfg));
    expect(model.count).toBe(2_074_720);
    const [{ result: mv, stats }, moveMs] = time(() => computeMovementDetailed(model, cfg.defaultParams));
    expect(stats.converged).toBe(true);
    expect(stats.pathFallbacks).toBe(0);

    // Unique post-blast slots without a 2M-entry Set: sort (cell, level) keys, check neighbours.
    const g = mv.postGrid;
    const keys = new Float64Array(model.count);
    for (let n = 0; n < model.count; n++) {
      const ix = Math.floor((mv.end[3 * n] - g.origin[0]) / g.cellSize);
      const iy = Math.floor((mv.end[3 * n + 1] - g.origin[1]) / g.cellSize);
      const lv = Math.round((mv.end[3 * n + 2] - model.grid.origin[2]) / stats.stackHeight - 0.5);
      expect(stats.validMask[ix + g.nx * iy]).toBe(1);
      keys[n] = (ix + g.nx * iy) * 65536 + lv;
    }
    keys.sort();
    for (let n = 1; n < keys.length; n++) if (keys[n] === keys[n - 1]) expect.fail(`two blocks share slot ${keys[n]}`);

    const [polygons, digMs] = time(() => ({ original: originalDigPolygon(model), adjusted: adjustedDigPolygon(model, mv) }));
    const [rec, recMs] = time(() => reconcileScenarios(model, mv, polygons));
    expect(rec.insitu_original.oreLossPct).toBeGreaterThanOrEqual(0);
    expect(rec.post_original.mill.tonnes).toBeGreaterThan(0);

    const m = encodeModel(model);
    const v = encodeMovement(mv, model);
    expect(readHeader(m).fields.map((f) => f.name)).toEqual(['grade', 'cell', 'rockType']);
    expect(m.byteLength / model.count).toBeLessThan(9.1);
    expect((v.byteLength - mv.surface.height.byteLength) / model.count).toBeLessThan(10.1);
    const back = decodeModel(m);
    const backMv = decodeMovement(v, back);
    expect(sameBytes(back.centroid, model.centroid)).toBe(true);
    expect(sameBytes(back.tonnes, model.tonnes)).toBe(true);
    expect(sameBytes(backMv.end, mv.end)).toBe(true);

    console.info(
      `scale ${model.count} blocks: generate ${genMs.toFixed(0)} ms, movement ${moveMs.toFixed(0)} ms, ` +
        `dig lines ${digMs.toFixed(0)} ms, reconcile ${recMs.toFixed(0)} ms, model ${(m.byteLength / 1e6).toFixed(1)} MB, movement ${(v.byteLength / 1e6).toFixed(1)} MB`,
    );
    // Loose bounds (about 5× the measured times on an Apple M4 Pro).
    expect(genMs).toBeLessThan(8000);
    expect(moveMs).toBeLessThan(12000);
    expect(recMs).toBeLessThan(2500);
  }, 120_000);
});
