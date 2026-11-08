/**
 * The ordered system registry (docs/03 §2). Order within a phase is this array's order; the
 * engine also stable-sorts by phase (input → simulate → animate → render).
 *
 * Picking (P2) runs right after the controls, in the input phase. Lighting is the hand-written chunk shared by the block and hole shaders
 * (shaders/chunks/lighting.glsl.ts + lighting.uniforms.ts), so there is no lighting system and no
 * scene lights. Holes (P9) come right after blocks (docs/03 §2). Perf (P6) runs after render so it
 * sees the frame's draw calls.
 */
import type { EngineContext, System } from '../types';
import { createBlocksSystem } from './blocks';
import { createControlsSystem } from './controls';
import { createDigLinesSystem } from './digLines';
import { createEnvironmentSystem } from './environment';
import { createHolesSystem } from './holes';
import { createPerfSystem } from './perf';
import { createPickingSystem } from './picking';
import { createPlaybackSystem } from './playback';
import { createRenderSystem } from './render';

export function registerSystems(ctx: EngineContext): System[] {
  return [
    createControlsSystem(ctx, {}),
    createPickingSystem(ctx, {}),
    createPlaybackSystem(ctx, {}),
    createBlocksSystem(ctx, {}),
    createHolesSystem(ctx, {}),
    createDigLinesSystem(ctx, {}),
    createEnvironmentSystem(ctx, {}),
    createRenderSystem(ctx, {}),
    createPerfSystem(ctx, {}),
  ];
}
