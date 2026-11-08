/**
 * Hand-written box lighting (docs/03 §1): hemisphere ambient + one directional N·L + edge
 * darkening from the unit-box local position. ~15 lines, nothing patched.
 */
const lightingChunk = /* glsl */ `
vec3 bmvHemiDirectional(vec3 albedo, vec3 n, vec3 lightDir, vec3 sky, vec3 ground) {
  vec3 hemi = mix(ground, sky, n.z * 0.5 + 0.5);
  float diffuse = max(dot(n, normalize(lightDir)), 0.0);
  return albedo * (hemi + vec3(0.75) * diffuse);
}

// local: position in the unit box ([-0.5, 0.5]^3). On a face one |component| is 0.5; the
// second largest tells how close the fragment is to an edge.
float bmvEdgeFactor(vec3 local) {
  vec3 a = abs(local) * 2.0;
  float hi = max(a.x, max(a.y, a.z));
  float lo = min(a.x, min(a.y, a.z));
  float mid = a.x + a.y + a.z - hi - lo;
  return smoothstep(0.82, 1.0, mid);
}
`;

export default lightingChunk;
