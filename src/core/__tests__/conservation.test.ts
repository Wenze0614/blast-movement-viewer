/**
 * Conservation laws (M1, M3c, ADR-4). These are the invariants a real movement engine promises:
 * the post-blast model keeps total tonnage and metal; only position changes.
 */
import { describe, expect, it } from 'vitest';
import { STANDARD_BLASTS, getBlastConfig } from '../blasts';
import { blockVolume, generateBlockModel } from '../blockModel';
import { DEFAULT_BLAST_PARAMETERS } from '../defaults';
import { columnSums, postBlastPlanGrid } from '../grid2d';
import { computeMovement } from '../movement';

const model = generateBlockModel(getBlastConfig('b1040-017')!);
const movement = computeMovement(model, DEFAULT_BLAST_PARAMETERS);

function sum(a: ArrayLike<number>, f: (v: number, i: number) => number = (v) => v): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += f(a[i], i);
  return s;
}

describe('conservation', () => {
  it.each(STANDARD_BLASTS.map((c) => c.id))('M1: Σ tonnes = Σ (block volume × density) for the in-situ model (%s)', (id) => {
    const m = generateBlockModel(getBlastConfig(id)!);
    const v = blockVolume(m.grid);
    // per block exactly (as Float32), hence in total
    for (let n = 0; n < m.count; n++) expect(m.tonnes[n]).toBe(Math.fround(v * m.density[n]));
    const expected = sum(m.density, (d) => v * d);
    expect(Math.abs(sum(m.tonnes) - expected) / expected).toBeLessThan(1e-6);
  });

  it('M3c: Σ tonnes after movement = Σ tonnes before (exact: tonnes travel with the block)', () => {
    // Every block lands in exactly one post-blast cell, so summing tonnes by post-blast cell
    // recovers the in-situ total (nothing lost off the grid, nothing double counted).
    const post = columnSums(postBlastPlanGrid(movement), movement.end, model.tonnes, model.grade);
    const before = sum(model.tonnes);
    expect(Math.abs(sum(post.tonnes) - before) / before).toBeLessThan(1e-12);
    expect(movement.end.length).toBe(model.centroid.length);
  });

  it('M3c: Σ tonnes × grade (metal) after movement = before', () => {
    const post = columnSums(postBlastPlanGrid(movement), movement.end, model.tonnes, model.grade);
    const before = sum(model.tonnes, (t, i) => t * model.grade[i]);
    expect(Math.abs(sum(post.metal) - before) / before).toBeLessThan(1e-12);
  });

  it('ADR-4: loose volume = swellFactor × bank volume (block volume scaled by looseScale³)', () => {
    const bank = model.count * blockVolume(model.grid);
    const k = movement.looseScale;
    // per block slot: c′² × stacked height = (c·k)² × (H_b·k) = V·k³
    const loosePerBlock = movement.postGrid.cellSize ** 2 * model.grid.blockSize[2] * k;
    expect(loosePerBlock * model.count).toBeCloseTo(DEFAULT_BLAST_PARAMETERS.swellFactor * bank, 6);
    // and the muckpile heightfield encloses exactly that volume
    const surfaceVolume = sum(movement.surface.height) * movement.surface.cellSize ** 2;
    expect(surfaceVolume / (DEFAULT_BLAST_PARAMETERS.swellFactor * bank)).toBeCloseTo(1, 5);
  });

  it('ADR-4: looseScale = swellFactor^(1/3) (1.3 → ≈1.091)', () => {
    expect(movement.looseScale).toBeCloseTo(Math.cbrt(1.3), 12);
    expect(movement.looseScale).toBeCloseTo(1.091, 3);
    const m2 = computeMovement(model, { ...DEFAULT_BLAST_PARAMETERS, swellFactor: 1.5 });
    expect(m2.looseScale).toBeCloseTo(Math.cbrt(1.5), 12);
  });
});
