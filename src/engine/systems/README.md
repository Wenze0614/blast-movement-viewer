# src/engine/systems

One file per `System` (see `../types.ts`), wired in order by `index.ts`:
controls → picking → playback → blocks → holes → digLines → environment → lighting → render.

Shipped: controls → picking → playback → blocks → holes → digLines → environment → render.
Picking (P2) is CPU ray–AABB maths in `../picking.ts`; lighting is a hand-written chunk shared by the block and hole shaders
(`shaders/chunks/lighting.glsl.ts`, values in `shaders/lighting.uniforms.ts`), so there are no
scene lights. Pure helpers (`blocksAttributes.ts`, `holesAttributes.ts`, `digLinesGeometry.ts`)
hold the packing maths so it is unit-testable without WebGL.
