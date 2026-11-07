/**
 * Block vertex shader (docs/02-plan.md ADR-2): per-instance GPU interpolation start → end with
 * the shared smoothstep easing, a throw arc (mine Z-up) and swell growth. Per-frame CPU work is
 * the uProgress uniform only (M4).
 */
import ease from './chunks/ease.glsl';

const blocksVert = /* glsl */ `
uniform float uProgress;
uniform float uDur;
uniform float uArc;
uniform vec3 uBlockSize;
uniform float uScaleEnd;

attribute vec3 aStart;
attribute vec3 aEnd;
attribute float aDelay;
attribute vec3 aColor;

varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vLocal;

${ease}

void main() {
  float t = bmvBlockProgress(uProgress, aDelay, uDur);
  vec3 p = bmvAnimatedCentroid(aStart, aEnd, t, uArc);
  vec3 worldPos = position * uBlockSize * mix(1.0, uScaleEnd, t) + p;

  vColor = aColor;
  vNormal = normal;   // boxes never rotate: object normal = world normal
  vLocal = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(worldPos, 1.0);
}
`;

export default blocksVert;
