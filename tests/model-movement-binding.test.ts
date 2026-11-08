/**
 * Regression (PR #5 cross-review): a movement must never be applied to a model it was not
 * computed for. With per-call fallback the model and the movement can come from different
 * sources: e.g. the model from local compute while the API was down, then the movement from the
 * API after it recovered on a deploy with a changed config. The pipeline must drop that movement
 * and end with a consistent model–movement pair (or an error), never a mixed one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBlastConfig, type BlastConfig } from '@/core/blasts';
import { generateBlockModel } from '@/core/blockModel';
import { buildBlastDetail, buildBlastSummary } from '@/core/holes';
import { computeMovement, isMovementFor } from '@/core/movement';
import type { BlastParameters, BlockModel } from '@/core/types';
import { FallbackDataSource, LocalDataSource, type DataSource } from '@/data';
import { detailMatchesModel, startDataPipeline } from '@/state/pipeline';
import { createAppStore, type AppStore } from '@/state/store';

const cfgA = getBlastConfig('b1040-017')!;
const modelA = generateBlockModel(cfgA);

/** A "deployed" API whose config differs from the client's bundled one (A). */
function fakeApi(cfgB: BlastConfig, opts: { movementFor?: () => BlockModel } = {}) {
  const modelB = generateBlockModel(cfgB);
  const api = {
    up: false,
    kind: 'api' as const,
    modelB,
    calls: { model: 0, movement: 0 },
    check() {
      if (!api.up) throw new TypeError('fetch failed');
    },
    async listBlasts() {
      api.check();
      return [buildBlastSummary(cfgB)];
    },
    async getBlast() {
      api.check();
      return buildBlastDetail(cfgB, modelB);
    },
    async getModel() {
      api.check();
      api.calls.model++;
      return modelB;
    },
    async getMovement(_id: string, params: BlastParameters) {
      api.check();
      api.calls.movement++;
      return computeMovement(opts.movementFor?.() ?? modelB, params);
    },
  };
  return api satisfies DataSource & Record<string, unknown>;
}

/**
 * Records every store notification in which a movement is paired with a model it doesn't belong
 * to, or the blast detail (hole layer) was not built for the stored model.
 */
function watchPairs(store: AppStore) {
  const violations: string[] = [];
  const unsub = store.subscribe((s) => {
    if (s.model && s.movement && !isMovementFor(s.movement, s.model, s.params)) {
      violations.push(`movement ${s.movement.paramsHash} on model ${s.model.configHash}`);
    }
    if (s.model && s.blast && !detailMatchesModel(s.blast, s.model)) {
      violations.push(`detail ${s.blast.id} not built for model ${s.model.configHash}`);
    }
  });
  return { violations, unsub };
}

