/**
 * M1 — synthetic block model (docs/02-plan.md §1.2). Specification stubs: implement in workstream A
 * (core/rng.ts, core/orebody.ts, core/blockModel.ts) and turn each `it.todo` into a real test.
 */
import { describe, it } from 'vitest';

describe('generateBlockModel (M1)', () => {
  it.todo('is deterministic: the same seed gives byte-identical typed arrays');
  it.todo('different seeds give different grade arrays');
  it.todo('default grid is 40×24×4 blocks of 2.5 m (count 3840, bench 100×60×10 m)');
  it.todo('indexes blocks as id = i + nx * (j + ny * k), centroid = origin (min corner) + (ijk + ½) · blockSize');
  it.todo('ore (grade >= cutoff 0.5 g/t) is 15–30% of total tonnes for the default blast');
  it.todo('oreClass follows grade: waste < 0.5, low 0.5–1.5, high >= 1.5 g/t');
  it.todo('every array has the right length (centroid 3N, scalars N)');
});
