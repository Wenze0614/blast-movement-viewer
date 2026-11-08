/**
 * Block fragment shader: linear-space lighting, edge darkening, output colour-space conversion.
 * P2: the selected block is lifted toward uSelectColor and gets bright edges instead of dark ones.
 */
import lighting from './chunks/lighting.glsl';

const blocksFrag = /* glsl */ `
uniform vec3 uLightDir;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform float uEdgeDarkening;
uniform vec3 uSelectColor;

varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vLocal;
varying float vHidden;
varying float vSelected;

${lighting}

void main() {
  if (vHidden > 0.5) discard; // P3: section plane / ore-only (decided per block in the vertex shader)
  vec3 n = normalize(vNormal);
  vec3 c = bmvHemiDirectional(vColor, n, uLightDir, uSkyColor, uGroundColor);
  float edge = bmvEdgeFactor(vLocal);
  c *= 1.0 - uEdgeDarkening * edge * (1.0 - vSelected);
  c = mix(c, uSelectColor, vSelected * (0.35 + 0.65 * edge));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

export default blocksFrag;
