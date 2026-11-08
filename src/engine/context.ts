/**
 * EngineContext construction (docs/03 §2). Sets the Z-up convention before any object exists.
 */
import * as THREE from 'three';
import type { DataSource } from '@/data';
import type { AppStore } from '@/state/store';
import { createDisposeBag } from './disposeBag';
import type { EngineContext } from './types';

/** Mine coordinates are Z-up (CLAUDE.md convention 1). Must run before any Object3D is created. */
export function applyZUp(): void {
  THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
}

/** The subset of WebGLRenderer the engine touches; lets tests inject a headless fake. */
export type RendererLike = Pick<
  THREE.WebGLRenderer,
  'render' | 'setAnimationLoop' | 'setPixelRatio' | 'setSize' | 'compileAsync' | 'dispose' | 'info' | 'domElement'
> &
  Partial<Pick<THREE.WebGLRenderer, 'setClearColor' | 'outputColorSpace' | 'forceContextLoss'>>;

export type RendererFactory = (canvas: HTMLCanvasElement) => RendererLike;

/** Drawing-buffer pixel ratio cap: retina sharpness without 3×-DPR fill cost. */
export const MAX_PIXEL_RATIO = 2;

/** The pixel ratio the renderer should use right now (devicePixelRatio, capped). */
export function targetPixelRatio(): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return Math.min(dpr, MAX_PIXEL_RATIO);
}

export const defaultRendererFactory: RendererFactory = (canvas) => {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(targetPixelRatio());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
};

export const VIEWPORT_COLOUR = '#20242b';

export function makeContext(
  canvas: HTMLCanvasElement,
  store: AppStore,
  data: DataSource,
  invalidate: () => void,
  createRenderer: RendererFactory = defaultRendererFactory,
): EngineContext {
  applyZUp();
  const renderer = createRenderer(canvas) as THREE.WebGLRenderer;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(VIEWPORT_COLOUR);
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.5, 5000);
  camera.up.set(0, 0, 1);
  return { renderer, scene, camera, canvas, store, data, bag: createDisposeBag(), invalidate };
}
