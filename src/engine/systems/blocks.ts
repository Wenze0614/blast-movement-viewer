/**
 * animate/blocks (ADR-2, M2/M4): ONE Mesh of InstancedBufferGeometry (unit box) with an owned
 * ShaderMaterial. GPU interpolates start → end; per-frame CPU work is the uProgress uniform.
 * Buffers are rebuilt only when (model, movement) changes; colour changes rewrite aColor once.
 *
 * P1 colour modes: a "colour key" names everything the colours depend on for the active mode
 * (grade: model; outcome: polygons + scenario; movement: movement). aColor is rewritten only when
 * the key changes, so scrubbing never repaints except once in outcome mode as the blast starts
 * (in-situ view → post-blast view, state/views.ts). P3 section / ore-only and the P2 selection
 * highlight are uniforms.
 */
import * as THREE from 'three';
import { GRADE_PALETTE, OUTCOME_PALETTE, viridisSrgb } from '@/state/palette';
import type { AppStoreState } from '@/state/store';
import { distanceRange, outcomeClasses, outcomeScenario, sectionPlane } from '@/state/views';
import fragmentShader from '../shaders/blocks.frag.glsl';
import { createBlocksUniforms } from '../shaders/blocks.uniforms';
import vertexShader from '../shaders/blocks.vert.glsl';
import type { SystemFactory } from '../types';
import {
  packClassColours,
  packInstances,
  packOreFlags,
  packRampColours,
  rampLut,
  type InstancePack,
} from './blocksAttributes';

/**
 * Three faces of a unit box (+x, +y, +z: 12 vertices, 6 triangles). An axis-aligned box never shows
 * more than three faces to a camera, so the vertex shader turns each one toward the camera (a 180°
 * rotation, never a mirror, so the winding and back-face culling stay right): half the triangles
 * of a full box for the same image.
 */
export function cameraFacingBox(): { position: Float32Array; normal: Float32Array; index: Uint16Array } {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const pos = box.getAttribute('position').array as Float32Array;
  const nor = box.getAttribute('normal').array as Float32Array;
  const idx = box.getIndex()!.array as ArrayLike<number>;
  // BoxGeometry face order: +x, −x, +y, −y, +z, −z; 4 vertices and 6 indices each.
  const faces = [0, 2, 4];
  const position = new Float32Array(12 * 3);
  const normal = new Float32Array(12 * 3);
  const index = new Uint16Array(18);
  faces.forEach((f, q) => {
    position.set(pos.subarray(f * 12, f * 12 + 12), q * 12);
    normal.set(nor.subarray(f * 12, f * 12 + 12), q * 12);
    for (let k = 0; k < 6; k++) index[q * 6 + k] = idx[f * 6 + k] - f * 4 + q * 4;
  });
  box.dispose();
  return { position, normal, index };
}

/** Instanced camera-facing box with the five owned instance attributes. */
export function buildBlocksGeometry(
  pack: InstancePack,
  colours: Float32Array,
  ore: Float32Array = new Float32Array(pack.count),
): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  const box = cameraFacingBox();
  geometry.setIndex(new THREE.BufferAttribute(box.index, 1));
  geometry.setAttribute('position', new THREE.BufferAttribute(box.position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(box.normal, 3));
  geometry.setAttribute('aStart', new THREE.InstancedBufferAttribute(pack.start, 3));
  geometry.setAttribute('aEnd', new THREE.InstancedBufferAttribute(pack.end, 3));
  geometry.setAttribute('aDelay', new THREE.InstancedBufferAttribute(pack.delay, 1));
  geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colours, 3));
  geometry.setAttribute('aOre', new THREE.InstancedBufferAttribute(ore, 1));
  geometry.instanceCount = pack.count;
  return geometry;
}

const EMPTY_PACK: InstancePack = {
  count: 0,
  start: new Float32Array(0),
  end: new Float32Array(0),
  delay: new Float32Array(0),
  scaleEnd: 1,
  blockSize: [1, 1, 1],
};

type ColourState = Pick<AppStoreState, 'model' | 'movement' | 'polygons' | 'colourMode' | 'outcomeLine' | 'progress'>;

/**
 * Everything the block colours depend on, for the mode that is actually painted. Outcome needs the
 * dig lines and movement needs a movement; until they exist the mode falls back to grade (the
 * legend says so). Compared element by element.
 */
