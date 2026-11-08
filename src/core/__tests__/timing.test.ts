/**
 * Firing sequence (core/timing.ts) and its effect on the movement (core/movement.ts).
 */
import { describe, expect, it } from 'vitest';
import { getBlastConfig } from '../blasts';
import { blockIdAt, generateBlockModel } from '../blockModel';
import { DEFAULT_BLAST_PARAMETERS, DEFAULT_PATTERN } from '../defaults';
import { createFootprint, modelColumnMask, modelFootprint } from '../footprint';
import { buildBlastDetail } from '../holes';
import { computeMovementDetailed } from '../movement';
import { createFiringField, holeFiringTimes, leftSign } from '../timing';
import type { BlastParameters, GridSpec, Initiation } from '../types';

const P = DEFAULT_BLAST_PARAMETERS;
const B = DEFAULT_PATTERN.burden; // 4.0
const S = DEFAULT_PATTERN.spacing; // 4.6

// A full 100 × 60 m bench (40 × 24 columns of 2.5 m), east face: a = x, b = y.
const grid: GridSpec = { origin: [0, 0, 1030], blockSize: [2.5, 2.5, 2.5], nx: 40, ny: 24, nz: 4 };
const fp = createFootprint(grid, new Uint8Array(40 * 24).fill(1), 'east');
const field = (initiation: Initiation, rowDelayMs = 42, holeDelayMs = 25) =>
  createFiringField(fp, DEFAULT_PATTERN, { initiation, rowDelayMs, holeDelayMs });

describe('firing field', () => {
  it('left/right are seen from behind the blast: facing east, left is north (+b); facing west, left is south', () => {
    expect(leftSign(fp)).toBe(1);
    expect(leftSign(createFootprint(grid, new Uint8Array(40 * 24).fill(1), 'west'))).toBe(-1);
  });

  it('row by row: rows one burden apart fire rowDelay apart; relief is straight at the face', () => {
    const f = field('row');
    expect(f.timeAt(99, 30)).toBe(0); // front row
    expect(f.timeAt(100 - B - 0.5, 30)).toBe(42);
    expect(f.timeAt(100 - 5 * B - 0.5, 5)).toBe(5 * 42);
    expect(f.timeAt(99, 5)).toBe(f.timeAt(99, 55)); // a whole row fires together
    expect(f.reliefAt(50, 10)).toEqual([1, 0]);
    expect(Number.isNaN(f.origin)).toBe(true);
  });

  it('V: holes fire outward from the front centre; relief converges on the centre line', () => {
    const f = field('v');
    expect(f.origin).toBe(30);
    expect(f.timeAt(99, 30)).toBe(0); // the initiating hole
    expect(f.timeAt(99, 30 + S)).toBe(25);
    expect(f.timeAt(99, 30 - 2 * S)).toBe(50);
    expect(f.timeAt(100 - B - 0.5, 30 + S)).toBe(42 + 25);
    const [na, nb] = f.reliefAt(50, 50); // north half → pushed south
    const [sa, sb] = f.reliefAt(50, 10); // south half → pushed north
    expect(na).toBeGreaterThan(0);
    expect(nb).toBeLessThan(0);
    expect(sb).toBeCloseTo(-nb, 12);
    expect(sa).toBeCloseTo(na, 12);
    // angle off the face normal = atan((holeDelay/S) / (rowDelay/B))
    expect(Math.atan2(-nb, na)).toBeCloseTo(Math.atan2(25 / S, 42 / B), 12);
    // tapers to straight on the centre line (no cross-over between the halves)
    expect(f.reliefAt(50, 30)).toEqual([1, 0]);
    expect(Math.abs(f.reliefAt(50, 30 + S / 4)[1])).toBeLessThan(Math.abs(nb));
  });

  it('echelon: fires from a front corner along the row; relief is diagonal toward that corner', () => {
    const left = field('echelon-left'); // facing east: left = north = b 60
    expect(left.origin).toBe(60);
    expect(left.timeAt(99, 59)).toBe(0);
    expect(left.timeAt(99, 59 - S)).toBe(25);
    expect(left.reliefAt(50, 30)[1]).toBeGreaterThan(0); // toward the north corner
    const right = field('echelon-right');
    expect(right.origin).toBe(0);
    expect(right.timeAt(99, 1)).toBe(0);
    expect(right.reliefAt(50, 30)[1]).toBeLessThan(0);
    for (const f of [left, right]) {
      const [a, b] = f.reliefAt(50, 30);
      expect(Math.hypot(a, b)).toBeCloseTo(1, 12);
    }
  });

  it('no hole delay → every pattern throws straight; a long hole delay → a near-lateral throw', () => {
    for (const init of ['v', 'echelon-left', 'echelon-right'] as const) expect(field(init, 42, 0).reliefAt(50, 10)).toEqual([1, 0]);
    const [a, b] = field('echelon-right', 5, 200).reliefAt(50, 30);
    expect(Math.abs(b)).toBeGreaterThan(0.95);
    expect(a).toBeGreaterThan(0); // always some component toward the face (rowDelay > 0)
  });
});

