/** Pure helper for the dig-line layer: polygon rings → line-segment pairs (no GPU objects). */
import type { GridSpec, Vec2 } from '@/core/types';

/** m above the in-situ crest; lines are drawn on top (depthTest off) so they stay readable. */
export const DIG_LINE_LIFT = 0.15;

/** Elevation for both dig lines: just above the bench crest, fixed in world space. */
export function digLineElevation(grid: GridSpec): number {
  return grid.origin[2] + grid.nz * grid.blockSize[2] + DIG_LINE_LIFT;
}

/**
 * Every ring (outer and holes) as closed segments [x0,y0,z, x1,y1,z, …], for LineSegmentsGeometry.
 * Rings are closed implicitly (DigPolygon convention), so the last point joins the first.
 */
export function ringsToSegments(polygons: readonly (readonly (readonly Vec2[])[])[], z: number): Float32Array {
  let segments = 0;
  for (const poly of polygons) for (const ring of poly) if (ring.length >= 2) segments += ring.length;
  const out = new Float32Array(segments * 6);
  let o = 0;
  for (const poly of polygons) {
    for (const ring of poly) {
      if (ring.length < 2) continue;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        out[o++] = a[0];
        out[o++] = a[1];
        out[o++] = z;
        out[o++] = b[0];
        out[o++] = b[1];
        out[o++] = z;
      }
    }
  }
  return out;
}
