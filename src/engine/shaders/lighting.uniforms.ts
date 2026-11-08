/**
 * Shared light values for the hand-written lighting chunk (chunks/lighting.glsl.ts). Each owned
 * material gets its own uniform objects with these values, so blocks and holes are lit the same
 * way without scene lights (stock lit materials would need them; nothing here does).
 */
import * as THREE from 'three';

export interface LightingUniforms {
  [name: string]: THREE.IUniform;
  uLightDir: THREE.IUniform<THREE.Vector3>;
  /** Linear RGB. */
  uSkyColor: THREE.IUniform<THREE.Color>;
  uGroundColor: THREE.IUniform<THREE.Color>;
}

export function createLightingUniforms(): LightingUniforms {
  return {
    // From the south-east and above, so the east (free) face and the bench top read differently.
    uLightDir: { value: new THREE.Vector3(0.45, -0.6, 0.66).normalize() },
    uSkyColor: { value: new THREE.Color('#9aa3ad') },
    uGroundColor: { value: new THREE.Color('#3a342d') },
  };
}
