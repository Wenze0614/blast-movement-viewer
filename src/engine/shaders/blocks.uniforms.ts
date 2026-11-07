/**
 * Typed uniforms for the block shaders (docs/03 convention 4). Values are three.js objects so the
 * ShaderMaterial uploads them directly; the engine mutates `.value` in place.
 */
import * as THREE from 'three';
import { BLOCK_ANIMATION_DURATION } from '@/core/easing';

/** Throw-arc height factor: peak lift = uArc × horizontal distance (visual only). */
export const THROW_ARC = 0.18;

export interface BlocksUniforms {
  [name: string]: THREE.IUniform;
  /** 0 = in situ, 1 = settled. Written once per frame from store.getState().progress. */
  uProgress: THREE.IUniform<number>;
  /** Per-block animation duration as a fraction of the timeline (core/easing.ts). */
  uDur: THREE.IUniform<number>;
  uArc: THREE.IUniform<number>;
  /** m, the grid block size. */
  uBlockSize: THREE.IUniform<THREE.Vector3>;
  /** swell^(1/3) = MovementResult.looseScale; 1 before a movement exists. */
  uScaleEnd: THREE.IUniform<number>;
  uLightDir: THREE.IUniform<THREE.Vector3>;
  /** Linear RGB. */
  uSkyColor: THREE.IUniform<THREE.Color>;
  uGroundColor: THREE.IUniform<THREE.Color>;
  /** 0..1 */
  uEdgeDarkening: THREE.IUniform<number>;
}

export function createBlocksUniforms(): BlocksUniforms {
  return {
    uProgress: { value: 0 },
    uDur: { value: BLOCK_ANIMATION_DURATION },
    uArc: { value: THROW_ARC },
    uBlockSize: { value: new THREE.Vector3(1, 1, 1) },
    uScaleEnd: { value: 1 },
    // From the south-east and above, so the east (free) face and the bench top read differently.
    uLightDir: { value: new THREE.Vector3(0.45, -0.6, 0.66).normalize() },
    uSkyColor: { value: new THREE.Color('#9aa3ad') },
    uGroundColor: { value: new THREE.Color('#3a342d') },
    uEdgeDarkening: { value: 0.4 },
  };
}
