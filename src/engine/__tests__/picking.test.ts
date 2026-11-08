/**
 * P2 CPU picking (pure maths): nearest hit, misses, hidden blocks skipped, and agreement with the
 * shader's animated boxes at any progress (brute-force column check on a real blast).
 */
import { describe, expect, it } from 'vitest';
import { animatedCentroid, animatedScale, BLOCK_ANIMATION_DURATION, blockProgress } from '@/core/easing';
import { LocalDataSource } from '@/data';
import { pickBlock, type PickScene } from '../picking';
import { THROW_ARC } from '../shaders/blocks.uniforms';
import { packOreFlags } from '../systems/blocksAttributes';

const OFF: PickScene['section'] = [0, 0, 0, -1];

const data = new LocalDataSource();
const model = await data.getModel('b1040-017');
const movement = await data.getMovement('b1040-017', (await data.getBlast('b1040-017')).defaultParams);

/** Three unit blocks in a row along x (centres x = 0, 2, 4), not moving. */
function row(extra: Partial<PickScene> = {}): PickScene {
  const start = new Float32Array([0, 0, 0, 2, 0, 0, 4, 0, 0]);
  return {
    count: 3,
    start,
    end: start,
    delay: new Float32Array(3),
    blockSize: [1, 1, 1],
    scaleEnd: 1,
    progress: 0,
    duration: BLOCK_ANIMATION_DURATION,
    arc: 0,
    section: OFF,
    oreOnly: false,
    ore: new Float32Array([1, 1, 1]),
    ...extra,
  };
}

describe('pickBlock (synthetic)', () => {
  it('returns the nearest block along the ray, from either side', () => {
    expect(pickBlock({ origin: [-10, 0, 0], direction: [1, 0, 0] }, row())).toBe(0);
    expect(pickBlock({ origin: [10, 0, 0], direction: [-1, 0, 0] }, row())).toBe(2);
  });

  it('misses: off to the side, pointing away, or with the blocks behind the origin', () => {
    expect(pickBlock({ origin: [-10, 3, 0], direction: [1, 0, 0] }, row())).toBeNull();
    expect(pickBlock({ origin: [-10, 0, 0], direction: [-1, 0, 0] }, row())).toBeNull();
    expect(pickBlock({ origin: [10, 0, 0], direction: [0, 0, 1] }, row())).toBeNull();
  });

  it('an origin inside a block skips it (its faces are back faces from inside, culled) and hits the next', () => {
    expect(pickBlock({ origin: [2.2, 0, 0], direction: [1, 0, 0] }, row())).toBe(2);
    expect(pickBlock({ origin: [4.2, 0, 0], direction: [1, 0, 0] }, row())).toBeNull();
  });

  it('near/far clipping: an entry closer than near or beyond far is not drawn, so not picked', () => {
    // Entries along +x from x = -10: block 0 at t = 9.5, block 1 at 11.5, block 2 at 13.5.
    const ray = { origin: [-10, 0, 0] as const, direction: [1, 0, 0] as const };
    expect(pickBlock({ ...ray, near: 9.4 }, row())).toBe(0);
    expect(pickBlock({ ...ray, near: 9.6 }, row())).toBe(1);
    expect(pickBlock({ ...ray, near: 13.6 }, row())).toBeNull();
    expect(pickBlock({ ...ray, far: 9.4 }, row())).toBeNull();
    expect(pickBlock({ ...ray, far: 9.6 }, row())).toBe(0);
    // Units of |direction|: a direction of length 2 halves the distances.
    expect(pickBlock({ origin: [-10, 0, 0], direction: [2, 0, 0], near: 4.8 }, row())).toBe(1);
  });

  it('axis-aligned rays work (zero direction components)', () => {
    expect(pickBlock({ origin: [4, 0, 10], direction: [0, 0, -1] }, row())).toBe(2);
    expect(pickBlock({ origin: [3, 0, 10], direction: [0, 0, -1] }, row())).toBeNull(); // the gap
  });

  it('skips blocks cut away by the section plane (hidden when dot(n, c) < d)', () => {
    // Keep x ≤ 1 hidden: plane (1,0,0,1) hides centres with x < 1 → block 0.
    expect(pickBlock({ origin: [-10, 0, 0], direction: [1, 0, 0] }, row({ section: [1, 0, 0, 1] }))).toBe(1);
  });

  it('ore-only skips waste blocks, and only when enabled', () => {
    const ore = new Float32Array([0, 1, 1]);
    expect(pickBlock({ origin: [-10, 0, 0], direction: [1, 0, 0] }, row({ ore }))).toBe(0);
    expect(pickBlock({ origin: [-10, 0, 0], direction: [1, 0, 0] }, row({ ore, oreOnly: true }))).toBe(1);
  });

  it('follows the animation: start at progress 0, end (with swell) at progress 1', () => {
    const start = new Float32Array([0, 0, 0]);
    const end = new Float32Array([10, 0, 0]);
    const s: PickScene = { ...row(), count: 1, start, end, delay: new Float32Array(1), ore: new Float32Array([1]) };
    const down = (x: number) => ({ origin: [x, 0, 10] as const, direction: [0, 0, -1] as const });
    expect(pickBlock(down(0), { ...s, progress: 0 })).toBe(0);
    expect(pickBlock(down(10), { ...s, progress: 0 })).toBeNull();
    expect(pickBlock(down(10), { ...s, progress: 1 })).toBe(0);
    expect(pickBlock(down(0), { ...s, progress: 1 })).toBeNull();
    // Swell: at progress 1 the block is scaleEnd × wider.
    expect(pickBlock(down(10.6), { ...s, progress: 1, scaleEnd: 1.3 })).toBe(0);
    expect(pickBlock(down(10.6), { ...s, progress: 1, scaleEnd: 1 })).toBeNull();
  });
});

