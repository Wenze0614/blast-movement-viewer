# src/engine/systems

One file per `System` (see `../types.ts`), wired in order by `index.ts`:
controls → picking → playback → blocks → holes → digLines → environment → lighting → render.

Stage 2 ships controls → playback → blocks → digLines → environment → render. Picking (P2) and
holes (P9) come later; lighting is in the block shader (`shaders/chunks/lighting.glsl.ts`).
Pure helpers (`blocksAttributes.ts`, `digLinesGeometry.ts`) hold the packing maths so it is
unit-testable without WebGL.