describe('movement follows the firing sequence', () => {
  const cfg = getBlastConfig('b1040-017')!;
  const model = generateBlockModel(cfg);
  const run = (initiation: Initiation, over: Partial<BlastParameters> = {}) =>
    computeMovementDetailed(model, { ...P, initiation, randomness: 0, lateralFan: 0, ...over });
  /** Mean lateral (y) displacement of blocks north / south of the footprint's centre line. */
  const lateral = (r: ReturnType<typeof run>) => {
    const f = modelFootprint(model, 'east');
    const mid = (f.latMin + f.latMax) / 2;
    let north = 0;
    let south = 0;
    let nn = 0;
    let ns = 0;
    for (let n = 0; n < model.count; n++) {
      const dy = r.result.displacement[3 * n + 1];
      if (model.centroid[3 * n + 1] > mid + 5) {
        north += dy;
        nn++;
      } else if (model.centroid[3 * n + 1] < mid - 5) {
        south += dy;
        ns++;
      }
    }
    return { north: north / nn, south: south / ns, all: (north + south) / (nn + ns) };
  };

  it('row by row throws straight (no net lateral movement beyond the repose spread)', () => {
    const l = lateral(run('row'));
    expect(Math.abs(l.all)).toBeLessThan(0.5);
  });

  it('a V converges on the centre line: the north half moves south and the south half north', () => {
    const l = lateral(run('v'));
    expect(l.north).toBeLessThan(-0.5);
    expect(l.south).toBeGreaterThan(0.5);
  });

  it('an echelon throws toward its initiating corner (left = north, right = south facing east)', () => {
    expect(lateral(run('echelon-left')).all).toBeGreaterThan(1);
    expect(lateral(run('echelon-right')).all).toBeLessThan(-1);
  });

  it('blocks start moving in firing order: the V\'s front centre first, its back corners last', () => {
    const { result } = run('v');
    const delayAt = (i: number, j: number) => result.delay[blockIdAt(model, i, j, model.grid.nz - 1)];
    // front centre (x ≈ 96, y ≈ 31) vs a front corner and a back corner
    expect(delayAt(38, 12)).toBeLessThan(0.08);
    expect(delayAt(38, 12)).toBeLessThan(delayAt(37, 2));
    expect(delayAt(37, 2)).toBeLessThan(delayAt(4, 3));
    for (const d of result.delay) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(0.5);
    }
  });

  it.each(['row', 'v', 'echelon-left', 'echelon-right'] as const)('%s keeps every invariant (unique slots, free ground, converged)', (init) => {
    for (const id of ['b1040-017', 'b1030-022', 'b1040-031']) {
      const c = getBlastConfig(id)!;
      const m = generateBlockModel(c);
      const { result, stats } = computeMovementDetailed(m, { ...c.defaultParams, initiation: init, holeDelayMs: 60 });
      expect(stats.converged, id).toBe(true);
      expect(stats.pathFallbacks, id).toBe(0);
      const g = result.postGrid;
      const seen = new Set<string>();
      for (let n = 0; n < m.count; n++) {
        const ix = Math.floor((result.end[3 * n] - g.origin[0]) / g.cellSize);
        const iy = Math.floor((result.end[3 * n + 1] - g.origin[1]) / g.cellSize);
        expect(stats.validMask[ix + g.nx * iy]).toBe(1);
        seen.add(`${ix},${iy},${Math.round((result.end[3 * n + 2] - m.grid.origin[2]) / stats.stackHeight - 0.5)}`);
      }
      expect(seen.size, id).toBe(m.count);
    }
  });

  it('the timing parameters are part of the params hash', () => {
    const base = run('v').result.paramsHash;
    expect(run('row').result.paramsHash).not.toBe(base);
    expect(run('v', { rowDelayMs: 50 }).result.paramsHash).not.toBe(base);
    expect(run('v', { holeDelayMs: 30 }).result.paramsHash).not.toBe(base);
  });

  it('rejects a non-positive row delay', () => {
    expect(() => run('v', { rowDelayMs: 0 })).toThrow(RangeError);
  });
});

describe('holeFiringTimes', () => {
  it('uses the same field as the movement: the initiating hole fires at 0, times step by the delays', () => {
    const cfg = getBlastConfig('b1040-017')!;
    const model = generateBlockModel(cfg);
    const { holes } = buildBlastDetail(cfg, model);
    const t = holeFiringTimes(model, holes, P);
    expect(t.length).toBe(holes.length);
    expect(Math.min(...t)).toBe(0);
    const f = createFiringField(createFootprint(model.grid, modelColumnMask(model), 'east'), model.pattern, P);
    holes.forEach((h, i) => expect(t[i]).toBe(f.timeAt(h.collar[0], h.collar[1])));
    // every time is a whole number of row and hole delays
    for (const v of t) {
      let ok = false;
      for (let r = 0; r * 42 <= v && !ok; r++) ok = (v - r * 42) % 25 === 0;
      expect(ok, String(v)).toBe(true);
    }
  });
});
