/**
 * Engine contracts (docs/03-engine-architecture.md §2): phased systems, one ordered registry,
 * dt-based updates, mandatory dispose, render on demand.
 *
 * CONTRACT FILE: changes need an explicit note in the PR description (see CLAUDE.md).
 */
import type * as THREE from 'three';
import type { DataSource } from '@/data';
import type { AppStore } from '@/state/store';
import type { DisposeBag } from './disposeBag';

/** Systems run in this order each frame; within a phase, in registry order (systems/index.ts). */
export type Phase = 'input' | 'simulate' | 'animate' | 'render';
export const PHASES: readonly Phase[] = ['input', 'simulate', 'animate', 'render'];

/** Upper bound for dt so a backgrounded tab doesn't teleport animations. */
export const MAX_DT = 1 / 20;

export interface FrameInfo {
  /** s since the previous frame, clamped to <= MAX_DT. ALL motion derives from dt. */
  dt: number;
  /** s since the engine started (for noise phases etc., never for motion). */
  elapsed: number;
  frame: number;
}

export interface System {
  readonly name: string;
  readonly phase: Phase;
  init?(): void | Promise<void>;
  update?(f: FrameInfo): void;
  /** Render-on-demand: the loop keeps running while any system returns true. */
  isAnimating?(): boolean;
  /** Mandatory. Release everything not already tracked in ctx.bag. */
  dispose(): void;
}

export interface EngineContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /** zustand/vanilla — the ONLY bridge to React. */
  store: AppStore;
  /** The ONLY bridge to the API. */
  data: DataSource;
  /** track(geometry | material | texture | () => void) */
  bag: DisposeBag;
  /** Request one frame. Anything that changes the image must call this. */
  invalidate(): void;
}

/**
 * One factory signature for every system. Deps are typed per system and wired in systems/index.ts.
 * (docs/03 writes the default as `{}`; `Record<never, never>` is the same type without tripping
 * @typescript-eslint/no-empty-object-type.)
 */
export type SystemFactory<D extends object = Record<never, never>> = (ctx: EngineContext, deps: D) => System;

export interface Engine {
  readonly ctx: EngineContext;
  dispose(): void;
}
