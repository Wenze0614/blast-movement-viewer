/**
 * Typed uniforms for the block shaders (docs/03 convention 4). Values are three.js objects so the
 * ShaderMaterial uploads them directly; the engine mutates `.value` in place.
 */
import * as THREE from 'three';
import { BLOCK_ANIMATION_DURATION } from '@/core/easing';
import { createLightingUniforms } from './lighting.uniforms';

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
  /**
   * P3 section plane (nx, ny, nz, d): a block is hidden when dot(n, animated centroid) < d.
   * (0, 0, 0, -1) = off. Written on section changes only (state/views.ts sectionPlane).
   */
  uSection: THREE.IUniform<THREE.Vector4>;
  /** P3: 1 hides blocks whose aOre is 0 (waste), 0 shows all. */
  uOreOnly: THREE.IUniform<number>;
  /**
   * P2: instance id of the selected block (compared with gl_InstanceID), −1 = none. A uniform,
   * not an aColor rewrite: selection never touches buffers or fights a colour-mode repaint.
   */
  uSelected: THREE.IUniform<number>;
  /** Linear RGB tint of the selected block. */
  uSelectColor: THREE.IUniform<THREE.Color>;
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
    uSection: { value: new THREE.Vector4(0, 0, 0, -1) },
    uOreOnly: { value: 0 },
    uSelected: { value: -1 },
    uSelectColor: { value: new THREE.Color(1, 1, 1) },
    ...createLightingUniforms(),
    uEdgeDarkening: { value: 0.4 },
  };
}
