/**
 * Typed uniforms for the pit terrain shaders (docs/03 convention 4). Static: nothing changes per
 * frame. Colours are muted rock tones of this project's own palette.
 */
import * as THREE from 'three';
import { createLightingUniforms, type LightingUniforms } from './lighting.uniforms';

export interface TerrainUniforms extends LightingUniforms {
  /** Linear RGB: berms, bench tops and the floor. */
  uFlatColor: THREE.IUniform<THREE.Color>;
  /** Linear RGB: steep bench faces. */
  uFaceColor: THREE.IUniform<THREE.Color>;
}

export function createTerrainUniforms(): TerrainUniforms {
  return {
    uFlatColor: { value: new THREE.Color('#7b7161') },
    uFaceColor: { value: new THREE.Color('#b3a994') },
    ...createLightingUniforms(),
  };
}
