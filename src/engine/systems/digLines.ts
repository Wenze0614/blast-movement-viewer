/**
 * animate/digLines (M5/M6): the original line (bright, solid) and the adjusted line (different
 * colour, dashed), each ONE LineSegments2 batching all rings. Fixed in world space at the crest,
 * drawn on top. Toggleable via store layers; hidden whenever the polygons are cleared, so a stale
 * line never shows with new inputs.
 */
import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { DIG_LINE_STYLE } from '@/state/palette';
import type { DigPolygons } from '@/state/store';
import type { SystemFactory } from '../types';
import { digLineElevation, ringsToSegments } from './digLinesGeometry';

type LineKey = 'originalLine' | 'adjustedLine';
const POLYGON_OF: Record<LineKey, keyof DigPolygons> = { originalLine: 'original', adjustedLine: 'adjusted' };

export const createDigLinesSystem: SystemFactory = (ctx) => {
  const { store, scene, bag } = ctx;
  const group = new THREE.Group();
  group.name = 'digLines';
  scene.add(group);
  bag.track(() => scene.remove(group));

  const lines = {} as Record<LineKey, { line: LineSegments2; geometry: LineSegmentsGeometry }>;
  for (const key of Object.keys(POLYGON_OF) as LineKey[]) {
    const style = DIG_LINE_STYLE[key];
    const material = bag.track(
      new LineMaterial({
        color: new THREE.Color(style.hex).getHex(),
        linewidth: 3, // CSS px
        dashed: style.dashed,
        dashSize: 2.0, // m
        gapSize: 1.25, // m
        depthTest: false,
        depthWrite: false,
      }),
    );
    const geometry = new LineSegmentsGeometry();
    const line = new LineSegments2(geometry, material);
    line.name = key;
    line.renderOrder = 10;
    line.visible = false;
    group.add(line);
    lines[key] = { line, geometry };
  }
  bag.track(() => {
    for (const entry of Object.values(lines)) entry.geometry.dispose();
  });

  const rebuild = () => {
    const { polygons, model, layers } = store.getState();
    for (const key of Object.keys(lines) as LineKey[]) {
      const entry = lines[key];
      const rings = polygons && model ? polygons[POLYGON_OF[key]].polygons : [];
      const segments = model ? ringsToSegments(rings, digLineElevation(model.grid)) : new Float32Array(0);
      entry.geometry.dispose();
      entry.geometry = new LineSegmentsGeometry();
      entry.line.geometry = entry.geometry;
      if (segments.length > 0) {
        entry.geometry.setPositions(segments);
        if (DIG_LINE_STYLE[key].dashed) entry.line.computeLineDistances();
      }
      entry.line.visible = layers[key] && segments.length > 0;
    }
    ctx.invalidate();
  };

  const applyVisibility = () => {
    const { layers } = store.getState();
    for (const key of Object.keys(lines) as LineKey[]) {
      const hasData = (lines[key].geometry.getAttribute('instanceStart')?.count ?? 0) > 0;
      lines[key].line.visible = layers[key] && hasData;
    }
    ctx.invalidate();
  };

  bag.track(
    store.subscribe(
      (s) => [s.polygons, s.model] as const,
      rebuild,
      { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] },
    ),
  );
  bag.track(store.subscribe((s) => s.layers, applyVisibility));

  return {
    name: 'digLines',
    phase: 'animate',
    init() {
      rebuild();
    },
    dispose() {},
  };
};
