# src/engine/systems

One file per `System` (see `../types.ts`), wired in order by `index.ts`:
controls → picking → playback → blocks → holes → digLines → environment → lighting → render.

Stage 5 ships controls → playback → blocks → holes → digLines → environment → render. Picking
(P2) comes later; lighting is a hand-written chunk shared by the block and hole shaders
(`shaders/chunks/lighting.glsl.ts`, values in `shaders/lighting.uniforms.ts`), so there are no
scene lights. Pure helpers (`blocksAttributes.ts`, `holesAttributes.ts`, `digLinesGeometry.ts`)
hold the packing maths so it is unit-testable without WebGL.
