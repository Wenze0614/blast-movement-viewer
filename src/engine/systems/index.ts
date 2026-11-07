/**
 * The ordered system registry (docs/03 §2). Order within a phase is this array's order; the
 * engine also stable-sorts by phase (input → simulate → animate → render).
 *
 * Not in Stage 2: picking (P2), holes (P9). Lighting lives in the block shader
 * (shaders/chunks/lighting.glsl.ts), so there is no separate lighting system yet.
 */
import type { EngineContext, System } from '../types';
import { createBlocksSystem } from './blocks';
import { createControlsSystem } from './controls';
import { createDigLinesSystem } from './digLines';
import { createEnvironmentSystem } from './environment';
import { createPlaybackSystem } from './playback';
import { createRenderSystem } from './render';

export function registerSystems(ctx: EngineContext): System[] {
  return [
    createControlsSystem(ctx, {}),
    createPlaybackSystem(ctx, {}),
    createBlocksSystem(ctx, {}),
    createDigLinesSystem(ctx, {}),
    createEnvironmentSystem(ctx, {}),
    createRenderSystem(ctx, {}),
  ];
}