async function startOnLocalFallback(api: ReturnType<typeof fakeApi>) {
  const store = createAppStore();
  const onFallback = vi.fn();
  const data = new FallbackDataSource(api, new LocalDataSource(), onFallback);
  const watch = watchPairs(store);
  const pipeline = startDataPipeline(store, data);
  await pipeline.settled;
  // API down at start: everything came from local compute (model A).
  expect(store.getState().source).toBe('local');
  expect(store.getState().model!.configHash).toBe(modelA.configHash);
  expect(onFallback).toHaveBeenCalled();
  return { store, pipeline, watch };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('model–movement binding across fallback + API recovery', () => {
  it('isMovementFor: binds model configHash, params and block count', () => {
    const p = cfgA.defaultParams;
    const mv = computeMovement(modelA, p);
    expect(isMovementFor(mv, modelA, p)).toBe(true);
    expect(isMovementFor(mv, modelA, { ...p, maxThrow: 11 })).toBe(false);
    expect(isMovementFor(mv, modelA, { ...p, maxThrow: 10.001 })).toBe(true); // canonical (2 dp)
    const modelB = generateBlockModel({ ...cfgA, seed: cfgA.seed + 1 });
    expect(modelB.count).toBe(modelA.count);
    expect(isMovementFor(mv, modelB, p)).toBe(false);
  });

  it('same block count: the API movement for model B is never applied to local model A; ends on a consistent B pair', async () => {
    const api = fakeApi({ ...cfgA, seed: cfgA.seed + 1 }); // changed ore body, same grid
    expect(api.modelB.configHash).not.toBe(modelA.configHash);
    const { store, pipeline, watch } = await startOnLocalFallback(api);

    api.up = true; // API recovers on the new deploy
    store.getState().setParams({ maxThrow: 12 });
    await pipeline.settled;

    const s = store.getState();
    expect(watch.violations).toEqual([]);
    expect(s.status).toBe('ready');
    expect(s.model!.configHash).toBe(api.modelB.configHash);
    expect(isMovementFor(s.movement!, s.model!, s.params)).toBe(true);
    expect(s.source).toBe('api');
    expect(api.calls.movement).toBe(2); // the mismatched one + the one for the reloaded model
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/does not belong to model/));
    expect(s.reconciliation).not.toBeNull(); // derived from the consistent pair
    // Recovery replaced the local model with the API model: the local detail went with it.
    expect(s.blast).toEqual(buildBlastDetail({ ...cfgA, seed: cfgA.seed + 1 }, api.modelB));
    expect(detailMatchesModel(s.blast!, s.model!)).toBe(true);
    watch.unsub();
    pipeline.dispose();
  });

  it('different block count: never reaches the store (geometry packing stays consistent)', async () => {
    const api = fakeApi({ ...cfgA, grid: { ...cfgA.grid, nz: 2 } });
    expect(api.modelB.count).toBe(modelA.count / 2);
    const { store, pipeline, watch } = await startOnLocalFallback(api);

    api.up = true;
    store.getState().setParams({ maxThrow: 12 });
    await pipeline.settled;

    const s = store.getState();
    expect(watch.violations).toEqual([]);
    expect(s.model!.count).toBe(api.modelB.count);
    expect(s.movement!.delay.length).toBe(s.model!.count);
    expect(s.status).toBe('ready');
    expect(s.blast!.blockCount).toBe(s.model!.count);
    expect(detailMatchesModel(s.blast!, s.model!)).toBe(true);
    watch.unsub();
    pipeline.dispose();
  });

  it('still mismatched after one reload → local compute for BOTH model and movement; badge shows Local fallback', async () => {
    // Broken backend: the model is A but every movement is computed for B.
    const modelB = generateBlockModel({ ...cfgA, seed: cfgA.seed + 7 });
    const api = fakeApi(cfgA, { movementFor: () => modelB });
    const { store, pipeline, watch } = await startOnLocalFallback(api);

    api.up = true;
    store.getState().setParams({ maxThrow: 12 });
    await pipeline.settled;

    const s = store.getState();
    expect(watch.violations).toEqual([]);
    expect(s.status).toBe('ready');
    expect(s.source).toBe('local');
    expect(s.fallback).toMatch(/different model/); // → SourceBadge "Local fallback"
    expect(s.model!.configHash).toBe(modelA.configHash);
    expect(isMovementFor(s.movement!, s.model!, s.params)).toBe(true);
    expect(s.movement!.params.maxThrow).toBe(12);
    expect(api.calls.movement).toBe(2); // one resync, no loop
    expect(s.reconciliation).not.toBeNull();
    watch.unsub();
    pipeline.dispose();
  });

  it('API recovering on the SAME config keeps the local model (identical configHash) and applies the API movement', async () => {
    const api = fakeApi(cfgA);
    const { store, pipeline, watch } = await startOnLocalFallback(api);
    const localModel = store.getState().model;

    api.up = true;
    store.getState().setParams({ maxThrow: 12 });
    await pipeline.settled;

    const s = store.getState();
    expect(watch.violations).toEqual([]);
    expect(s.model).toBe(localModel); // no reload needed
    expect(s.source).toBe('api');
    expect(api.calls).toEqual({ model: 0, movement: 1 });
    watch.unsub();
    pipeline.dispose();
  });

  it('last-resort local path: the blast detail (pattern, holes) comes from local compute too, params are kept', async () => {
    // API up from the start on a different config (B): its detail and model are B, but every
    // movement it returns belongs to yet another model (C) → resync fails → local for all three.
    const cfgB = { ...cfgA, seed: cfgA.seed + 1 };
    const modelC = generateBlockModel({ ...cfgA, seed: cfgA.seed + 9 });
    const api = fakeApi(cfgB, { movementFor: () => modelC });
    api.up = true;
    const apiDetail = await api.getBlast();
    const localDetail = await new LocalDataSource().getBlast(cfgA.id);
    expect(apiDetail.holes.map((h) => h.sampledGrade)).not.toEqual(localDetail.holes.map((h) => h.sampledGrade));

    const store = createAppStore();
    const watch = watchPairs(store);
    const pipeline = startDataPipeline(store, new FallbackDataSource(api, new LocalDataSource()));
    await pipeline.settled;
    store.getState().setParams({ maxThrow: 12 });
    await pipeline.settled;

    const s = store.getState();
    expect(watch.violations).toEqual([]);
    expect(s.status).toBe('ready');
    expect(s.source).toBe('local');
    expect(s.model!.configHash).toBe(modelA.configHash);
    expect(s.blast).toEqual(localDetail); // hole layer metadata matches the local model
    expect(s.blast!.blockCount).toBe(s.model!.count);
    expect(s.params.maxThrow).toBe(12); // not reset to the detail's defaults
    expect(s.movement!.params.maxThrow).toBe(12);
    watch.unsub();
    pipeline.dispose();
  });

  it('a superseded last-resort local load (ignores abort, resolves late with a mismatched pair) never touches the newer status', async () => {
    const modelC = generateBlockModel({ ...cfgA, seed: cfgA.seed + 9 });
    const opts: { movementFor?: () => BlockModel } = { movementFor: () => modelC };
    const api = fakeApi(cfgA, opts); // broken: movements belong to model C
    api.up = true;

    // Local source that ignores the abort signal, is held at a gate, and returns a MISMATCHED pair.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const reached = new Promise<void>((r) => (entered = r));
    const realLocal = new LocalDataSource();
    const slowLocal: DataSource = {
      kind: 'local',
      listBlasts: () => realLocal.listBlasts(),
      getBlast: (id) => realLocal.getBlast(id),
      async getModel() {
        entered();
        await gate;
        return modelA;
      },
      async getMovement(_id, params) {
        return computeMovement(modelC, params); // not modelA's
      },
    };

    const store = createAppStore();
    const watch = watchPairs(store);
    const pipeline = startDataPipeline(store, new FallbackDataSource(api, new LocalDataSource()), { local: slowLocal });
    await reached; // initial load: mismatch → resync → mismatch → held in the local path

    opts.movementFor = undefined; // API fixed: the next request gets a consistent pair
    store.getState().setParams({ maxThrow: 14 }); // supersedes (aborts) the held request
    await new Promise((r) => setTimeout(r, 20));
    let s = store.getState();
    expect(s.status).toBe('ready');
    expect(s.movement!.params.maxThrow).toBe(14);
    const newer = { status: s.status, error: s.error, movement: s.movement, model: s.model, blast: s.blast, fallback: s.fallback };

    release(); // the stale local load now resolves with its mismatched pair
    await pipeline.settled;
    s = store.getState();
    expect({ status: s.status, error: s.error, movement: s.movement, model: s.model, blast: s.blast, fallback: s.fallback }).toEqual(newer);
    expect(s.status).toBe('ready');
    expect(s.error).toBeNull();
    expect(s.source).toBe('api');
    expect(watch.violations).toEqual([]);
    watch.unsub();
    pipeline.dispose();
  });
});

