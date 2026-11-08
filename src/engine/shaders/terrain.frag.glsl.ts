/**
 * Pit terrain fragment shader: flat ground and steep bench faces get different rock tones, faces
 * get faint horizontal banding (strata), then the shared hemisphere + directional lighting.
 * Kept darker and less saturated than the blocks so the blast stays the subject.
 */
import lighting from './chunks/lighting.glsl';

const terrainFrag = /* glsl */ `
uniform vec3 uLightDir;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uFlatColor;
uniform vec3 uFaceColor;

varying vec3 vNormal;
varying vec3 vWorld;

${lighting}

void main() {
  vec3 n = normalize(vNormal);
  float steep = smoothstep(0.55, 0.85, 1.0 - n.z);
  float strata = 0.92 + 0.08 * sin(vWorld.z * 2.7 + 0.6 * sin(vWorld.x * 0.21 + vWorld.y * 0.17));
  vec3 albedo = mix(uFlatColor, uFaceColor * strata, steep);
  vec3 c = bmvHemiDirectional(albedo, n, uLightDir, uSkyColor, uGroundColor);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

export default terrainFrag;
