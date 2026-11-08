/**
 * Conservation laws (M1, M3c, ADR-4). These are the invariants a real movement engine promises:
 * the post-blast model keeps total tonnage and metal; only position changes.
 */
import { describe, it } from 'vitest';

describe('conservation', () => {
  it.todo('M1: Σ tonnes = Σ (block volume × density) for the in-situ model');
  it.todo('M3c: Σ tonnes after movement = Σ tonnes before (exact: tonnes travel with the block)');
  it.todo('M3c: Σ tonnes × grade (metal) after movement = before');
  it.todo('ADR-4: loose volume = swellFactor × bank volume (block volume scaled by looseScale³)');
  it.todo('ADR-4: looseScale = swellFactor^(1/3) (1.3 → ≈1.091)');
});
