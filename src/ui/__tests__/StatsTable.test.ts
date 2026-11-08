/**
 * M7 — reconciliation table (docs/02-plan.md §1.2, ADR-5). Specification stubs for the UI
 * workstream (src/ui/StatsTable.tsx). Rename to .test.tsx when rendering components.
 */
import { describe, it } from 'vitest';

describe('StatsTable (M7)', () => {
  it.todo('renders three columns: In-situ / original, Post-blast / original, Post-blast / adjusted');
  it.todo('renders rows: mill t, mill grade (g/t), ore loss %, dilution %, Au to mill (oz)');
  it.todo('renders a delta row (post-blast / adjusted − post-blast / original) with signed values');
  it.todo('formats Au from grams as troy ounces (g / 31.1035)');

  describe('formula tooltips', () => {
    it.todo('ore loss % tooltip shows "ore → waste t ÷ total ore t"');
    it.todo('dilution % tooltip shows "waste → mill t ÷ mill t" and notes that site definitions vary');
    it.todo('mill grade tooltip shows "Σ t·g ÷ Σ t" (tonnage-weighted)');
    it.todo('Au to mill tooltip shows "Σ t·g ÷ 31.1035"');
    it.todo('tooltips are keyboard-reachable (focusable trigger, aria-describedby)');
  });
});
