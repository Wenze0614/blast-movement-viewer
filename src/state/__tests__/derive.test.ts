/**
 * Derive step + load pipeline (ADR-7): stale derived results must never show with new inputs.
 */
import { describe, expect, it, vi } from 'vitest';
import { LocalDataSource } from '@/data';
import type { BlockModel, MovementResult } from '@/core/types';
import { attachDerive, computeDerived, deriveNow, type Derived } from '../derive';
import { startDataPipeline } from '../pipeline';
import { createAppStore, type AppStore } from '../store';

const source = new LocalDataSource();
const model = await source.getModel('b1040-017');
const movement = await source.getMovement('b1040-017', (await source.getBlast('b1040-017')).defaultParams);

function loaded(): AppStore {
  const store = createAppStore();
  store.getState().setModel(model, 'local');
  store.getState().setMovement(movement, 'local', 1);
  return store;
}

const fakeDerived = (): Derived => ({ polygons: {} as Derived['polygons'], reconciliation: {} as Derived['reconciliation'] });

describe('store setters clear stale derived slots', () => {
  it('setMovement clears polygons and reconciliation', () => {
    const store = loaded();
    store.getState().setDerived(fakeDerived().polygons, fakeDerived().reconciliation);
    store.getState().setMovement({ ...movement } as MovementResult, 'local');
    expect(store.getState()).toMatchObject({ polygons: null, reconciliation: null });
  });

  it('setModel clears movement, derived slots and selection', () => {
    const store = loaded();
    store.getState().setDerived(fakeDerived().polygons, fakeDerived().reconciliation);
    store.getState().select(7);
    store.getState().setModel({ ...model } as BlockModel, 'local');
    expect(store.getState()).toMatchObject({ movement: null, polygons: null, reconciliation: null, selection: null });
  });

  it('changed params clear movement and derived slots; identical params do not', () => {
    const store = loaded();
    const d = fakeDerived();
    store.getState().setDerived(d.polygons, d.reconciliation);
    store.getState().setParams({ maxThrow: store.getState().params.maxThrow });
    expect(store.getState().polygons).toBe(d.polygons);
    expect(store.getState().movement).toBe(movement);

    store.getState().setParams({ maxThrow: 14 });
    expect(store.getState()).toMatchObject({ movement: null, polygons: null, reconciliation: null });
    expect(store.getState().params.maxThrow).toBe(14);
  });

  it('resetParams to different defaults clears too', () => {
    const store = createAppStore({ params: { ...createAppStore().getState().params, swellFactor: 1.5 } });
    store.getState().setModel(model, 'local');
    store.getState().setMovement(movement, 'local');
    store.getState().resetParams();
    expect(store.getState().movement).toBeNull();
  });

  it('re-selecting the current blast is a no-op (keeps data)', () => {
    const store = loaded();
    store.getState().setBlastId(store.getState().blastId);
    expect(store.getState().model).toBe(model);
  });
});

describe('derive step', () => {
  it('computeDerived: original from in-situ, adjusted from post-blast, three scenarios', () => {
    const d = computeDerived(model, movement);
    expect(d.polygons.original.kind).toBe('original');
    expect(d.polygons.adjusted.kind).toBe('adjusted');
    expect(d.polygons.original.polygons.length).toBeGreaterThan(0);
    expect(Object.keys(d.reconciliation).sort()).toEqual(['insitu_original', 'post_adjusted', 'post_original']);
    expect(d.reconciliation.post_adjusted.polygonId).toBe('adjusted');
  });

  it('computeDerived rejects a movement from a different model', () => {
    const other = { ...movement, end: new Float32Array(3) };
    expect(() => computeDerived(model, other)).toThrow(/movement has 1 blocks/);
  });

  it('deriveNow does not write results whose inputs changed while computing', () => {
    const store = loaded();
    const compute = vi.fn(() => {
      store.getState().setParams({ maxThrow: 3 }); // inputs change mid-compute
      return fakeDerived();
    });
    deriveNow(store, compute);
    expect(compute).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({ polygons: null, reconciliation: null, movement: null });
  });

  it('attachDerive refills after every (model, movement) change and clears when an input is missing', () => {
    const store = createAppStore();
    const compute = vi.fn(fakeDerived);
    const detach = attachDerive(store, compute);
    expect(compute).not.toHaveBeenCalled();

    store.getState().setModel(model, 'local');
    expect(compute).not.toHaveBeenCalled();
    store.getState().setMovement(movement, 'local');
    expect(compute).toHaveBeenCalledTimes(1);
    const first = store.getState().reconciliation;
    expect(first).not.toBeNull();

    store.getState().setMovement({ ...movement }, 'local');
    expect(compute).toHaveBeenCalledTimes(2);
    expect(store.getState().reconciliation).not.toBe(first);

    store.getState().setParams({ maxThrow: 2 });
    expect(store.getState()).toMatchObject({ movement: null, polygons: null, reconciliation: null });
    expect(compute).toHaveBeenCalledTimes(2);

    detach();
    store.getState().setMovement(movement, 'local');
    expect(compute).toHaveBeenCalledTimes(2);
  });
});

