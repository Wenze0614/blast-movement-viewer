import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BLAST_PARAMETERS } from '@/core/defaults';
import type { BlockModel, MovementResult } from '@/core/types';
import { createAppStore } from './store';

describe('app store', () => {
  it('starts on the default blast and parameters', () => {
    const s = createAppStore().getState();
    expect(s.blastId).toBe('b1040-017');
    expect(s.params).toEqual(DEFAULT_BLAST_PARAMETERS);
    expect(s.progress).toBe(0);
  });

  it('clamps progress to [0, 1]', () => {
    const store = createAppStore();
    store.getState().setProgress(1.4);
    expect(store.getState().progress).toBe(1);
    store.getState().setProgress(-2);
    expect(store.getState().progress).toBe(0);
  });

  it('notifies selector subscribers only when the selected slice changes (engine pattern)', () => {
    const store = createAppStore();
    const onMode = vi.fn();
    store.subscribe((s) => s.colourMode, onMode);
    store.getState().setProgress(0.5);
    expect(onMode).not.toHaveBeenCalled();
    store.getState().setColourMode('outcome');
    expect(onMode).toHaveBeenCalledWith('outcome', 'grade');
  });

  it('play() restarts from 0 when already at the end', () => {
    const store = createAppStore({ progress: 1 });
    store.getState().play();
    expect(store.getState()).toMatchObject({ playing: true, progress: 0 });
  });

  it('switching blast clears data and selection', () => {
    const store = createAppStore({ selection: 12, progress: 0.7 });
    store.getState().setBlastId('b1030-022');
    expect(store.getState()).toMatchObject({ blastId: 'b1030-022', selection: null, model: null, progress: 0 });
  });

  it('view actions: colour mode, outcome line, ore only, section (merged patch)', () => {
    const store = createAppStore();
    expect(store.getState()).toMatchObject({ colourMode: 'grade', outcomeLine: 'original', oreOnly: false });
    expect(store.getState().section).toEqual({ enabled: false, position: 0, axis: 'y' });
    store.getState().setColourMode('movement');
    store.getState().setOutcomeLine('adjusted');
    store.getState().setOreOnly(true);
    store.getState().setSection({ enabled: true, position: 31.5 });
    store.getState().setSection({ axis: 'x' });
    expect(store.getState()).toMatchObject({ colourMode: 'movement', outcomeLine: 'adjusted', oreOnly: true });
    expect(store.getState().section).toEqual({ enabled: true, position: 31.5, axis: 'x' });
  });

  it('view state survives param, model, movement and blast changes (only data is stale-cleared)', () => {
    const view = {
      colourMode: 'outcome' as const,
      outcomeLine: 'adjusted' as const,
      oreOnly: true,
      section: { enabled: true, position: 22, axis: 'y' as const },
    };
    const store = createAppStore(view);
    store.getState().setParams({ maxThrow: store.getState().params.maxThrow + 1 });
    store.getState().setModel({} as BlockModel, 'local');
    store.getState().setMovement({} as MovementResult, 'local');
    store.getState().setBlastId('b1030-022');
    expect(store.getState()).toMatchObject(view);
  });
});
