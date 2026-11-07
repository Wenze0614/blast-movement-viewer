/**
 * M7 — reconciliation (docs/02-plan.md ADR-5). Fixture tests against hand calculations.
 * Specification stubs for workstream A (core/geometry.ts, core/reconcile.ts).
 */
import { describe, it } from 'vitest';

describe('pointInPolygon (even–odd, ADR-5)', () => {
  it.todo('is inside a simple square and outside beyond it');
  it.todo('treats a point inside a hole ring as outside');
  it.todo('handles MultiPolygons (several outer rings)');
});

describe('reconcile (M7)', () => {
  it.todo('fixture: 4-block hand calculation gives exact mill t, mill grade, ore loss % and dilution %');
  it.todo('ore loss % = oreToWaste.t / totalOre.t × 100');
  it.todo('dilution % = wasteToMill.t / mill.t × 100');
  it.todo('mill grade is tonnage-weighted: Σ t·g / Σ t');
  it.todo('Au to mill in oz = metal grams / 31.1035');
  it.todo('oreToMill + oreToWaste = totalOre (tonnes and metal)');
  it.todo('empty polygon: mill = 0 t, ore loss = 100 %, dilution defined as 0 % (no divide-by-zero)');
  it.todo('produces three scenarios: insitu_original, post_original, post_adjusted');
  it.todo('property: across 20 seeds × 2 blasts, adjusted loss + dilution <= original');
});
