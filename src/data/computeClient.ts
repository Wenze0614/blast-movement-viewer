/**
 * Where LocalDataSource runs core: inline (tests, servers, browsers without workers) or in a Web
 * Worker (the app), behind one interface. Results are identical: the same deterministic code.
 */
import type { BlastDetail } from '@/core/api-types';
import { getBlastConfig } from '@/core/blasts';
import { generateBlockModel } from '@/core/blockModel';
import { buildBlastDetail } from '@/core/holes';
import { computeMovement } from '@/core/movement';
import type { BlastParameters, BlockModel, MovementResult } from '@/core/types';
import type { ComputeReply, ComputeRequestBody } from './computeProtocol';

export interface LocalCompute {
  model(blastId: string): Promise<BlockModel>;
  detail(blastId: string): Promise<BlastDetail>;
  movement(blastId: string, params: BlastParameters): Promise<MovementResult>;
}

/** Yield to the event loop so a synchronous compute doesn't block an abort that is already queued. */
const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Runs core on the calling thread (models generated once per blast). */
export function inlineCompute(): LocalCompute {
  const models = new Map<string, BlockModel>();
  const model = (id: string) => {
    let m = models.get(id);
    if (!m) {
      const cfg = getBlastConfig(id);
      if (!cfg) throw new Error(`Unknown blast id: ${id}`);
      m = generateBlockModel(cfg);
      models.set(id, m);
    }
    return m;
  };
  return {
    async model(id) {
      await nextTick();
      return model(id);
    },
    async detail(id) {
      return buildBlastDetail(getBlastConfig(id)!, model(id));
    },
    async movement(id, params) {
      await nextTick();
      return computeMovement(model(id), params);
    },
  };
}

/**
 * Runs core in a Web Worker. Requests are answered in order; a model is generated once and kept in
 * the worker (models it posts are copies, so the main thread caches its own per blast id).
 */
export function workerCompute(worker: Worker): LocalCompute {
  let next = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const models = new Map<string, Promise<BlockModel>>();
  worker.onmessage = (e: MessageEvent<ComputeReply>) => {
    const reply = e.data;
    const p = pending.get(reply.id);
    if (!p) return;
    pending.delete(reply.id);
    if (reply.ok) p.resolve(reply.value);
    else p.reject(new Error(reply.error));
  };
  worker.onerror = (e) => {
    const err = new Error(`compute worker failed: ${e.message}`);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  const call = <T>(req: ComputeRequestBody): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ ...req, id });
    });
  return {
    model(blastId) {
      let m = models.get(blastId);
      if (!m) {
        m = call<BlockModel>({ op: 'model', blastId });
        m.catch(() => models.delete(blastId)); // a failed generation may be retried
        models.set(blastId, m);
      }
      return m;
    },
    detail: (blastId) => call<BlastDetail>({ op: 'detail', blastId }),
    movement: (blastId, params) => call<MovementResult>({ op: 'movement', blastId, params }),
  };
}

/**
 * The compute for this environment: a Web Worker where the platform has one (the browser app),
 * else inline. A worker that cannot be created (no bundler support, CSP) falls back to inline.
 */
export function defaultCompute(): LocalCompute {
  if (typeof window === 'undefined' || typeof Worker !== 'function') return inlineCompute();
  try {
    return workerCompute(new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' }));
  } catch (err) {
    console.warn('[bmv] compute worker unavailable; computing on the main thread.', err);
    return inlineCompute();
  }
}
