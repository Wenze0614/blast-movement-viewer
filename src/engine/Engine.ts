/**
 * Engine (docs/03 §2): builds the context, runs the ordered, phased systems, compiles shaders
 * before reveal, then renders on demand. Dispose is idempotent and returns GPU memory to baseline.
 */
import type { DataSource } from '@/data';
import type { AppStore } from '@/state/store';
import { makeContext, type RendererFactory } from './context';
import { createLoop, orderByPhase } from './loop';
import { registerSystems } from './systems';
import type { Engine, EngineContext, System } from './types';

export interface CreateEngineOptions {
  /** Abort to cancel a pending createEngine (e.g. React unmounted first). Rejects with AbortError. */
  signal?: AbortSignal;
  /** Tests inject a headless renderer. */
  createRenderer?: RendererFactory;
  /** Tests replace the system list. Defaults to systems/index.ts. */
  systems?: (ctx: EngineContext) => System[];
}

declare global {
  interface Window {
    /** Dev-only hook: `__bmv.info()` → renderer.info.render (draw-call check, M2). */
    __bmv?: { info: () => unknown; memory: () => unknown };
  }
}

function abortError(): Error {
  return new DOMException('createEngine was cancelled.', 'AbortError');
}

export async function createEngine(
  canvas: HTMLCanvasElement,
  store: AppStore,
  data: DataSource,
  options: CreateEngineOptions = {},
): Promise<Engine> {
  const { signal } = options;
  if (signal?.aborted) throw abortError();

  let loopInvalidate = () => {};
  const ctx = makeContext(canvas, store, data, () => loopInvalidate(), options.createRenderer);
  const systems = orderByPhase((options.systems ?? registerSystems)(ctx));
  let disposed = false;
  let devHook: Window['__bmv'];

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    ctx.renderer.setAnimationLoop(null);
    store.getState().setEngineReady(false);
    const errors: unknown[] = [];
    for (const s of [...systems].reverse()) {
      try {
        s.dispose();
      } catch (err) {
        errors.push(err);
      }
    }
    try {
      ctx.bag.disposeAll();
    } catch (err) {
      errors.push(err);
    }
    ctx.scene.clear();
    ctx.renderer.dispose();
    // Only remove the hook this engine installed (a StrictMode remount may already own it).
    if (devHook && typeof window !== 'undefined' && window.__bmv === devHook) delete window.__bmv;
    if (errors.length > 0) console.error('[bmv] engine dispose errors', errors);
  };

  try {
    for (const s of systems) {
      await s.init?.();
      if (signal?.aborted) throw abortError();
    }
    await ctx.renderer.compileAsync(ctx.scene, ctx.camera);
    if (signal?.aborted) throw abortError();
  } catch (err) {
    dispose();
    throw err;
  }

  const loop = createLoop(systems);
  loopInvalidate = loop.invalidate;
  ctx.renderer.setAnimationLoop((time) => loop.step(time));
  store.getState().setEngineReady(true);

  if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
    devHook = { info: () => ({ ...ctx.renderer.info.render }), memory: () => ({ ...ctx.renderer.info.memory }) };
    window.__bmv = devHook;
  }

  return { ctx, dispose };
}
