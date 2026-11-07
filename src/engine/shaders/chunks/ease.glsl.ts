/**
 * Shared animation easing (docs/02-plan.md ADR-2). MUST match src/core/easing.ts
 * (smoothstep01 / blockProgress / animatedCentroid / animatedScale) so CPU picking matches the
 * image; tests/engine check the formulas side by side.
 */
const easeChunk = /* glsl */ `
float bmvBlockProgress(float progress, float delay, float dur) {
  float t = clamp((progress - delay) / dur, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

vec3 bmvAnimatedCentroid(vec3 start, vec3 end, float t, float arc) {
  vec3 p = mix(start, end, t);
  p.z += arc * 4.0 * t * (1.0 - t) * length(end.xy - start.xy);
  return p;
}
`;

export default easeChunk;
