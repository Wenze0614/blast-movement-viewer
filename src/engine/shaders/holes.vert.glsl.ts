/**
 * Blasthole vertex shader (P9): a unit cylinder (radius 1, height 1, axis +Y, centred) placed per
 * instance from `aCenter` and `aAxis` (bottom → top vector). The basis is built here, so there is
 * no instanceMatrix and nothing patched.
 */
const holesVert = /* glsl */ `
attribute vec3 aCenter;
attribute vec3 aAxis;
attribute vec3 aColor;

uniform float uRadius;

varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorld;

void main() {
  float len = length(aAxis);
  vec3 d = len > 0.0 ? aAxis / len : vec3(0.0, 0.0, 1.0);
  vec3 ref = abs(d.z) < 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 u = normalize(cross(ref, d));
  vec3 w = cross(d, u);
  vec3 p = aCenter + d * (position.y * len) + (u * position.x + w * position.z) * uRadius;
  vNormal = normalize(u * normal.x + d * normal.y + w * normal.z);
  vColor = aColor;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export default holesVert;
