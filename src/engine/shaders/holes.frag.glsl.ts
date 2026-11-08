/** Blasthole fragment shader (P9): same hand-written lighting as the blocks, opacity uniform, section discard. */
import lighting from './chunks/lighting.glsl';

const holesFrag = /* glsl */ `
uniform float uOpacity;
uniform vec4 uSection;
uniform vec3 uLightDir;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;

varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorld;

${lighting}

void main() {
  if (dot(uSection.xyz, vWorld) < uSection.w) discard; // P3 section plane (per fragment)
  vec3 c = bmvHemiDirectional(vColor, normalize(vNormal), uLightDir, uSkyColor, uGroundColor);
  gl_FragColor = vec4(c, uOpacity);
  #include <colorspace_fragment>
}
`;

export default holesFrag;
