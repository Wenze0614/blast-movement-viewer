/**
 * animate/environment: the synthetic pit around the blast (core/terrain.ts): the floor the blast
 * sits on, the open floor in front of its free face, unblasted bench rock around its outline and
 * upper benches behind. One static indexed mesh with an owned ShaderMaterial (no scene lights).
 * Rebuilt when the model or the free face changes.
 */
import * as THREE from 'three';
import { buildPitTerrain } from '@/core/terrain';
import type { BlastParameters, BlockModel } from '@/core/types';
import terrainFrag from '../shaders/terrain.frag.glsl';
import { createTerrainUniforms } from '../shaders/terrain.uniforms';
import terrainVert from '../shaders/terrain.vert.glsl';
import type { SystemFactory } from '../types';
import { packTerrain } from './terrainGeometry';

export const createEnvironmentSystem: SystemFactory = (ctx) => {
  const { store, scene, bag } = ctx;
  const group = new THREE.Group();
  group.name = 'environment';
  scene.add(group);

  const material = bag.track(
    new THREE.ShaderMaterial({
      name: 'terrain',
      uniforms: createTerrainUniforms(),
      vertexShader: terrainVert,
      fragmentShader: terrainFrag,
    }),
  );
  let geometry: THREE.BufferGeometry | null = null;

  const clear = () => {
    group.clear();
    geometry?.dispose();
    geometry = null;
  };
  bag.track(() => {
    clear();
    scene.remove(group);
  });

  const build = (model: BlockModel | null, face: BlastParameters['freeFace']) => {
    clear();
    if (model) {
      const arrays = packTerrain(buildPitTerrain(model, face));
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(arrays.position, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(arrays.normal, 3));
      geometry.setIndex(new THREE.BufferAttribute(arrays.index, 1));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'terrain';
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    ctx.invalidate();
  };

  bag.track(
    store.subscribe(
      (s) => [s.model, s.params.freeFace] as const,
      ([model, face]) => build(model, face),
      { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] },
    ),
  );

  return {
    name: 'environment',
    phase: 'animate',
    init() {
      const s = store.getState();
      build(s.model, s.params.freeFace);
    },
    dispose() {},
  };
};
