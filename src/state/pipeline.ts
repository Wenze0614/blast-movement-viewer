/**
 * Load pipeline: blast → model → movement through the DataSource (ADR-7, ADR-9), then the derive
 * step. Discrete store changes drive it: a new `blastId` reloads everything, new `params` reload
 * the movement. Each load aborts the one it replaces (AbortSignal), and a result is written only
 * if the inputs it was computed for are still current.
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

  const fail = (err: unknown) => {
    if (disposed || isAbortError(err)) return;
    store.getState().setStatus('error', message(err));
  };

  async function loadMovement(): Promise<void> {
    const { model, blastId, params } = store.getState();
    if (!model) return;
    movementCtrl?.abort();
    const ctrl = (movementCtrl = new AbortController());
    store.getState().setStatus('loading');
    const t0 = now();
    try {
      const movement = await data.getMovement(blastId, params, ctrl.signal);
      const s = store.getState();
      if (ctrl.signal.aborted || disposed || s.model !== model || s.params !== params) return;
      s.setMovement(movement, data.kind, now() - t0);
    } catch (err) {
      fail(err);
    }
  }

  async function loadBlast(id: string): Promise<void> {
    blastCtrl?.abort();
    movementCtrl?.abort();
    const ctrl = (blastCtrl = new AbortController());
    store.getState().setStatus('loading');
    try {
      const detail = await data.getBlast(id);
      if (ctrl.signal.aborted || disposed || store.getState().blastId !== id) return;
      store.getState().setBlast(detail);
      const model = await data.getModel(id, ctrl.signal);
      if (ctrl.signal.aborted || disposed || store.getState().blastId !== id) return;
      store.getState().setModel(model, data.kind);
      await loadMovement();
    } catch (err) {
      fail(err);
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
