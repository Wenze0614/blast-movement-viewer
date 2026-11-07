/** Pure attribute/uniform packing helpers (no GPU). */
import { describe, expect, it } from 'vitest';
import { BLOCK_ANIMATION_DURATION, animatedCentroid, animatedScale, blockProgress } from '@/core/easing';
import { OreClass, type BlockModel, type MovementResult } from '@/core/types';
import { GRADE_PALETTE } from '@/state/palette';
import easeChunk from '../shaders/chunks/ease.glsl';
import { createBlocksUniforms } from '../shaders/blocks.uniforms';
import vert from '../shaders/blocks.vert.glsl';
import { hexToLinearRgb, packClassColours, packInstances, srgbToLinear } from '../systems/blocksAttributes';
import { digLineElevation, ringsToSegments } from '../systems/digLinesGeometry';

const grid = { origin: [0, 0, 1030] as [number, number, number], blockSize: [2.5, 2.5, 2.5] as [number, number, number], nx: 2, ny: 1, nz: 1 };
const model = {
  grid,
  count: 2,
  centroid: new Float32Array([1.25, 1.25, 1031.25, 3.75, 1.25, 1031.25]),
  oreClass: new Uint8Array([OreClass.Waste, OreClass.HighGrade]),
} as unknown as BlockModel;
const movement = {
  start: model.centroid,
  end: new Float32Array([5, 1, 1030.5, 9, 2, 1031]),
  delay: new Float32Array([0, 0.5]),
  looseScale: 1.3 ** (1 / 3),
} as unknown as MovementResult;

describe('packInstances', () => {
  it('before a movement: end = start, zero delays, scale 1 (no pop when it arrives at t = 0)', () => {
    const p = packInstances(model, null);
    expect(p.count).toBe(2);
    expect(p.start).toBe(model.centroid);
    expect(p.end).toBe(model.centroid);
    expect(Array.from(p.delay)).toEqual([0, 0]);
    expect(p.scaleEnd).toBe(1);
    expect(p.blockSize).toEqual([2.5, 2.5, 2.5]);
  });

  it("with a movement: shares the MovementResult's typed arrays (no copies) and uses looseScale", () => {
    const p = packInstances(model, movement);
    expect(p.start).toBe(movement.start);
    expect(p.end).toBe(movement.end);
    expect(p.delay).toBe(movement.delay);
    expect(p.scaleEnd).toBeCloseTo(1.0914, 4);
  });

  it('rejects a movement with a different block count', () => {
    expect(() => packInstances(model, { ...movement, start: new Float32Array(3) })).toThrow(/movement has 1 blocks/);
  });
});

describe('colours', () => {
  it('srgbToLinear / hexToLinearRgb follow the sRGB transfer function', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214, 3);
    expect(hexToLinearRgb('#ffffff')).toEqual([1, 1, 1]);
    expect(() => hexToLinearRgb('red')).toThrow();
  });

  it('packClassColours writes one linear RGB triple per block from the grade palette', () => {
    const out = packClassColours(model.oreClass, GRADE_PALETTE);
    expect(out).toHaveLength(6);
    expect(Array.from(out.subarray(0, 3))).toEqual(hexToLinearRgb('#8b9099').map(Math.fround));
    expect(Array.from(out.subarray(3, 6))).toEqual(hexToLinearRgb('#b3134a').map(Math.fround));
  });

  it('rewrites an existing aColor array in place (colour-mode change)', () => {
    const target = new Float32Array(6);
    expect(packClassColours(model.oreClass, GRADE_PALETTE, target)).toBe(target);
    expect(() => packClassColours(model.oreClass, GRADE_PALETTE, new Float32Array(3))).toThrow();
  });

  it('palette matches ADR-8', () => {
    expect([GRADE_PALETTE[0].hex, GRADE_PALETTE[1].hex, GRADE_PALETTE[2].hex]).toEqual(['#8b9099', '#e3a72f', '#b3134a']);
  });
});

describe('block uniforms and shader (ADR-2)', () => {
  it('uniform defaults: uDur = core BLOCK_ANIMATION_DURATION, uScaleEnd 1, progress 0', () => {
    const u = createBlocksUniforms();
    expect(u.uDur.value).toBe(BLOCK_ANIMATION_DURATION);
    expect(u.uScaleEnd.value).toBe(1);
    expect(u.uProgress.value).toBe(0);
    expect(u.uLightDir.value.length()).toBeCloseTo(1, 6);
  });

  it('the GLSL easing is the same smoothstep and arc as core/easing.ts', () => {
    expect(easeChunk).toContain('clamp((progress - delay) / dur, 0.0, 1.0)');
    expect(easeChunk).toContain('t * t * (3.0 - 2.0 * t)');
    expect(easeChunk).toContain('arc * 4.0 * t * (1.0 - t) * length(end.xy - start.xy)');
    expect(vert).toContain(easeChunk);
    expect(vert).toContain('mix(1.0, uScaleEnd, t)');
    for (const a of ['aStart', 'aEnd', 'aDelay', 'aColor']) expect(vert).toMatch(new RegExp(`attribute \\w+ ${a};`));
  });

  it('no popping: every block is exactly at start at progress 0 and at end at progress 1', () => {
    for (const delay of [0, 0.2, 0.5]) {
      expect(blockProgress(0, delay)).toBe(0);
      expect(blockProgress(1, delay)).toBe(1);
    }
    expect(animatedCentroid(movement.start, movement.end, 1, 0, 0.18)).toEqual(Array.from(movement.start.subarray(3, 6)));
    expect(animatedCentroid(movement.start, movement.end, 1, 1, 0.18)).toEqual(Array.from(movement.end.subarray(3, 6)));
    expect(animatedScale(0, 1.09)).toBe(1);
    expect(animatedScale(1, 1.09)).toBe(1.09);
  });
});

describe('dig-line segments', () => {
  it('closes every ring (outer and holes) into segment pairs at a fixed elevation', () => {
    const square: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const hole: [number, number][] = [
      [4, 4],
      [6, 4],
      [5, 6],
    ];
    const seg = ringsToSegments([[square, hole]], 1040.15);
    expect(seg).toHaveLength((4 + 3) * 6);
    // last segment of the square joins [0, 10] back to [0, 0]
    expect(Array.from(seg.subarray(18, 24))).toEqual([0, 10, Math.fround(1040.15), 0, 0, Math.fround(1040.15)]);
    for (let i = 2; i < seg.length; i += 3) expect(seg[i]).toBe(Math.fround(1040.15));
  });

  it('empty polygons give no segments; elevation sits just above the crest', () => {
    expect(ringsToSegments([], 0)).toHaveLength(0);
    expect(digLineElevation({ ...grid, nz: 4 })).toBeCloseTo(1040.15, 9);
  });
});