describe('data pipeline (blast → model → movement → derived)', () => {
  it('loads the default blast end to end through the DataSource', async () => {
    const store = createAppStore();
    const pipeline = startDataPipeline(store, new LocalDataSource());
    await pipeline.settled;
    const s = store.getState();
    expect(s.blast?.id).toBe('b1040-017');
    expect(s.model?.count).toBe(3840);
    expect(s.movement?.start.length).toBe(3 * 3840);
    expect(s.polygons?.adjusted.kind).toBe('adjusted');
    expect(s.reconciliation?.post_original.scenario).toBe('post_original');
    expect(s).toMatchObject({ status: 'ready', source: 'local', error: null });
    expect(s.blasts.map((b) => b.id)).toContain('b1030-022');
    pipeline.dispose();
  });

  it('new params reload the movement; nothing stale is visible in between', async () => {
    const store = createAppStore();
    const pipeline = startDataPipeline(store, new LocalDataSource());
    await pipeline.settled;
    const before = store.getState().movement;
    store.getState().setParams({ maxThrow: 15 });
    expect(store.getState()).toMatchObject({ movement: null, polygons: null, reconciliation: null, status: 'loading' });
    await pipeline.settled;
    const after = store.getState();
    expect(after.movement).not.toBe(before);
    expect(after.movement?.params.maxThrow).toBe(15);
    expect(after.reconciliation).not.toBeNull();
    pipeline.dispose();
  });

  it('switching blast aborts the previous load and ends on the new blast', async () => {
    const data = new LocalDataSource();
    const getMovement = vi.spyOn(data, 'getMovement');
    const store = createAppStore();
    const pipeline = startDataPipeline(store, data);
    store.getState().setBlastId('b1030-022');
    await pipeline.settled;
    const s = store.getState();
    expect(s.blast?.id).toBe('b1030-022');
    expect(s.model?.grid.origin[2]).toBe(1020);
    expect(s.movement?.start.length).toBe(3 * s.model!.count);
    const signals = getMovement.mock.calls.map((c) => c[2]);
    expect(signals.every((sig) => sig === undefined || sig instanceof AbortSignal)).toBe(true);
    pipeline.dispose();
  });

  it('reports DataSource errors in the store (aborts are not errors)', async () => {
    const data = new LocalDataSource();
    vi.spyOn(data, 'getModel').mockRejectedValue(new Error('boom'));
    const store = createAppStore();
    const pipeline = startDataPipeline(store, data);
    await pipeline.settled;
    expect(store.getState()).toMatchObject({ status: 'error', error: 'boom' });
    pipeline.dispose();
  });

  it('dispose aborts in-flight loads and stops reacting to the store', async () => {
    const data = new LocalDataSource();
    const store = createAppStore();
    const pipeline = startDataPipeline(store, data);
    pipeline.dispose();
    await pipeline.settled;
    expect(store.getState().movement).toBeNull();
    expect(store.getState().status).not.toBe('error');
  });
});

describe('LocalDataSource', () => {
  it('rejects with AbortError when the signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(source.getModel('b1040-017', ctrl.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects unknown blast ids', async () => {
    await expect(source.getBlast('nope')).rejects.toThrow(/Unknown blast id/);
  });
});
