/**
 * Synthetic pit terrain (core/terrain.ts). Triangle packing: engine/__tests__/terrainGeometry.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { BLAST_CONFIGS, getBlastConfig } from '../blasts';
import { generateBlockModel } from '../blockModel';
import { createFootprint, modelColumnMask } from '../footprint';
import { computeMovement, computeMovementDetailed } from '../movement';
import { BERM_WIDTH, buildPitTerrain, FACE_ANGLE_DEG, FLOOR_WIDTH, type PitTerrain } from '../terrain';
import type { BlastParameters, BlockModel } from '../types';

const cfg = getBlastConfig('b1040-017')!;
const model = generateBlockModel(cfg);
const terrain = buildPitTerrain(model, 'east');
const zToe = 1030;
const H = 10;
const crest = zToe + H;
const faceRun = H / Math.tan((FACE_ANGLE_DEG * Math.PI) / 180);

/** Height at world (x, y) by bilinear interpolation of the vertex grid. */
function heightAt(t: PitTerrain, x: number, y: number): number {
  const fx = (x - t.origin[0]) / t.spacing;
  const fy = (y - t.origin[1]) / t.spacing;
  const ix = Math.min(t.nx - 2, Math.max(0, Math.floor(fx)));
  const iy = Math.min(t.ny - 2, Math.max(0, Math.floor(fy)));
  const u = fx - ix;
  const v = fy - iy;
  const h = (i: number, j: number) => t.height[i + t.nx * j];
  return (1 - u) * (1 - v) * h(ix, iy) + u * (1 - v) * h(ix + 1, iy) + (1 - u) * v * h(ix, iy + 1) + u * v * h(ix + 1, iy + 1);
}
/** Height of the drawn surface at (x, y): the two triangles per cell packTerrain emits. */
function surfaceAt(t: PitTerrain, x: number, y: number): number {
  const fx = (x - t.origin[0]) / t.spacing;
  const fy = (y - t.origin[1]) / t.spacing;
  const ix = Math.min(t.nx - 2, Math.max(0, Math.floor(fx)));
  const iy = Math.min(t.ny - 2, Math.max(0, Math.floor(fy)));
  const u = fx - ix;
  const v = fy - iy;
  const h = (i: number, j: number) => t.height[i + t.nx * j];
  const h00 = h(ix, iy);
  const h10 = h(ix + 1, iy);
  const h01 = h(ix, iy + 1);
  const h11 = h(ix + 1, iy + 1);
  return u >= v ? h00 + u * (h10 - h00) + v * (h11 - h10) : h00 + v * (h01 - h00) + u * (h11 - h01);
}

/**
 * [min, max] of the drawn surface over a plan box. The surface is piecewise linear, so its extremes
 * lie at grid vertices inside the box or on the box boundary: both are sampled (boundary every
 * spacing/16, finer than any triangle edge crossing matters for a 1e-3 m tolerance).
 */
function surfaceRange(t: PitTerrain, x0: number, y0: number, x1: number, y1: number, perCell = 16): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  const take = (h: number) => {
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  };
  for (let iy = Math.ceil((y0 - t.origin[1]) / t.spacing); t.origin[1] + iy * t.spacing <= y1; iy++)
    for (let ix = Math.ceil((x0 - t.origin[0]) / t.spacing); t.origin[0] + ix * t.spacing <= x1; ix++)
      take(t.height[ix + t.nx * iy]);
  const step = t.spacing / perCell;
  for (let x = x0; x <= x1 + 1e-9; x += step) {
    take(surfaceAt(t, x, y0));
    take(surfaceAt(t, x, y1));
  }
  for (let y = y0; y <= y1 + 1e-9; y += step) {
    take(surfaceAt(t, x0, y));
    take(surfaceAt(t, x1, y));
  }
  return [lo, hi];
}

const vertexAt = (t: PitTerrain, x: number, y: number) =>
  Math.round((x - t.origin[0]) / t.spacing) + t.nx * Math.round((y - t.origin[1]) / t.spacing);

