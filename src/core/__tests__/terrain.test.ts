/**
 * Synthetic pit terrain (core/terrain.ts). Triangle packing: engine/__tests__/terrainGeometry.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { BLAST_CONFIGS, getBlastConfig } from '../blasts';
import { generateBlockModel } from '../blockModel';
import { createFootprint, modelColumnMask } from '../footprint';
import { computeMovement } from '../movement';
import { BERM_WIDTH, buildPitTerrain, FACE_ANGLE_DEG, FLOOR_WIDTH, type PitTerrain } from '../terrain';
import type { BlockModel } from '../types';

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
