/**
 * M3 — heuristic movement model `computeMovement(model, params)` (docs/02-plan.md ADR-3, ADR-4).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getBlastConfig } from '../blasts';
import { blockIndex, generateBlockModel } from '../blockModel';
import { DEFAULT_BLAST_PARAMETERS } from '../defaults';
import { canonicalParams } from '../hash';
import {
  allowedDrop,
  computeMovement,
  computeMovementDetailed,
  REPOSE_MAX_BASELINE,
  type MovementStats,
} from '../movement';
import type { BlastParameters, BlockModel, MovementResult } from '../types';

const P = DEFAULT_BLAST_PARAMETERS;

interface Run {
  model: BlockModel;
  result: MovementResult;
  stats: MovementStats;
}

function run(id: string, params: BlastParameters = P): Run {
  const model = generateBlockModel(getBlastConfig(id)!);
  const { result, stats } = computeMovementDetailed(model, params);
  return { model, result, stats };
}

/** Post-blast slot of block n: cell (ix, iy) from end x,y and stack level from end z. */
function slot({ model, result, stats }: Run, n: number) {
  const g = result.postGrid;
  const ix = Math.floor((result.end[3 * n] - g.origin[0]) / g.cellSize);
  const iy = Math.floor((result.end[3 * n + 1] - g.origin[1]) / g.cellSize);
  const levelF = (result.end[3 * n + 2] - model.grid.origin[2]) / stats.stackHeight - 0.5;
  return { ix, iy, cell: ix + g.nx * iy, level: Math.round(levelF), levelF };
}

function cellsOf(r: Run): Map<number, number[]> {
  const cells = new Map<number, number[]>();
  for (let n = 0; n < r.model.count; n++) {
    const { cell } = slot(r, n);
    const list = cells.get(cell);
    if (list) list.push(n);
    else cells.set(cell, [n]);
  }
  return cells;
}

/** Mean horizontal displacement over blocks (i, j, k) matching `pred`. */
function meanHorizontal(r: Run, pred: (i: number, j: number, k: number) => boolean): number {
  const { nx, ny, nz } = r.model.grid;
  let s = 0;
  let c = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!pred(i, j, k)) continue;
        const id = blockIndex(r.model.grid, i, j, k);
        s += Math.hypot(r.result.displacement[3 * id], r.result.displacement[3 * id + 1]);
        c++;
      }
  return s / c;
}

let r017: Run;
let r022: Run;
beforeAll(() => {
  r017 = run('b1040-017');
  r022 = run('b1030-022');
});

