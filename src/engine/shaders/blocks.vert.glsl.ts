/**
 * Block vertex shader (docs/02-plan.md ADR-2): per-instance GPU interpolation start → end with
 * the shared smoothstep easing, a throw arc (mine Z-up) and swell growth. Per-frame CPU work is
 * the uProgress uniform only (M4).
 *
 * P3: section + ore-only hide WHOLE blocks (tested on the animated centroid, so it works at any
 * scrub progress). vHidden is the same for every vertex of an instance and the fragment shader
 * discards on it: the cut face is made of the blocks' own lit faces, never hollow box interiors.
 *
 * P2: vSelected = 1 for the instance whose gl_InstanceID equals uSelected (WebGL2 / GLSL ES 3.00;
 * ids up to 2^24 are exact in a float).
 */
import ease from './chunks/ease.glsl';

const blocksVert = /* glsl */ `
uniform float uProgress;
uniform float uDur;
uniform float uArc;
uniform vec3 uBlockSize;
uniform float uScaleEnd;
uniform vec4 uSection;
uniform float uOreOnly;
uniform float uSelected;

attribute vec3 aStart;
attribute vec3 aEnd;
attribute float aDelay;
attribute vec3 aColor;
attribute float aOre;

varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vLocal;
varying float vHidden;
varying float vSelected;

${ease}

void main() {
  float t = bmvBlockProgress(uProgress, aDelay, uDur);
  vec3 p = bmvAnimatedCentroid(aStart, aEnd, t, uArc);

  // Camera-facing box (blocks.ts cameraFacingBox): the geometry holds the +x, +y and +z faces;
  // turn each toward the camera with a 180° rotation (two axes negated), never a mirror, so its
  // winding stays front-facing. The mesh has no transform, so object space is world space.
  vec3 toCam = cameraPosition - p;
  vec3 local = position;
  vec3 n = normal;
  if (n.x > 0.5) {
    if (toCam.x < 0.0) { local.xy = -local.xy; n.x = -1.0; }
  } else if (n.y > 0.5) {
    if (toCam.y < 0.0) { local.yz = -local.yz; n.y = -1.0; }
  } else if (toCam.z < 0.0) {
    local.zx = -local.zx; n.z = -1.0;
  }
  vec3 worldPos = local * uBlockSize * mix(1.0, uScaleEnd, t) + p;

  float cut = dot(uSection.xyz, p) < uSection.w ? 1.0 : 0.0;
  vHidden = max(cut, uOreOnly * (1.0 - aOre));

  vSelected = abs(float(gl_InstanceID) - uSelected) < 0.5 ? 1.0 : 0.0;
  vColor = aColor;
  vNormal = n;        // boxes never rotate: object normal = world normal
  vLocal = local;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(worldPos, 1.0);
}
`;

export default blocksVert;
