/**
 * Pure packing of a PitTerrain heightfield into indexed triangle arrays (no GPU objects, so it is
 * unit-testable). The environment system wraps them in a BufferGeometry.
 */
import type { PitTerrain } from '@/core/terrain';

export interface TerrainArrays {
  /** 3 × vertices, m (world x, y, RL). */
  position: Float32Array;
  /** 3 × vertices, unit normals from central differences. */
  normal: Float32Array;
  /** Two counter-clockwise (seen from above) triangles per fully surveyed cell. */
  index: Uint32Array;
}

export function packTerrain(t: PitTerrain): TerrainArrays {
  const { nx, ny, spacing, height, mask } = t;
  const [ox, oy] = t.origin;
  const verts = nx * ny;
  const position = new Float32Array(3 * verts);
  const normal = new Float32Array(3 * verts);
  const h = (ix: number, iy: number) =>
    height[Math.min(nx - 1, Math.max(0, ix)) + nx * Math.min(ny - 1, Math.max(0, iy))];
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const v = ix + nx * iy;
      position[3 * v] = ox + ix * spacing;
      position[3 * v + 1] = oy + iy * spacing;
      position[3 * v + 2] = height[v];
      // n ∝ (−∂z/∂x, −∂z/∂y, 1), one-sided at the borders.
      const dx = (h(ix + 1, iy) - h(ix - 1, iy)) / (((ix < nx - 1 ? 1 : 0) + (ix > 0 ? 1 : 0)) * spacing || 1);
      const dy = (h(ix, iy + 1) - h(ix, iy - 1)) / (((iy < ny - 1 ? 1 : 0) + (iy > 0 ? 1 : 0)) * spacing || 1);
      const len = Math.hypot(dx, dy, 1);
      normal[3 * v] = -dx / len;
      normal[3 * v + 1] = -dy / len;
      normal[3 * v + 2] = 1 / len;
    }
  }
  const tris: number[] = [];
  for (let iy = 0; iy < ny - 1; iy++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const v00 = ix + nx * iy;
      const v10 = v00 + 1;
      const v01 = v00 + nx;
      const v11 = v01 + 1;
      if (!(mask[v00] && mask[v10] && mask[v01] && mask[v11])) continue;
      tris.push(v00, v10, v11, v00, v11, v01);
    }
  }
  return { position, normal, index: Uint32Array.from(tris) };
}