describe('blast detail ↔ model source (P9 hole layer)', () => {
  /** API answers the detail (newer deploy, config B) but its model / movement fail (e.g. 409). */
  function detailOnlyApi(cfgB: BlastConfig) {
    const modelB = generateBlockModel(cfgB);
    return {
      kind: 'api' as const,
      detailB: buildBlastDetail(cfgB, modelB),
      async listBlasts() {
        return [buildBlastSummary(cfgB)];
      },
      async getBlast() {
        return buildBlastDetail(cfgB, modelB);
      },
      async getModel(): Promise<BlockModel> {
        throw new TypeError('409 STALE_VERSION');
      },
      async getMovement(): Promise<never> {
        throw new TypeError('409 STALE_VERSION');
      },
    } satisfies DataSource & Record<string, unknown>;
  }

  it('an API detail over a local model is replaced by the detail built from that model; params kept', async () => {
    const api = detailOnlyApi({ ...cfgA, seed: cfgA.seed + 1 });
    const localDetail = await new LocalDataSource().getBlast(cfgA.id);
    expect(api.detailB.holes.map((h) => h.sampledGrade)).not.toEqual(localDetail.holes.map((h) => h.sampledGrade));

    const store = createAppStore();
    const watch = watchPairs(store);
    const pipeline = startDataPipeline(store, new FallbackDataSource(api, new LocalDataSource(), () => {}));
    await pipeline.settled;
    let s = store.getState();
    expect(s.source).toBe('local');
    expect(s.model!.configHash).toBe(modelA.configHash);
    expect(s.blast).toEqual(localDetail); // holes derived from the model actually shown

    store.getState().setParams({ maxThrow: 12 });
    await pipeline.settled;
    s = store.getState();
    expect(s.blast).toEqual(localDetail);
    expect(s.params.maxThrow).toBe(12);
    expect(s.status).toBe('ready');
    expect(watch.violations).toEqual([]); // no notification saw the API detail with the local model
    watch.unsub();
    pipeline.dispose();
  });

  it('a detail that already matches the local model is not replaced (no needless hole-layer rebuild)', async () => {
    const store = createAppStore();
    const blasts: unknown[] = [];
    store.subscribe((st) => st.blast, (b) => blasts.push(b));
    const pipeline = startDataPipeline(store, new LocalDataSource());
    await pipeline.settled;
    expect(blasts).toHaveLength(1); // setBlast only
    pipeline.dispose();
  });

  /** API on a changed config (B) whose detail call fails `detailFailures` times; model + movement succeed. */
  function modelOnlyApi(cfgB: BlastConfig, detailFailures: number) {
    const api = fakeApi(cfgB);
    api.up = true;
    let failures = detailFailures;
    const getBlast = api.getBlast;
    api.getBlast = async () => {
      if (failures-- > 0) throw new TypeError('fetch failed');
      return getBlast();
    };
    return api;
  }

  it('a local detail (detail call fell back) over an API model with a changed config is replaced by the API model\'s detail', async () => {
    const cfgB = { ...cfgA, seed: cfgA.seed + 1 };
    const api = modelOnlyApi(cfgB, 1); // only the first detail call fails
    const localDetail = await new LocalDataSource().getBlast(cfgA.id);

    const store = createAppStore();
    const watch = watchPairs(store);
    const pipeline = startDataPipeline(store, new FallbackDataSource(api, new LocalDataSource(), () => {}));
    await pipeline.settled;
    let s = store.getState();
    expect(s.source).toBe('api');
    expect(s.model).toBe(api.modelB);
    expect(s.blast).not.toEqual(localDetail);
    expect(s.blast).toEqual(buildBlastDetail(cfgB, api.modelB));
    expect(detailMatchesModel(s.blast!, s.model!)).toBe(true);
    expect(s.status).toBe('ready');

    store.getState().setParams({ maxThrow: 12 });
    await pipeline.settled;
    s = store.getState();
    expect(s.blast).toEqual(buildBlastDetail(cfgB, api.modelB));
    expect(s.params.maxThrow).toBe(12); // user params kept
    expect(watch.violations).toEqual([]);
    watch.unsub();
    pipeline.dispose();
  });

  it('API model whose detail never arrives: holes are re-sampled from the API model, never left on the local one', async () => {
    const cfgB = { ...cfgA, seed: cfgA.seed + 1 };
    const api = modelOnlyApi(cfgB, Infinity);
    const store = createAppStore();
    const watch = watchPairs(store);
    const pipeline = startDataPipeline(store, new FallbackDataSource(api, new LocalDataSource(), () => {}));
    await pipeline.settled;
    const s = store.getState();
    expect(s.model).toBe(api.modelB);
    expect(detailMatchesModel(s.blast!, s.model!)).toBe(true);
    expect(s.blast!.holes).toEqual(buildBlastDetail(cfgB, api.modelB).holes); // same pattern in A and B
    expect(s.status).toBe('ready');
    expect(watch.violations).toEqual([]);
    watch.unsub();
    pipeline.dispose();
  });

  it('a request superseded while fetching the detail writes neither detail nor model', async () => {
    const cfgB = { ...cfgA, seed: cfgA.seed + 1 };
    const api = fakeApi(cfgB);
    api.up = true;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const getBlast = api.getBlast;
    api.getBlast = async () => {
      if (++calls === 1) throw new TypeError('fetch failed'); // initial detail falls back to local
      await gate; // the detail fetch for the API model is held
      return getBlast();
    };
    const store = createAppStore();
    const pipeline = startDataPipeline(store, new FallbackDataSource(api, new LocalDataSource(), () => {}));
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getState().model).toBeNull(); // not stored before its detail is resolved
    api.up = false; // the other blast loads from local compute
    store.getState().setBlastId('b1040-031'); // supersedes the held load
    release();
    await pipeline.settled;
    const s = store.getState();
    expect(s.blastId).toBe('b1040-031');
    expect(s.blast!.id).toBe('b1040-031');
    expect(s.model).not.toBe(api.modelB);
    expect(s.model!.configHash).toBe(generateBlockModel(getBlastConfig('b1040-031')!).configHash);
    expect(detailMatchesModel(s.blast!, s.model!)).toBe(true);
    expect(s.status).toBe('ready');
    pipeline.dispose();
  });
});

