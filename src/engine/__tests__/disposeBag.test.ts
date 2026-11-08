import { describe, expect, it, vi } from 'vitest';
import { createDisposeBag } from '../disposeBag';

describe('DisposeBag', () => {
  it('disposes objects and runs callbacks in reverse registration order', () => {
    const order: string[] = [];
    const bag = createDisposeBag();
    bag.track({ dispose: () => order.push('geometry') });
    bag.track(() => order.push('listener'));
    bag.track({ dispose: () => order.push('material') });

    bag.disposeAll();

    expect(order).toEqual(['material', 'listener', 'geometry']);
  });

  it('returns the tracked item', () => {
    const bag = createDisposeBag();
    const geo = { dispose: vi.fn() };
    expect(bag.track(geo)).toBe(geo);
  });

  it('is idempotent', () => {
    const bag = createDisposeBag();
    const dispose = vi.fn();
    bag.track({ dispose });
    bag.disposeAll();
    bag.disposeAll();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(bag.size).toBe(0);
  });

  it('keeps disposing after a failure, then reports every error', () => {
    const bag = createDisposeBag();
    const after = vi.fn();
    bag.track(after);
    bag.track(() => {
      throw new Error('boom');
    });
    expect(() => bag.disposeAll()).toThrow(AggregateError);
    expect(after).toHaveBeenCalledTimes(1);
  });
});
