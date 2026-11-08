/**
 * P2 inspector: getBlockMovement agrees with reconcile's millMask for every block and scenario,
 * so the inspector can never contradict the outcome colours or the reconciliation table.
 */
import { describe, expect, it } from 'vitest';
import { getBlastConfig } from '../blasts';
import { generateBlockModel } from '../blockModel';
import { originalDigPolygon, adjustedDigPolygon } from '../digline';
import { getBlockMovement } from '../inspect';
import { computeMovement } from '../movement';
import { millMask } from '../reconcile';

const cfg = getBlastConfig('b1040-017')!;
const model = generateBlockModel(cfg);
const movement = computeMovement(model, cfg.defaultParams);
const polygons = { original: originalDigPolygon(model), adjusted: adjustedDigPolygon(model, movement) };

describe('getBlockMovement', () => {
  it('destinations match millMask for every block in all three scenarios', () => {
    const pre = millMask(model.centroid, polygons.original);
    const post = millMask(movement.end, polygons.original);
    const adj = millMask(movement.end, polygons.adjusted);
    const dest = (m: Uint8Array, b: number) => (m[b] === 1 ? 'mill' : 'waste');
    let mismatches = 0;
    for (let b = 0; b < model.count; b++) {
      const v = getBlockMovement(model, movement, polygons, b);
      if (v.preDestination !== dest(pre, b) || v.postDestination !== dest(post, b) || v.adjustedDestination !== dest(adj, b)) {
        mismatches++;
      }
    }
    expect(mismatches).toBe(0);
    // The fixture exercises both destinations in the post/original scenario.
    expect(post.includes(0) && post.includes(1)).toBe(true);
  });

  it('final position, displacement and distance come from the movement arrays', () => {
    const b = 1234;
    const v = getBlockMovement(model, movement, polygons, b);
    expect(v.blockId).toBe(b);
    for (let a = 0; a < 3; a++) {
      expect(v.finalPosition[a]).toBe(movement.end[3 * b + a]);
      expect(v.displacement[a]).toBeCloseTo(movement.end[3 * b + a] - model.centroid[3 * b + a], 5);
    }
    expect(v.distance).toBeCloseTo(Math.hypot(...v.displacement), 4);
  });

  it('rejects ids outside the model and a movement for another model', () => {
    expect(() => getBlockMovement(model, movement, polygons, -1)).toThrow(RangeError);
    expect(() => getBlockMovement(model, movement, polygons, model.count)).toThrow(RangeError);
    expect(() => getBlockMovement(model, movement, polygons, 1.5)).toThrow(RangeError);
    const short = { ...movement, end: movement.end.subarray(0, 30) };
    expect(() => getBlockMovement(model, short, polygons, 0)).toThrow(/movement has 10 blocks/);
  });
});
