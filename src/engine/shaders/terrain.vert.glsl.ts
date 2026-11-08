/**
 * Pit terrain vertex shader: a static heightfield already in world coordinates (mine Z-up).
 */
const terrainVert = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorld;

void main() {
  vNormal = normal;   // the mesh never rotates: object normal = world normal
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export default terrainVert;
