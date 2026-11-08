/**
 * Load pipeline: blast → model → movement through the DataSource (ADR-7, ADR-9), then the derive
 * step. Discrete store changes drive it: a new `blastId` reloads everything, new `params` reload
 * the movement. Each load aborts the one it replaces (AbortSignal). A request's outcome (result OR
 * error) is applied only while that request is still current: its own controller is not aborted
 * and the inputs it captured (blastId, model, params) are still the store's. A superseded request
 * that rejects with an ordinary error is ignored, so it can never overwrite the newer request's
 * loading/ready status.
 */
import { isAbortError, type DataSource } from '@/data';
import { attachDerive } from './derive';
import type { AppStore } from './store';

export interface DataPipeline {
  /** Resolves when the current blast (or movement) load has settled. Useful in tests. */
  readonly settled: Promise<void>;
  dispose(): void;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function startDataPipeline(store: AppStore, data: DataSource): DataPipeline {
  let blastCtrl: AbortController | null = null;
  let movementCtrl: AbortController | null = null;
  let disposed = false;
  let settled: Promise<void> = Promise.resolve();
  /** Loads never reject (errors go to the store), so chaining them is safe. */
  const track = (p: Promise<void>) => {
    settled = Promise.all([settled, p]).then(() => undefined);
  };

  /** Report an error unless the request it belongs to was aborted or superseded (`isCurrent()` false). */
  const fail = (err: unknown, isCurrent: () => boolean = () => true) => {
    if (disposed || isAbortError(err) || !isCurrent()) return;
    store.getState().setStatus('error', message(err));
  };

  async function loadMovement(): Promise<void> {
    const { model, blastId, params } = store.getState();
    if (!model) return;
    movementCtrl?.abort();
    const ctrl = (movementCtrl = new AbortController());
    const isCurrent = () => {
      const s = store.getState();
      return !ctrl.signal.aborted && !disposed && s.blastId === blastId && s.model === model && s.params === params;
    };
    store.getState().setStatus('loading');
    const t0 = now();
    try {
      const movement = await data.getMovement(blastId, params, ctrl.signal);
      if (!isCurrent()) return;
      store.getState().setMovement(movement, data.kind, now() - t0);
    } catch (err) {
      fail(err, isCurrent);
    }
  }

  async function loadBlast(id: string): Promise<void> {
    blastCtrl?.abort();
    movementCtrl?.abort();
    const ctrl = (blastCtrl = new AbortController());
    const isCurrent = () => !ctrl.signal.aborted && !disposed && store.getState().blastId === id;
    store.getState().setStatus('loading');
    try {
      const detail = await data.getBlast(id);
      if (!isCurrent()) return;
      store.getState().setBlast(detail);
      const model = await data.getModel(id, ctrl.signal);
      if (!isCurrent()) return;
      store.getState().setModel(model, data.kind);
      await loadMovement(); // reports its own errors, guarded by its own staleness check
    } catch (err) {
      fail(err, isCurrent);
    }
  }

  const detachDerive = attachDerive(store);
  const unsubBlast = store.subscribe(
    (s) => s.blastId,
    (id) => {
      track(loadBlast(id));
    },
  );
  const unsubParams = store.subscribe(
    (s) => s.params,
    () => {
      track(loadMovement());
    },
  );

  data
    .listBlasts()
    .then((blasts) => {
      if (!disposed) store.getState().setBlasts(blasts);
    })
    .catch(fail);
  track(loadBlast(store.getState().blastId));

  return {
    get settled() {
      return settled;
    },
    dispose() {
      disposed = true;
      blastCtrl?.abort();
      movementCtrl?.abort();
      unsubBlast();
      unsubParams();
      detachDerive();
    },
  };
}
