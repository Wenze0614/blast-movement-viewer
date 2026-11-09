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
 * they can come from different sources and configs: an API detail over a local model after a
 * deploy, or a local detail (the detail call fell back) over an API model, or a local detail left
 * over when recovery replaces a local model with an API model. Before ANY model is stored, from
 * either source, the pipeline makes sure `store.blast` was built for it (`detailFor`):
 *   1. the current detail already matches the model → kept (no write, no hole-layer rebuild);
 *   2. the model has the bundled config's configHash → the detail is built locally from that
 *      config and the model (deterministic, so identical to what the API would serve);
 *   3. otherwise (an API model from a deploy with another config) the detail is fetched from the
 *      data source and used if it matches the model;
 *   4. last resort: the holes are re-sampled from the model with the model's own pattern
 *      (`model.pattern`, which the movement's firing sequence uses), so the layer never shows
 *      grades or timing from a model that isn't on screen.
 * "Matches" is checked, not assumed: the detail's grade breaks must equal `model.grades` (the hole
 * layer classes sampled grades with them), its drill pattern must equal `model.pattern` (the
 * firing sequence the movement uses) and `generateHoles(model, model.pattern, detail.freeFace)`
 * must reproduce `detail.holes`; a re-sampled detail takes the model's pattern. Params are never touched (no setBlast). `isCurrent()` is checked after
 * the fetch, and the detail and the model are written together only while the request is current.
 */
import type { BlastDetail, BlastHole, BlastPattern } from '@/core/api-types';
import { getBlastConfig } from '@/core/blasts';
import { blockModelConfigHash } from '@/core/blockModel';
import { buildBlastDetail, generateHoles } from '@/core/holes';
import { isMovementFor } from '@/core/movement';
import type { BlockModel, GradeSettings } from '@/core/types';
import { isAbortError, LocalDataSource, type DataSource, type DataSourceKind, type ProgressListener } from '@/data';
import { attachDerive } from './derive';
import { modelUpdate, type AppState, type AppStore, type LoadProgress } from './store';

export interface DataPipeline {
  /** Resolves when the current blast (or movement) load has settled. Useful in tests. */
  readonly settled: Promise<void>;
  dispose(): void;
}

/** Same holes (positions and sampled grades: the parts the hole layer draws)? */
function sameHoles(a: readonly BlastHole[], b: readonly BlastHole[]): boolean {
  if (a.length !== b.length) return false;
  const same3 = (p: readonly number[], q: readonly number[]) => p[0] === q[0] && p[1] === q[1] && p[2] === q[2];
  return a.every((h, i) => {
    const o = b[i];
    return h.id === o.id && h.sampledGrade === o.sampledGrade && same3(h.collar, o.collar) && same3(h.toe, o.toe);
  });
}

/** Same grade breaks (the hole layer classes sampled grades with the detail's)? */
function sameGrades(a: GradeSettings, b: GradeSettings): boolean {
  return a.cutoff === b.cutoff && a.mediumGrade === b.mediumGrade && a.highGrade === b.highGrade;
}

/** Same drill pattern, field by field? */
function samePattern(a: BlastPattern, b: BlastPattern): boolean {
  return (
    a.burden === b.burden &&
    a.spacing === b.spacing &&
    a.holeDiameterMm === b.holeDiameterMm &&
    a.subdrill === b.subdrill &&
    a.rows === b.rows &&
    a.holesPerRow === b.holesPerRow
  );
}

/**
 * Was `detail` built for `model`? Its drill pattern must be the model's (the movement's firing
 * sequence uses `model.pattern`) and its holes exactly what the model gives for that pattern.
 */
