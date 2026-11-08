/**
 * Plan-view polygon geometry (docs/02-plan.md ADR-5). Polygons follow DigPolygon.polygons:
 * polygons[p][0] = outer ring, [1..] = holes; rings are closed implicitly (last ≠ first).
 */
import type { Vec2 } from './types';

/** Even–odd ray cast against one ring (crossings of a ray toward +x). */
export function pointInRing(x: number, y: number, ring: readonly Vec2[]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Even–odd point-in-polygon over ALL rings of all polygons: a point inside a hole (inside two
 * rings) is outside; several outer rings (MultiPolygon) work.
 */
export function pointInPolygon(x: number, y: number, polygons: readonly (readonly (readonly Vec2[])[])[]): boolean {
  let inside = false;
  for (const poly of polygons) for (const ring of poly) if (pointInRing(x, y, ring)) inside = !inside;
  return inside;
}

/** Signed shoelace area (m²): positive for counter-clockwise rings (x east, y north). */
export function ringSignedArea(ring: readonly Vec2[]): number {
  let s = 0;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return s / 2;
}

/** Area of a MultiPolygon with holes (m²): Σ |outer| − Σ |holes|. */
export function multiPolygonArea(polygons: readonly (readonly (readonly Vec2[])[])[]): number {
  let a = 0;
  for (const poly of polygons) {
    poly.forEach((ring, r) => {
      const ra = Math.abs(ringSignedArea(ring));
      a += r === 0 ? ra : -ra;
    });
  }
  return a;
}

/** Axis-aligned bounding box [minX, minY, maxX, maxY] of all rings; null if empty. */
export function polygonBounds(
  polygons: readonly (readonly (readonly Vec2[])[])[],
): [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polygons)
    for (const ring of poly)
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
  return minX === Infinity ? null : [minX, minY, maxX, maxY];
}
