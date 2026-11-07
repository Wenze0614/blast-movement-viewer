import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BLAST_PARAMETERS } from '@/core/defaults';
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
});