export function detailMatchesModel(detail: BlastDetail, model: BlockModel): boolean {
  return (
    detail.blockCount === model.count &&
    samePattern(detail.pattern, model.pattern) &&
    sameGrades(detail.grades, model.grades) &&
    sameHoles(detail.holes, generateHoles(model, model.pattern, detail.freeFace))
  );
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
   * The blast detail built for `model` (see "Blast detail ↔ model" above), or `null` when this
   * request was superseded while fetching. Returns the store's current detail when it already
   * matches, so the caller can skip the write.
   */
  async function detailFor(blastId: string, model: BlockModel, isCurrent: () => boolean): Promise<BlastDetail | null> {
    const current = store.getState().blast;
    if (current?.id === blastId && detailMatchesModel(current, model)) return current;
    const cfg = getBlastConfig(blastId);
    if (cfg && blockModelConfigHash(cfg) === model.configHash) return buildBlastDetail(cfg, model);
    // A model from a source with another config (the API on a newer deploy): ask for its detail.
    let fetched: BlastDetail | null = null;
    try {
      fetched = await data.getBlast(blastId);
    } catch (err) {
      if (isAbortError(err)) return null;
      console.warn('[bmv] could not fetch the blast detail for the API model; re-sampling holes locally.', err);
    }
    if (!isCurrent()) return null;
    if (fetched && fetched.id === blastId && detailMatchesModel(fetched, model)) return fetched;
    const base = fetched?.id === blastId ? fetched : current?.id === blastId ? current : cfg ? buildBlastDetail(cfg, model) : null;
    if (!base) return current;
    console.warn(`[bmv] no blast detail matches model ${model.configHash}; re-sampling holes from it.`);
    return {
      ...base,
      blockCount: model.count,
      grid: { ...model.grid, origin: [...model.grid.origin], blockSize: [...model.grid.blockSize] },
      grades: { ...model.grades },
      pattern: { ...model.pattern },
      holes: generateHoles(model, model.pattern, base.freeFace),
    };
  }

  /**
   * Store a model (from either source) together with the blast detail built for it, in one store
   * update. Returns false (and writes nothing) if the request was superseded meanwhile. The detail is written only when
   * it changed, so the hole layer doesn't rebuild for nothing. Not setBlast(): that would reset
   * params to the detail's defaults.
   */
  async function applyModel(
    blastId: string,
    model: BlockModel,
    kind: DataSourceKind,
    isCurrent: () => boolean,
  ): Promise<boolean> {
    const detail = await detailFor(blastId, model, isCurrent);
    if (!isCurrent()) return false;
    // ONE store update (setModel's own update + the detail), so no subscriber ever sees the new
    // model with the old detail or vice versa. Params are not part of it, so they are kept.
    const blast = detail && detail !== store.getState().blast ? { blast: detail } : {};
    store.setState({ ...modelUpdate(model, kind), ...blast });
    return true;
  }

  /**
   * A ProgressListener that writes `store.loadProgress` while its load is current. Throttled to
   * one store write per 50 ms within a download (the first and last bytes always land).
   */
  function progressFor(loadId: number, step: LoadProgress['step'], withModel: boolean, isCurrent: () => boolean): ProgressListener {
    let last = -Infinity;
    return (loaded, total) => {
      if (!isCurrent()) return;
      const t = now();
      const edge = loaded === 0 || (total !== null && loaded >= total);
      if (!edge && t - last < 50) return;
      last = t;
      store.getState().setLoadProgress({ loadId, step, withModel, loaded, total });
    };
  }
  /** Identities of top-level loads (the progress bar restarts its show-delay per load). */
  let loadSeq = 0;

  /**
   * `resync`: may this load reload the model once if the movement doesn't belong to it?
   * `afterModel`: part of a blast load that just fetched the model (progress shows both steps).
   * `loadId`: the blast load's identity when part of one; a parameter change starts a new load.
   */
  async function loadMovement(resync = true, afterModel = false, loadId = ++loadSeq): Promise<void> {
    const { model, blastId, params } = store.getState();
    if (!model) return;
    movementCtrl?.abort();
    const ctrl = (movementCtrl = new AbortController());
    const isCurrent = () => {
      const s = store.getState();
      return !ctrl.signal.aborted && !disposed && s.blastId === blastId && s.model === model && s.params === params;
    };
    store.getState().setStatus('loading');
    store.getState().setLoadProgress({ loadId, step: 'movement', withModel: afterModel, loaded: 0, total: null });
    const t0 = now();
    try {
      const movement = await data.getMovement(blastId, params, ctrl.signal, progressFor(loadId, 'movement', afterModel, isCurrent));
      if (!isCurrent()) return;
      if (!isMovementFor(movement, model, params)) {
        // Recovery computes or refetches: the finished download must not stay on the bar.
        store.getState().setLoadProgress({ loadId, step: 'movement', withModel: afterModel, loaded: 0, total: null });
        const detail = `movement ${movement.paramsHash} (${movement.delay.length} blocks, ${data.kind}) does not belong to model ${model.configHash} (${model.count} blocks) with the current params`;
        if (!resync) {
          console.warn(`[bmv] ${detail} again; using local compute for both model and movement.`);
          await loadLocalPair(blastId, params, ctrl, isCurrent, t0);
          return;
        }
        console.warn(`[bmv] ${detail}; reloading a consistent model + movement.`);
        const fresh = await data.getModel(blastId, ctrl.signal);
        if (!isCurrent()) return;
        if (fresh !== model && !(await applyModel(blastId, fresh, data.kind, isCurrent))) return;
        return await loadMovement(false, afterModel, loadId);
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
    // Detail + model in one update (a matched pair for every subscriber), then the movement.
    store.setState({ ...modelUpdate(model, src.kind), blast: detail });
    store.getState().setMovement(movement, src.kind, now() - t0);
  }

  async function loadBlast(id: string): Promise<void> {
    blastCtrl?.abort();
    movementCtrl?.abort();
    const ctrl = (blastCtrl = new AbortController());
    const isCurrent = () => !ctrl.signal.aborted && !disposed && store.getState().blastId === id;
    store.getState().setStatus('loading');
    const loadId = ++loadSeq;
    store.getState().setLoadProgress({ loadId, step: 'model', withModel: true, loaded: 0, total: null });
    try {
      const detail = await data.getBlast(id);
      if (!isCurrent()) return;
      store.getState().setBlast(detail);
      const model = await data.getModel(id, ctrl.signal, progressFor(loadId, 'model', true, isCurrent));
      if (!isCurrent()) return;
      if (!(await applyModel(id, model, data.kind, isCurrent))) return;
      await loadMovement(true, true, loadId); // reports its own errors, guarded by its own staleness check
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
