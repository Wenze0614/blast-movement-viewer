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
import { startDataPipeline } from '@/state/pipeline';
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

/** Records every store state in which a movement is paired with a model it doesn't belong to. */
function watchPairs(store: AppStore) {
  const violations: string[] = [];
  const unsub = store.subscribe((s) => {
    if (s.model && s.movement && !isMovementFor(s.movement, s.model, s.params)) {
      violations.push(`movement ${s.movement.paramsHash} on model ${s.model.configHash}`);
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
});
