/**
 * Derive step (docs/02-plan.md ADR-7): dig lines and reconciliation are computed on the client
 * from the current model + movement.
 *
 * Stale results never show with new inputs: the store's setters clear `polygons` and
 * `reconciliation` whenever the model, movement or params change, and this step only writes
 * results for the exact (model, movement) pair that is still current.
 */
import { adjustedDigPolygon, originalDigPolygon } from '@/core/digline';
import { reconcileScenarios } from '@/core/reconcile';
import type { BlockModel, MovementResult } from '@/core/types';
import type { AppState, AppStore, DigPolygons } from './store';

export interface Derived {
  polygons: DigPolygons;
  reconciliation: NonNullable<AppState['reconciliation']>;
}

/** Pure: original line from the in-situ model, adjusted line from the post-blast positions. */
export function computeDerived(model: BlockModel, movement: MovementResult): Derived {
  if (movement.end.length !== 3 * model.count) {
    throw new Error(`computeDerived: movement has ${movement.end.length / 3} blocks, model has ${model.count}`);
  }
  const polygons: DigPolygons = {
    original: originalDigPolygon(model),
    adjusted: adjustedDigPolygon(model, movement),
  };
  return { polygons, reconciliation: reconcileScenarios(model, movement, polygons) };
}

/**
 * Recompute the derived slots for the store's current inputs. Clears them when an input is
 * missing; writes only if the inputs are unchanged by the time the result is ready.
 */
export function deriveNow(store: AppStore, compute: typeof computeDerived = computeDerived): void {
  const { model, movement } = store.getState();
  if (!model || !movement) {
    if (store.getState().polygons || store.getState().reconciliation) store.getState().setDerived(null, null);
    return;
  }
  const derived = compute(model, movement);
  const now = store.getState();
  if (now.model !== model || now.movement !== movement) return;
  now.setDerived(derived.polygons, derived.reconciliation);
}

/** Keep the derived slots in step with (model, movement). Returns the unsubscribe function. */
export function attachDerive(store: AppStore, compute: typeof computeDerived = computeDerived): () => void {
  const unsubscribe = store.subscribe(
    (s) => [s.model, s.movement] as const,
    () => deriveNow(store, compute),
    { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] },
  );
  deriveNow(store, compute);
  return unsubscribe;
}
