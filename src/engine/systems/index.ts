/**
 * The ordered system registry (docs/03 §2). Order within a phase is this array's order; the
 * engine also stable-sorts by phase (input → simulate → animate → render).
 *
 * Not yet: picking (P2). Lighting is the hand-written chunk shared by the block and hole shaders
 * (shaders/chunks/lighting.glsl.ts + lighting.uniforms.ts), so there is no lighting system and no
 * scene lights. Holes (P9) come right after blocks (docs/03 §2).
 */
import type { EngineContext, System } from '../types';
import { createBlocksSystem } from './blocks';
import { createControlsSystem } from './controls';
import { createDigLinesSystem } from './digLines';
import { createEnvironmentSystem } from './environment';
import { createHolesSystem } from './holes';
import { createPlaybackSystem } from './playback';
import { createRenderSystem } from './render';

export function registerSystems(ctx: EngineContext): System[] {
  return [
    createControlsSystem(ctx, {}),
    createPlaybackSystem(ctx, {}),
    createBlocksSystem(ctx, {}),
    createHolesSystem(ctx, {}),
    createDigLinesSystem(ctx, {}),
    createEnvironmentSystem(ctx, {}),
    createRenderSystem(ctx, {}),
  ];
}
