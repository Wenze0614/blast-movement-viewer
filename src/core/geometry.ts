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

/**
 * A fast point-in-polygon test with exactly pointInPolygon's answers (same even–odd crossing rule,
 * same arithmetic per edge). Edges are bucketed into horizontal bands; a ray toward +x from (x, y)
 * can only cross edges whose y-range contains y, and all of those sit in y's band, so each query
 * looks at a handful of edges instead of every vertex of a dig line with thousands of them.
 */
export function createPolygonTester(polygons: readonly (readonly (readonly Vec2[])[])[]): (x: number, y: number) => boolean {
  const xi: number[] = [];
  const yi: number[] = [];
  const xj: number[] = [];
  const yj: number[] = [];
  for (const poly of polygons)
    for (const ring of poly) {
      const n = ring.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        xi.push(ring[i][0]);
        yi.push(ring[i][1]);
        xj.push(ring[j][0]);
        yj.push(ring[j][1]);
      }
    }
  const edges = xi.length;
  if (edges === 0) return () => false;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let e = 0; e < edges; e++) {
    y0 = Math.min(y0, yi[e], yj[e]);
    y1 = Math.max(y1, yi[e], yj[e]);
  }
  const nBands = Math.max(1, Math.min(4096, Math.ceil(Math.sqrt(edges) * 2)));
  const h = (y1 - y0) / nBands || 1;
  const bandOf = (y: number) => Math.min(nBands - 1, Math.max(0, Math.floor((y - y0) / h)));
  const bands: number[][] = Array.from({ length: nBands }, () => []);
  for (let e = 0; e < edges; e++) {
    const lo = bandOf(Math.min(yi[e], yj[e]));
    const hi = bandOf(Math.max(yi[e], yj[e]));
    for (let b = lo; b <= hi; b++) bands[b].push(e);
  }
  return (x, y) => {
    if (y < y0 || y > y1) return false;
    let inside = false;
    for (const e of bands[bandOf(y)]) {
      const a = yi[e];
      const c = yj[e];
      if (a > y !== c > y && x < ((xj[e] - xi[e]) * (y - a)) / (c - a) + xi[e]) inside = !inside;
    }
    return inside;
  };
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
