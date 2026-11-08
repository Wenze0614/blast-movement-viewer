/**
 * animate/blocks (ADR-2, M2/M4): ONE Mesh of InstancedBufferGeometry (unit box) with an owned
 * ShaderMaterial. GPU interpolates start → end; per-frame CPU work is the uProgress uniform.
 * Buffers are rebuilt only when (model, movement) changes; colour changes rewrite aColor once.
 */
import * as THREE from 'three';
import { GRADE_PALETTE } from '@/state/palette';
import type { AppStoreState } from '@/state/store';
import fragmentShader from '../shaders/blocks.frag.glsl';
import { createBlocksUniforms } from '../shaders/blocks.uniforms';
import vertexShader from '../shaders/blocks.vert.glsl';
import type { SystemFactory } from '../types';
import { packClassColours, packInstances, type InstancePack } from './blocksAttributes';

/** Instanced unit box with the four owned instance attributes. */
export function buildBlocksGeometry(pack: InstancePack, colours: Float32Array): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  const box = new THREE.BoxGeometry(1, 1, 1);
  geometry.setIndex(box.getIndex());
  geometry.setAttribute('position', box.getAttribute('position'));
  geometry.setAttribute('normal', box.getAttribute('normal'));
  geometry.setAttribute('aStart', new THREE.InstancedBufferAttribute(pack.start, 3));
  geometry.setAttribute('aEnd', new THREE.InstancedBufferAttribute(pack.end, 3));
  geometry.setAttribute('aDelay', new THREE.InstancedBufferAttribute(pack.delay, 1));
  geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colours, 3));
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

function coloursFor(state: Pick<AppStoreState, 'model' | 'colourMode'>, out?: Float32Array): Float32Array {
  const model = state.model;
  if (!model) return new Float32Array(0);
  // Stage 2 ships the grade palette only; outcome/movement modes (P1) fall back to grade.
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

  const rebuild = () => {
    const s = store.getState();
    const pack = s.model ? packInstances(s.model, s.movement) : EMPTY_PACK;
    const next = buildBlocksGeometry(pack, coloursFor(s));
    geometry.dispose();
    geometry = next;
    mesh.geometry = next;
    uniforms.uBlockSize.value.set(...pack.blockSize);
    uniforms.uScaleEnd.value = pack.scaleEnd;
    ctx.invalidate();
  };

  const recolour = () => {
    const attr = geometry.getAttribute('aColor') as THREE.InstancedBufferAttribute;
    if (attr.count === 0) return;
    coloursFor(store.getState(), attr.array as Float32Array);
    attr.needsUpdate = true;
    ctx.invalidate();
  };

  const unsubData = store.subscribe(
    (s) => [s.model, s.movement] as const,
    rebuild,
    { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] },
  );
  const unsubColour = store.subscribe((s) => s.colourMode, recolour);
  const unsubProgress = store.subscribe((s) => s.progress, () => ctx.invalidate());
  bag.track(unsubData);
  bag.track(unsubColour);
  bag.track(unsubProgress);

  return {
    name: 'blocks',
    phase: 'animate',
    init() {
      rebuild();
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
