/** Block fragment shader: linear-space lighting, edge darkening, output colour-space conversion. */
import lighting from './chunks/lighting.glsl';

const blocksFrag = /* glsl */ `
uniform vec3 uLightDir;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform float uEdgeDarkening;

varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vLocal;

${lighting}

void main() {
  vec3 n = normalize(vNormal);
  vec3 c = bmvHemiDirectional(vColor, n, uLightDir, uSkyColor, uGroundColor);
  c *= 1.0 - uEdgeDarkening * bmvEdgeFactor(vLocal);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

export default blocksFrag;