describe('computeMovement (M3)', () => {
  it('(a) no two blocks share a post-blast slot (cell index + stack level unique)', () => {
    for (const r of [r017, r022]) {
      const seen = new Set<string>();
      for (let n = 0; n < r.model.count; n++) {
        const s = slot(r, n);
        const key = `${s.cell}:${s.level}`;
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
      expect(seen.size).toBe(r.model.count);
    }
  });

  it('(b) no floating blocks: every block rests on the floor or on the block below it in its cell', () => {
    for (const r of [r017, r022]) {
      const g = r.result.postGrid;
      for (const ids of cellsOf(r).values()) {
        const levels = ids.map((n) => slot(r, n)).sort((a, b) => a.level - b.level);
        levels.forEach((s, lvl) => {
          expect(s.level).toBe(lvl); // levels 0..n-1, no gaps
          expect(Math.abs(s.levelF - lvl)).toBeLessThan(1e-3); // z exactly on the lattice
        });
        // every block in the cell sits at the cell centre
        for (const n of ids) {
          const s = slot(r, n);
          expect(r.result.end[3 * n]).toBeCloseTo(g.origin[0] + (s.ix + 0.5) * g.cellSize, 3);
          expect(r.result.end[3 * n + 1]).toBeCloseTo(g.origin[1] + (s.iy + 0.5) * g.cellSize, 3);
        }
      }
    }
  });

  it('(c) conserves tonnes and metal exactly (see conservation.test.ts)', () => {
    // Blocks keep their id, so tonnes and grade travel with them: every block has exactly one
    // finite end position inside the post-blast grid.
    const { model, result } = r017;
    const g = result.postGrid;
    expect(result.end.length).toBe(3 * model.count);
    for (let n = 0; n < model.count; n++) {
      const s = slot(r017, n);
      expect(s.ix >= 0 && s.ix < g.nx && s.iy >= 0 && s.iy < g.ny).toBe(true);
    }
  });

  it('(d) is deterministic per seed: same model + params give byte-identical end/delay arrays', () => {
    const again = computeMovement(r017.model, P);
    const eq = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
    expect(eq(again.end, r017.result.end)).toBe(true);
    expect(eq(again.delay, r017.result.delay)).toBe(true);
    expect(eq(again.surface.height, r017.result.surface.height)).toBe(true);
    expect(again.paramsHash).toBe(r017.result.paramsHash);
    const other = computeMovement(r017.model, { ...P, seed: 43 });
    expect(eq(other.end, r017.result.end)).toBe(false);
    expect(other.paramsHash).not.toBe(r017.result.paramsHash);
  });

  it('(e) mean horizontal displacement is larger in the top flitch than the bottom flitch', () => {
    for (const r of [r017, r022]) {
      const nz = r.model.grid.nz;
      const top = meanHorizontal(r, (_i, _j, k) => k === nz - 1);
      const bottom = meanHorizontal(r, (_i, _j, k) => k === 0);
      expect(top).toBeGreaterThan(bottom);
    }
  });

  it('(e) mean horizontal displacement is larger in the front row than the back row', () => {
    for (const r of [r017, r022]) {
      const nx = r.model.grid.nx; // free face east: front row = i = nx − 1
      const front = meanHorizontal(r, (i) => i === nx - 1);
      const back = meanHorizontal(r, (i) => i === 0);
      expect(front).toBeGreaterThan(back);
    }
  });

  it('throw magnitudes are in the planned range (front-row crest ≈ 6–10 m, toe ≈ 3–5 m)', () => {
    const { nx, nz } = r017.model.grid;
    const frontTop = meanHorizontal(r017, (i, _j, k) => i === nx - 1 && k === nz - 1);
    const frontToe = meanHorizontal(r017, (i, _j, k) => i === nx - 1 && k === 0);
    expect(frontTop).toBeGreaterThan(6);
    expect(frontTop).toBeLessThan(11);
    expect(frontToe).toBeGreaterThan(2.5);
    expect(frontToe).toBeLessThan(6);
    // displacement is mostly toward the free face (+x)
    let sx = 0;
    for (let n = 0; n < r017.model.count; n++) sx += r017.result.displacement[3 * n];
    expect(sx / r017.model.count).toBeGreaterThan(1);
  });

  it('preserves vertical order within each post-blast cell (sorted by original z)', () => {
    for (const r of [r017, r022]) {
      for (const ids of cellsOf(r).values()) {
        const byLevel = ids.slice().sort((a, b) => slot(r, a).level - slot(r, b).level);
        for (let q = 1; q < byLevel.length; q++) {
          expect(r.result.start[3 * byLevel[q] + 2]).toBeGreaterThanOrEqual(r.result.start[3 * byLevel[q - 1] + 2]);
        }
      }
    }
  });

  it('respects the angle of repose after relaxation (lattice criterion, see allowedDrop)', () => {
    // With cubic blocks one block step over one cell is 45°, so "neighbour difference ≤ tan(φ)·c′"
    // cannot hold literally for φ < 45°. The lattice criterion bounds the AVERAGE slope:
    // drop over d cells ≤ max(1, round(d·tan(φ)·c′ / H_b·k)) blocks, for d = 1..6.
    for (const r of [r017, r022]) {
      const { stats, result } = r;
      expect(stats.converged).toBe(true);
      const { nx, ny, cellSize } = result.postGrid;
      const allowed = [0];
      for (let d = 1; d <= REPOSE_MAX_BASELINE; d++) allowed.push(allowedDrop(d, P.reposeAngleDeg, cellSize, stats.stackHeight));
      let violations = 0;
      for (let iy = 0; iy < ny; iy++)
        for (let ix = 0; ix < nx; ix++) {
          const c = ix + nx * iy;
          if (!stats.validMask[c]) continue;
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            for (let d = 1; d <= REPOSE_MAX_BASELINE; d++) {
              const jx = ix + dx * d;
              const jy = iy + dy * d;
              if (jx < 0 || jx >= nx || jy < 0 || jy >= ny || !stats.validMask[jx + nx * jy]) break;
              if (stats.stackCount[c] - stats.stackCount[jx + nx * jy] > allowed[d]) violations++;
            }
          }
        }
      expect(violations).toBe(0);
      // the surface heightfield is the stack count × stacked block height
      for (let c = 0; c < nx * ny; c++) expect(result.surface.height[c]).toBeCloseTo(stats.stackCount[c] * stats.stackHeight, 4);
    }
  });

  it('a steeper repose angle gives a taller, more compact muckpile', () => {
    const steep = computeMovementDetailed(r017.model, { ...P, reposeAngleDeg: 45 });
    const flat = computeMovementDetailed(r017.model, { ...P, reposeAngleDeg: 25 });
    const maxOf = (a: Uint16Array) => a.reduce((m, v) => Math.max(m, v), 0);
    const occupied = (a: Uint16Array) => a.reduce((m, v) => m + (v > 0 ? 1 : 0), 0);
    expect(maxOf(steep.stats.stackCount)).toBeGreaterThanOrEqual(maxOf(flat.stats.stackCount));
    expect(occupied(flat.stats.stackCount)).toBeGreaterThan(occupied(steep.stats.stackCount));
  });

  it('delay is in [0, 0.5] and front rows fire first', () => {
    const { model, result } = r017;
    const { nx, ny, nz } = model.grid;
    let front = 0;
    let back = 0;
    for (let n = 0; n < model.count; n++) {
      expect(result.delay[n]).toBeGreaterThanOrEqual(0);
      expect(result.delay[n]).toBeLessThanOrEqual(0.5);
    }
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++) {
        front += result.delay[blockIndex(model.grid, nx - 1, j, k)];
        back += result.delay[blockIndex(model.grid, 0, j, k)];
      }
    expect(front / (ny * nz)).toBeLessThan(0.1);
    expect(back / (ny * nz)).toBeGreaterThan(0.4);
  });

  it('runs in < 50 ms for 3,840 blocks', () => {
    const model = r017.model;
    computeMovement(model, P); // warm-up (JIT)
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      computeMovement(model, { ...P, seed: 100 + i });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[2];
    console.info(`computeMovement 3,840 blocks: median ${median.toFixed(1)} ms (runs ${times.map((t) => t.toFixed(1)).join(', ')})`);
    expect(median).toBeLessThan(50);
  });

  it('dense blast (30,720 blocks) runs well under the API budget (< 500 ms) and keeps the invariants', () => {
    const model = generateBlockModel(getBlastConfig('b1040-031')!);
    computeMovement(model, P); // warm-up
    const times: number[] = [];
    let last: { result: MovementResult; stats: MovementStats } | undefined;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      last = computeMovementDetailed(model, P);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    console.info(`computeMovement 30,720 blocks: median ${times[1].toFixed(1)} ms`);
    expect(times[1]).toBeLessThan(500);
    const r: Run = { model, ...last! };
    const seen = new Set<string>();
    for (let n = 0; n < model.count; n++) {
      const s = slot(r, n);
      seen.add(`${s.cell}:${s.level}`);
    }
    expect(seen.size).toBe(model.count);
    expect(r.stats.converged).toBe(true);
  });
});

