/**
 * Load pipeline: blast → model → movement through the DataSource (ADR-7, ADR-9), then the derive
 * step. Discrete store changes drive it: a new `blastId` reloads everything, new `params` reload
 * the movement. Each load aborts the one it replaces (AbortSignal). A request's outcome (result OR
 * error) is applied only while that request is still current: its own controller is not aborted
 * and the inputs it captured (blastId, model, params) are still the store's. A superseded request
 * that rejects with an ordinary error is ignored, so it can never overwrite the newer request's
 * loading/ready status.
 *
 * Model–movement binding: a movement is applied only if it was computed for the store's CURRENT
 * model and params (`isMovementFor`: paramsHash binds the model's configHash and the canonical
 * params; block counts must agree). The model and the movement are separate requests and, with
 * the API's per-call fallback, can come from different sources (e.g. a local model loaded while
 * the API was down, then an API movement after it recovered on a newer deploy). On a mismatch the
 * movement is dropped, the model is reloaded from the DataSource, and the movement is requested
 * again for that model. If the pair is STILL mismatched, blast detail, model and movement are all
 * loaded from local compute (always consistent) and `store.fallback` is set, so the source badge
 * reads "Local fallback". Only a mismatch inside local compute itself is reported as an error,
 * and only while that request is still current.
 *
 * Blast detail ↔ model (P9): the hole layer draws `store.blast.holes`, whose sampled grades are
 * derived from the model. The detail and the model are separate calls with per-call fallback, so
 * an API detail (no `?v=` on that route) could sit over a local model after a deploy. Whenever a
 * model from local compute is stored, the detail is rebuilt from that model and the local config
 * (`buildBlastDetail`), so the holes always come from the same source as the model.
 */
import type { BlastDetail } from '@/core/api-types';
import { getBlastConfig } from '@/core/blasts';
import { buildBlastDetail } from '@/core/holes';
import { isMovementFor } from '@/core/movement';
import type { BlockModel } from '@/core/types';
import { isAbortError, LocalDataSource, type DataSource, type DataSourceKind } from '@/data';
import { attachDerive } from './derive';
import type { AppState, AppStore } from './store';

export interface DataPipeline {
  /** Resolves when the current blast (or movement) load has settled. Useful in tests. */
  readonly settled: Promise<void>;
  dispose(): void;
}

/** Same pattern and holes (the parts the hole layer draws)? */
function sameHoles(a: BlastDetail, b: BlastDetail): boolean {
  if (a.holes.length !== b.holes.length) return false;
  const same3 = (p: readonly number[], q: readonly number[]) => p[0] === q[0] && p[1] === q[1] && p[2] === q[2];
  return a.holes.every((h, i) => {
    const o = b.holes[i];
    return h.id === o.id && h.sampledGrade === o.sampledGrade && same3(h.collar, o.collar) && same3(h.toe, o.toe);
  });
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export interface DataPipelineOptions {
  /** Last resort when the DataSource keeps returning mismatched pairs. Default: a LocalDataSource. */
  local?: DataSource;
}

export function startDataPipeline(store: AppStore, data: DataSource, options: DataPipelineOptions = {}): DataPipeline {
  let local = options.local ?? null;
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

  /**
   * Store a model and keep the blast detail on the same source: a local model gets the detail
   * built from it (only written when its holes differ, so the hole layer doesn't rebuild for
   * nothing). Not setBlast(): that would reset params to the detail's defaults.
   */
  function applyModel(blastId: string, model: BlockModel, kind: DataSourceKind): void {
    store.getState().setModel(model, kind);
    if (kind !== 'local') return;
    const cfg = getBlastConfig(blastId);
    const current = store.getState().blast;
    if (!cfg || !current || current.id !== blastId) return;
    const detail = buildBlastDetail(cfg, model);
    if (!sameHoles(current, detail)) store.setState({ blast: detail });
  }

  /** `resync`: may this load reload the model once if the movement doesn't belong to it? */
  async function loadMovement(resync = true): Promise<void> {
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
      if (!isMovementFor(movement, model, params)) {
        const detail = `movement ${movement.paramsHash} (${movement.delay.length} blocks, ${data.kind}) does not belong to model ${model.configHash} (${model.count} blocks) with the current params`;
        if (!resync) {
          console.warn(`[bmv] ${detail} again; using local compute for both model and movement.`);
          await loadLocalPair(blastId, params, ctrl, isCurrent, t0);
          return;
        }
        console.warn(`[bmv] ${detail}; reloading a consistent model + movement.`);
        const fresh = await data.getModel(blastId, ctrl.signal);
        if (!isCurrent()) return;
        if (fresh !== model) applyModel(blastId, fresh, data.kind);
        return await loadMovement(false);
      }
      store.getState().setMovement(movement, data.kind, now() - t0);
    } catch (err) {
      fail(err, isCurrent);
    }
  }

  /**
   * Blast detail + model + movement all from local compute: consistent by construction, so a hole
   * layer never draws API metadata (pattern, holes) over a local model.
   *
   * `isCurrent()` is checked right after EVERY await and before any store write, including the
   * mismatch error: a local source may ignore the abort and resolve after a param change or blast
   * switch, and a superseded request must never touch the newer request's status. (isCurrent()
   * compares the store's model with the one this load started from; the writes at the end change
   * it on purpose, which is why they come last.)
   */
  async function loadLocalPair(
    blastId: string,
    params: AppState['params'],
    ctrl: AbortController,
    isCurrent: () => boolean,
    t0: number,
  ): Promise<void> {
    const src = (local ??= new LocalDataSource());
    const model = await src.getModel(blastId, ctrl.signal);
    if (!isCurrent()) return;
    const movement = await src.getMovement(blastId, params, ctrl.signal);
    if (!isCurrent()) return;
    const detail = await src.getBlast(blastId);
    if (!isCurrent()) return;
    if (!isMovementFor(movement, model, params) || detail.id !== blastId || detail.blockCount !== model.count) {
      store.getState().setStatus('error', 'Model and movement are out of sync; reload the page.');
      return;
    }
    const s = store.getState();
    s.setFallback('The API returned a movement for a different model; computed both locally.');
    // Not setBlast(): that resets params to the detail's defaults, and the user's current params
    // are exactly what this movement was computed for. Only the detail's metadata is replaced.
    store.setState({ blast: detail });
    s.setModel(model, src.kind);
    store.getState().setMovement(movement, src.kind, now() - t0);
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
      applyModel(id, model, data.kind);
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