describe('pickBlock on a real blast agrees with the animated boxes', () => {
  const base: PickScene = {
    count: model.count,
    start: movement.start,
    end: movement.end,
    delay: movement.delay,
    blockSize: model.grid.blockSize,
    scaleEnd: movement.looseScale,
    progress: 0,
    duration: BLOCK_ANIMATION_DURATION,
    arc: THROW_ARC,
    section: OFF,
    oreOnly: false,
    ore: packOreFlags(model.grade, model.grades.cutoff),
  };

  /** Brute force: the visible block whose animated box contains (x, y) with the highest top. */
  function topBlockAt(s: PickScene, x: number, y: number): number | null {
    let best = -Infinity;
    let id: number | null = null;
    const p: [number, number, number] = [0, 0, 0];
    for (let b = 0; b < s.count; b++) {
      if (s.oreOnly && s.ore[b] < 0.5) continue;
      const t = blockProgress(s.progress, s.delay[b], s.duration);
      animatedCentroid(s.start, s.end, b, t, s.arc, p);
      if (s.section[0] * p[0] + s.section[1] * p[1] + s.section[2] * p[2] < s.section[3]) continue;
      const k = animatedScale(t, s.scaleEnd) / 2;
      const hx = s.blockSize[0] * k;
      const hy = s.blockSize[1] * k;
      if (Math.abs(x - p[0]) > hx || Math.abs(y - p[1]) > hy) continue;
      const top = p[2] + s.blockSize[2] * k;
      if (top > best) {
        best = top;
        id = b;
      }
    }
    return id;
  }

  const cases: [string, Partial<PickScene>][] = [
    ['in situ', { progress: 0 }],
    ['mid-scrub', { progress: 0.37 }],
    ['settled', { progress: 1 }],
    ['settled, ore only', { progress: 1, oreOnly: true }],
    ['settled, section y ≥ 30', { progress: 1, section: [0, 1, 0, 30] }],
  ];

  it.each(cases)('%s: a vertical ray hits the highest box over the point', (_name, extra) => {
    const s = { ...base, ...extra };
    let hits = 0;
    // Deterministic sample of points over the bench and muckpile (offset from cell boundaries).
    for (let x = 1.3; x < 125; x += 3.7) {
      for (let y = 1.1; y < 60; y += 4.3) {
        const expected = topBlockAt(s, x, y);
        expect(pickBlock({ origin: [x, y, 2000], direction: [0, 0, -1] }, s)).toBe(expected);
        if (expected !== null) hits++;
      }
    }
    expect(hits).toBeGreaterThan(20);
  });
});