describe('computeMovement outputs', () => {
  it('start = model centroid, displacement = end − start, distance = |displacement|', () => {
    const { model, result } = r017;
    expect(Array.from(result.start)).toEqual(Array.from(model.centroid));
    expect(result.start).not.toBe(model.centroid); // a copy, not an alias
    for (let n = 0; n < model.count; n++) {
      const d = [0, 1, 2].map((a) => result.end[3 * n + a] - result.start[3 * n + a]);
      for (let a = 0; a < 3; a++) expect(result.displacement[3 * n + a]).toBeCloseTo(d[a], 4);
      expect(result.distance[n]).toBeCloseTo(Math.hypot(...d), 4);
    }
  });

  it('postGrid and surface share the re-grid (cell = c · swell^(1/3)) and start at the back wall', () => {
    const { model, result } = r017;
    expect(result.postGrid.cellSize).toBeCloseTo(2.5 * Math.cbrt(1.3), 10);
    expect(result.surface.cellSize).toBe(result.postGrid.cellSize);
    expect(result.surface.origin).toEqual(result.postGrid.origin);
    expect([result.surface.nx, result.surface.ny]).toEqual([result.postGrid.nx, result.postGrid.ny]);
    expect(result.surface.height.length).toBe(result.postGrid.nx * result.postGrid.ny);
    expect(result.postGrid.origin[0]).toBe(model.grid.origin[0]); // east face: grid starts at the back wall
    // nothing lands behind the back wall
    for (let n = 0; n < model.count; n++) expect(result.end[3 * n]).toBeGreaterThanOrEqual(model.grid.origin[0]);
  });

  it('echoes canonical params (2 dp) and hashes them: 3rd-decimal changes give the same result', () => {
    const a = computeMovement(r017.model, { ...P, maxThrow: 10.001 });
    expect(a.params).toEqual(canonicalParams(P));
    expect(a.paramsHash).toBe(r017.result.paramsHash);
    expect(Array.from(a.end)).toEqual(Array.from(r017.result.end));
    // same params on another blast → different hash
    expect(r022.result.paramsHash).not.toBe(r017.result.paramsHash);
  });

  it('throws a RangeError for impossible params', () => {
    expect(() => computeMovement(r017.model, { ...P, swellFactor: 0.9 })).toThrow(RangeError);
    expect(() => computeMovement(r017.model, { ...P, reposeAngleDeg: 90 })).toThrow(RangeError);
  });

  it.each([
    ['west', 0, -1],
    ['north', 1, 1],
    ['south', 1, -1],
  ] as const)('free face %s throws along the matching axis and keeps the invariants', (face, axis, sign) => {
    const r = run('b1040-017', { ...P, freeFace: face });
    let s = 0;
    for (let n = 0; n < r.model.count; n++) s += r.result.displacement[3 * n + axis];
    expect(sign * (s / r.model.count)).toBeGreaterThan(1);
    const seen = new Set<string>();
    for (let n = 0; n < r.model.count; n++) {
      const sl = slot(r, n);
      expect(sl.ix >= 0 && sl.ix < r.result.postGrid.nx && sl.iy >= 0 && sl.iy < r.result.postGrid.ny).toBe(true);
      expect(Math.abs(sl.levelF - sl.level)).toBeLessThan(1e-3);
      seen.add(`${sl.cell}:${sl.level}`);
    }
    expect(seen.size).toBe(r.model.count);
  });
});
