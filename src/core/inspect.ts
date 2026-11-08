/**
 * P2 inspector: the logical movement view of ONE block (docs/02-plan.md §3.1 `BlockMovement`),
 * built on demand. Destinations use the same full-block rule as reconcile's `millMask` (plan
 * centroid inside the dig polygon, even–odd), so the inspector always agrees with the outcome
 * colours and the reconciliation table. O(V) for one block; never run per frame.
 */
import { pointInPolygon } from './geometry';
import type { BlockModel, BlockMovement, Destination, DigPolygon, MovementResult } from './types';

function destination(positions: Float32Array, id: number, polygon: DigPolygon): Destination {
  return pointInPolygon(positions[3 * id], positions[3 * id + 1], polygon.polygons) ? 'mill' : 'waste';
}

export function getBlockMovement(
  model: BlockModel,
  movement: MovementResult,
  polygons: { original: DigPolygon; adjusted: DigPolygon },
  id: number,
): BlockMovement {
  if (!Number.isInteger(id) || id < 0 || id >= model.count) {
    throw new RangeError(`getBlockMovement: block ${id} is outside 0..${model.count - 1}`);
  }
  if (movement.end.length !== 3 * model.count) {
    throw new Error(`getBlockMovement: movement has ${movement.end.length / 3} blocks, model has ${model.count}`);
  }
  const o = 3 * id;
  return {
    blockId: id,
    displacement: [movement.displacement[o], movement.displacement[o + 1], movement.displacement[o + 2]],
    finalPosition: [movement.end[o], movement.end[o + 1], movement.end[o + 2]],
    distance: movement.distance[id],
    preDestination: destination(model.centroid, id, polygons.original),
    postDestination: destination(movement.end, id, polygons.original),
    adjustedDestination: destination(movement.end, id, polygons.adjusted),
  };
}
