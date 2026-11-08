/**
 * M3 — heuristic movement model `computeMovement(model, params)` (docs/02-plan.md ADR-3).
 * Specification stubs for workstream A (core/movement.ts).
 */
import { describe, it } from 'vitest';

describe('computeMovement (M3)', () => {
  it.todo('(a) no two blocks share a post-blast slot (cell index + stack level unique)');
  it.todo('(b) no floating blocks: every block rests on the floor or on the block below it in its cell');
  it.todo('(c) conserves tonnes and metal exactly (see conservation.test.ts)');
  it.todo('(d) is deterministic per seed: same model + params give byte-identical end/delay arrays');
  it.todo('(e) mean horizontal displacement is larger in the top flitch than the bottom flitch');
  it.todo('(e) mean horizontal displacement is larger in the front row than the back row');
  it.todo('preserves vertical order within each post-blast cell (sorted by original z)');
  it.todo('respects the angle of repose: neighbouring stack heights differ by <= tan(φ) · c′ after relaxation');
  it.todo('delay is in [0, 0.5] and front rows fire first');
  it.todo('runs in < 50 ms for 3,840 blocks');
});
