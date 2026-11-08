/**
 * Pit terrain triangle packing (engine/systems/terrainGeometry.ts).
 */
import { describe, expect, it } from 'vitest';
import { getBlastConfig } from '@/core/blasts';
import { generateBlockModel } from '@/core/blockModel';
import { buildPitTerrain } from '@/core/terrain';
import { packTerrain } from '../systems/terrainGeometry';

const terrain = buildPitTerrain(generateBlockModel(getBlastConfig('b1040-017')!), 'east');

describe('packTerrain', () => {
  const arrays = packTerrain(terrain);

  it('one vertex per grid point at its height; unit normals pointing up', () => {
    expect(arrays.position.length).toBe(3 * terrain.nx * terrain.ny);
    const v = 7 + terrain.nx * 11;
    expect(arrays.position[3 * v]).toBeCloseTo(terrain.origin[0] + 7 * terrain.spacing, 4);
    expect(arrays.position[3 * v + 1]).toBeCloseTo(terrain.origin[1] + 11 * terrain.spacing, 4);
    expect(arrays.position[3 * v + 2]).toBe(terrain.height[v]);
    for (let n = 0; n < arrays.normal.length / 3; n++) {
      const [x, y, z] = [arrays.normal[3 * n], arrays.normal[3 * n + 1], arrays.normal[3 * n + 2]];
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
      expect(z).toBeGreaterThan(0);
    }
  });

  it('two counter-clockwise triangles per fully surveyed cell, none touching a masked-out vertex', () => {
    const { index, position } = arrays;
    expect(index.length % 6).toBe(0);
    let cells = 0;
    for (let iy = 0; iy < terrain.ny - 1; iy++)
      for (let ix = 0; ix < terrain.nx - 1; ix++) {
        const v = ix + terrain.nx * iy;
        if (terrain.mask[v] && terrain.mask[v + 1] && terrain.mask[v + terrain.nx] && terrain.mask[v + terrain.nx + 1]) cells++;
      }
    expect(index.length).toBe(6 * cells);
    for (let t = 0; t < index.length; t += 3) {
      const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
      for (const v of [a, b, c]) expect(terrain.mask[v]).toBe(1);
      const cross =
        (position[3 * b] - position[3 * a]) * (position[3 * c + 1] - position[3 * a + 1]) -
        (position[3 * b + 1] - position[3 * a + 1]) * (position[3 * c] - position[3 * a]);
      expect(cross).toBeGreaterThan(0);
    }
  });
});
