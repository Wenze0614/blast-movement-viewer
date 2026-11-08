/**
 * Collects GPU resources and teardown callbacks so systems can't leak (docs/03 convention 3).
 * Structural typing: anything with `dispose()` (geometries, materials, textures, render targets,
 * controls) or a plain cleanup function (listeners, observers).
 */
export interface Disposable {
  dispose(): void;
}

export type Trackable = Disposable | (() => void);

export interface DisposeBag {
  /** Register and return the item, so `const geo = bag.track(new BoxGeometry())` reads naturally. */
  track<T extends Trackable>(item: T): T;
  /** Dispose everything in reverse registration order. Idempotent; one failure doesn't stop the rest. */
  disposeAll(): void;
  readonly size: number;
}

export function createDisposeBag(): DisposeBag {
  let items: Trackable[] = [];

  return {
    track(item) {
      items.push(item);
      return item;
    },
    disposeAll() {
      const toDispose = items;
      items = [];
      const errors: unknown[] = [];
      for (let i = toDispose.length - 1; i >= 0; i--) {
        const item = toDispose[i];
        try {
          if (typeof item === 'function') item();
          else item.dispose();
        } catch (err) {
          errors.push(err);
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, `DisposeBag: ${errors.length} item(s) failed to dispose`);
      }
    },
    get size() {
      return items.length;
    },
  };
}