describe('buildPitTerrain', () => {
  it('is deterministic and aligned to the block grid (vertices on block corners)', () => {
    const again = buildPitTerrain(model, 'east');
    expect(Array.from(again.height)).toEqual(Array.from(terrain.height));
    expect(Array.from(again.mask)).toEqual(Array.from(terrain.mask));
    expect(terrain.spacing).toBe(1.25);
    for (const c of BLAST_CONFIGS) {
      const t = buildPitTerrain(generateBlockModel(c), 'east');
      const b = c.grid.blockSize[0];
      const ratio = Math.max(t.spacing / b, b / t.spacing);
      expect(ratio % 1).toBeCloseTo(0, 10); // whole vertices per block or blocks per vertex
      expect(((t.origin[0] - c.grid.origin[0]) / t.spacing) % 1).toBeCloseTo(0, 10);
      expect(((t.origin[1] - c.grid.origin[1]) / t.spacing) % 1).toBeCloseTo(0, 10);
    }
  });

  it('floor at (or just below) the toe under every block column, so the terrain never cuts into the blast', () => {
    const { nx, ny } = model.grid;
    const cols = modelColumnMask(model);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!cols[i + nx * j]) continue;
        for (const [dx, dy] of [[0, 0], [2.5, 0], [0, 2.5], [2.5, 2.5], [1.25, 1.25]]) {
          const h = terrain.height[vertexAt(terrain, i * 2.5 + dx, j * 2.5 + dy)];
          expect(h).toBeLessThanOrEqual(zToe);
          expect(h).toBeGreaterThanOrEqual(zToe - 0.15);
        }
      }
  });

  it('unblasted bench rock at the crest around the outline; open floor in front of the face', () => {
    // (2, 2) is outside b1040-017's outline, behind the face: bench rock.
    expect(terrain.height[vertexAt(terrain, 0, 0)]).toBeLessThanOrEqual(crest);
    expect(terrain.height[vertexAt(terrain, 0, 0)]).toBeGreaterThan(crest - 0.4);
    // Beside the blast (south of it, behind the face line): rock.
    expect(heightAt(terrain, 50, -10)).toBeGreaterThan(crest - 0.4);
    // In front of the face: floor.
    for (const y of [-20, 5, 30, 55, 80]) {
      expect(heightAt(terrain, 115, y)).toBeLessThanOrEqual(zToe);
      expect(heightAt(terrain, 115, y)).toBeGreaterThan(zToe - 0.2);
    }
  });

  it('steps down one bench past the open floor and up two benches behind the blast', () => {
    const drop = 100 + FLOOR_WIDTH + 8 + faceRun + 1.5; // past the wandering drop line
    expect(heightAt(terrain, drop, 30)).toBeLessThan(zToe - H + 0.2);
    expect(heightAt(terrain, 100 + FLOOR_WIDTH - 1, 30)).toBeGreaterThan(zToe - 0.2);
    // The outline's westmost vertex is x = 2, so column i = 0 (centre 1.25) is out: back edge 2.5 m.
    const fp = createFootprint(model.grid, modelColumnMask(model), 'east');
    expect(fp.backMin).toBe(2.5);
    const firstWall = fp.backMin - (BERM_WIDTH + 8 + faceRun + 1);
    expect(heightAt(terrain, firstWall, 30)).toBeGreaterThan(crest + H - 0.4);
    expect(heightAt(terrain, fp.backMin - (BERM_WIDTH - 1), 30)).toBeLessThanOrEqual(crest);
    let max = -Infinity;
    for (const h of terrain.height) max = Math.max(max, h);
    expect(max).toBeLessThanOrEqual(crest + 2 * H);
    expect(max).toBeGreaterThan(crest + 2 * H - 0.4);
  });

  it('every block of the default movement rests on floor, not inside the terrain', () => {
    for (const c of BLAST_CONFIGS) {
      const m: BlockModel = generateBlockModel(c);
      const t = buildPitTerrain(m, 'east');
      const mv = computeMovement(m, c.defaultParams);
      for (let n = 0; n < m.count; n++) {
        const h = heightAt(t, mv.end[3 * n], mv.end[3 * n + 1]);
        expect(h, `${c.id} block ${n}`).toBeLessThanOrEqual(c.grid.origin[2] + 1e-3);
      }
    }
  });

  const EXTREMES: [string, Partial<BlastParameters>][] = [
    ['defaults', {}],
    ['far, loose and flat', { maxThrow: 25, swellFactor: 1.6, reposeAngleDeg: 25, lateralFan: 5, lateralSigma: 5, randomness: 1, backRowRatio: 1, toeRatio: 1 }],
    ['no throw, no swell, steep', { maxThrow: 0, swellFactor: 1, reposeAngleDeg: 45 }],
    ['facing north', { freeFace: 'north', maxThrow: 25, swellFactor: 1.6, reposeAngleDeg: 25 }],
    ['echelon, near-lateral throw', { initiation: 'echelon-left', rowDelayMs: 5, holeDelayMs: 200, maxThrow: 25, swellFactor: 1.6, reposeAngleDeg: 25 }],
    ['V, near-lateral throw', { initiation: 'v', rowDelayMs: 5, holeDelayMs: 200, maxThrow: 25 }],
  ];

  it.each(EXTREMES)('every settled block sits on the floor over its whole swollen footprint (%s)', (_name, over) => {
    for (const c of BLAST_CONFIGS) {
      const m = generateBlockModel(c);
      const params = { ...c.defaultParams, ...over };
      const t = buildPitTerrain(m, params.freeFace);
      const mv = computeMovement(m, params);
      const half = (c.grid.blockSize[0] * mv.looseScale) / 2 - 1e-3;
      const z0 = c.grid.origin[2];
      for (let n = 0; n < m.count; n++) {
        const x = mv.end[3 * n];
        const y = mv.end[3 * n + 1];
        const [lo, hi] = surfaceRange(t, x - half, y - half, x + half, y + half);
        // No terrain pokes into the block (hi), and it is not hanging over the bench below (lo).
        expect(hi, `${c.id} block ${n} at ${x.toFixed(2)},${y.toFixed(2)}`).toBeLessThanOrEqual(z0 + 1e-3);
        expect(lo, `${c.id} block ${n} at ${x.toFixed(2)},${y.toFixed(2)}`).toBeGreaterThanOrEqual(z0 - 0.16);
        expect(t.mask[vertexAt(t, x, y)], `${c.id} block ${n} outside the survey`).toBe(1);
      }
    }
  });

  it.each(EXTREMES)('no block meets the terrain in flight: animated boxes clear it at every progress (%s)', (_name, over) => {
    for (const c of BLAST_CONFIGS) {
      const m = generateBlockModel(c);
      const params = { ...c.defaultParams, ...over };
      const t = buildPitTerrain(m, params.freeFace);
      const { result: mv, stats } = computeMovementDetailed(m, params);
      expect(stats.pathFallbacks, c.id).toBe(0);
      const [bx, by, bz] = c.grid.blockSize;
      const k = mv.looseScale;
      for (let n = 0; n < m.count; n++) {
        const o = 3 * n;
        if (mv.start[o] === mv.end[o] && mv.start[o + 1] === mv.end[o + 1]) continue;
        // Eased progress s: centre and size are linear in s (core/easing.ts). The throw arc only
        // lifts the block, so leaving it out is the stricter test.
        for (let q = 1; q < 20; q++) {
          const sv = q / 20;
          const g = 1 + (k - 1) * sv;
          const x = mv.start[o] + (mv.end[o] - mv.start[o]) * sv;
          const y = mv.start[o + 1] + (mv.end[o + 1] - mv.start[o + 1]) * sv;
          const bottom = mv.start[o + 2] + (mv.end[o + 2] - mv.start[o + 2]) * sv - (bz / 2) * g;
          const hx = (bx / 2) * g - 1e-3;
          const hy = (by / 2) * g - 1e-3;
          const [, hi] = surfaceRange(t, x - hx, y - hy, x + hx, y + hy, 4);
          if (hi > bottom + 1e-3) {
            expect.fail(`${c.id} block ${n} at s=${sv}: terrain ${hi.toFixed(2)} above box bottom ${bottom.toFixed(2)} at ${x.toFixed(2)},${y.toFixed(2)}`);
          }
        }
      }
    }
  });

  it('the surveyed area (mask) covers the blast and its muckpile; the edge is irregular', () => {
    for (const c of BLAST_CONFIGS) {
      const m = generateBlockModel(c);
      const t = buildPitTerrain(m, 'east');
      const mv = computeMovement(m, { ...c.defaultParams, maxThrow: 25 });
      for (let n = 0; n < m.count; n++) {
        expect(t.mask[vertexAt(t, mv.start[3 * n], mv.start[3 * n + 1])]).toBe(1);
        expect(t.mask[vertexAt(t, mv.end[3 * n], mv.end[3 * n + 1])]).toBe(1);
      }
      const inside = t.mask.reduce((s, v) => s + v, 0);
      expect(inside).toBeLessThan(0.85 * t.mask.length); // corners cut away
      expect(inside).toBeGreaterThan(0.5 * t.mask.length);
    }
  });

  it('follows the free face: facing north, the open floor is north of the blast', () => {
    const north = buildPitTerrain(model, 'north');
    expect(heightAt(north, 50, 75)).toBeLessThanOrEqual(zToe);
    expect(heightAt(north, 115, 30)).toBeGreaterThan(crest - 0.4); // east is now bench rock
  });
});