export function colourKey(s: ColourState): readonly unknown[] {
  if (s.colourMode === 'outcome' && s.movement && s.polygons) {
    return ['outcome', s.model, s.movement, s.polygons, outcomeScenario(true, s.progress, s.outcomeLine)];
  }
  if (s.colourMode === 'movement' && s.movement) return ['movement', s.model, s.movement];
  return ['grade', s.model];
}

const sameKey = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

let viridisLut: Float32Array | null = null;

function coloursFor(s: ColourState, out?: Float32Array): Float32Array {
  const { model, movement, polygons } = s;
  if (!model) return new Float32Array(0);
  if (s.colourMode === 'outcome' && movement && polygons) {
    const classes = outcomeClasses(model, movement, polygons, outcomeScenario(true, s.progress, s.outcomeLine));
    return packClassColours(classes, OUTCOME_PALETTE, out);
  }
  if (s.colourMode === 'movement' && movement) {
    viridisLut ??= rampLut(viridisSrgb);
    return packRampColours(movement.distance, distanceRange(movement.distance), viridisLut, out);
  }
  return packClassColours(model.oreClass, GRADE_PALETTE, out);
}

export const createBlocksSystem: SystemFactory = (ctx) => {
  const { store, scene, bag } = ctx;
  const uniforms = createBlocksUniforms();
  const material = bag.track(
    new THREE.ShaderMaterial({ name: 'blocks', vertexShader, fragmentShader, uniforms }),
  );
  let geometry = buildBlocksGeometry(EMPTY_PACK, new Float32Array(0));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'blocks';
  mesh.frustumCulled = false; // one mesh, always on screen; the box geometry's bounds are wrong anyway
  scene.add(mesh);
  bag.track(() => {
    scene.remove(mesh);
    geometry.dispose();
  });

  /** Key of the colours currently in aColor; a repaint for the same key is skipped. */
  let painted: readonly unknown[] = [];

  const rebuild = () => {
    const s = store.getState();
    const pack = s.model ? packInstances(s.model, s.movement) : EMPTY_PACK;
    const ore = s.model ? packOreFlags(s.model.grade, s.model.grades.cutoff) : new Float32Array(0);
    const next = buildBlocksGeometry(pack, coloursFor(s), ore);
    painted = colourKey(s);
    geometry.dispose();
    geometry = next;
    mesh.geometry = next;
    uniforms.uBlockSize.value.set(...pack.blockSize);
    uniforms.uScaleEnd.value = pack.scaleEnd;
    ctx.invalidate();
  };

  const recolour = () => {
    const s = store.getState();
    const key = colourKey(s);
    if (sameKey(key, painted)) return; // e.g. a rebuild for the same change already painted it
    const attr = geometry.getAttribute('aColor') as THREE.InstancedBufferAttribute;
    if (attr.count === 0) return;
    coloursFor(s, attr.array as Float32Array);
    painted = key;
    attr.needsUpdate = true;
    ctx.invalidate();
  };

  const applySection = () => {
    uniforms.uSection.value.set(...sectionPlane(store.getState().section));
    ctx.invalidate();
  };
  const applyOreOnly = () => {
    uniforms.uOreOnly.value = store.getState().oreOnly ? 1 : 0;
    ctx.invalidate();
  };
  // P2: one uniform; no buffer is touched, so selection never interacts with the colour key.
  const applySelection = () => {
    uniforms.uSelected.value = store.getState().selection ?? -1;
    ctx.invalidate();
  };

  const unsubData = store.subscribe(
    (s) => [s.model, s.movement] as const,
    rebuild,
    { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] },
  );
  // Registered after unsubData: when both fire for one change, the rebuild paints first and the
  // recolour sees the same key and skips.
  const unsubColour = store.subscribe(colourKey, recolour, { equalityFn: sameKey });
  const unsubProgress = store.subscribe((s) => s.progress, () => ctx.invalidate());
  const unsubSection = store.subscribe((s) => s.section, applySection);
  const unsubOreOnly = store.subscribe((s) => s.oreOnly, applyOreOnly);
  const unsubSelection = store.subscribe((s) => s.selection, applySelection);
  for (const unsub of [unsubData, unsubColour, unsubProgress, unsubSection, unsubOreOnly, unsubSelection]) {
    bag.track(unsub);
  }

  return {
    name: 'blocks',
    phase: 'animate',
    init() {
      rebuild();
      applySection();
      applyOreOnly();
      applySelection();
    },
    update() {
      // M4: the only per-frame CPU work for the blocks.
      uniforms.uProgress.value = store.getState().progress;
    },
    dispose() {
      // Everything (mesh, geometry, material, subscriptions) is in ctx.bag.
    },
  };
};
