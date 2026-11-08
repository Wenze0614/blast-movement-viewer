/**
 * Typed uniforms for the P9 blasthole shaders (docs/03 convention 4). The engine mutates `.value`
 * in place; per frame only `uOpacity` changes.
 */
import * as THREE from 'three';
import { HOLE_DISPLAY_RADIUS } from '../systems/holesAttributes';
import { createLightingUniforms, type LightingUniforms } from './lighting.uniforms';

export interface HolesUniforms extends LightingUniforms {
  /** 1 before the blast → 0 once the front rows have fired (holesOpacity(progress)). */
  uOpacity: THREE.IUniform<number>;
  /** m, drawn cylinder radius. */
  uRadius: THREE.IUniform<number>;
  /** P3 section plane (nx, ny, nz, d), same convention as the blocks: hidden where dot(n, p) < d. */
  uSection: THREE.IUniform<THREE.Vector4>;
}

export function createHolesUniforms(): HolesUniforms {
  return {
    uOpacity: { value: 1 },
    uRadius: { value: HOLE_DISPLAY_RADIUS },
    uSection: { value: new THREE.Vector4(0, 0, 0, -1) },
    ...createLightingUniforms(),
  };
}
