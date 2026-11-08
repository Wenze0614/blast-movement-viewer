// @vitest-environment happy-dom
/**
 * M7 — reconciliation table (docs/02-plan.md §1.2, ADR-5).
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { MaterialSummary, ReconciliationResult, ScenarioKey } from '@/core/types';
import { DELTA_LABEL, StatsTable } from '../StatsTable';

const ms = (tonnes: number, grade: number): MaterialSummary => ({ tonnes, grade, metalGrams: tonnes * grade });

function result(
  scenario: ScenarioKey,
  v: { millT: number; millG: number; loss: number; dil: number; rec: number },
): ReconciliationResult {
  return {
    scenario,
    polygonId: scenario === 'post_adjusted' ? 'adjusted' : 'original',
    totalOre: ms(1000, 2),
    mill: ms(v.millT, v.millG),
    oreToMill: ms(900, 2.1),
    wasteToMill: ms(100, 0.2),
    oreToWaste: ms(100, 1),
    oreLossPct: v.loss,
    dilutionPct: v.dil,
    metalToMillPct: 999, // must NOT be shown (the table uses oreMetalRecoveryPct)
    oreMetalRecoveryPct: v.rec,
  };
}

// Hand-calculated fixture. Au: 100,000 t × 3.11035 g/t = 311,035 g = 10,000 oz exactly.
const FIXTURE: Record<ScenarioKey, ReconciliationResult> = {
  insitu_original: result('insitu_original', { millT: 100_000, millG: 3.11035, loss: 5, dil: 8, rec: 95 }),
  post_original: result('post_original', { millT: 110_000, millG: 1.6, loss: 20.04, dil: 25.5, rec: 78.25 }),
  post_adjusted: result('post_adjusted', { millT: 105_000, millG: 1.9, loss: 8, dil: 10.25, rec: 92.5 }),
};

const row = (metric: string) => document.querySelector<HTMLTableRowElement>(`tr[data-metric="${metric}"]`)!;
const cells = (metric: string) => Array.from(row(metric).querySelectorAll('td')).map((td) => td.textContent);
const delta = (metric: string) => document.querySelector(`td[data-delta="${metric}"]`)!.textContent;

afterEach(cleanup);

describe('StatsTable (M7)', () => {
  it('renders three columns: In-situ / original, Post-blast / original, Post-blast / adjusted', () => {
    render(<StatsTable reconciliation={FIXTURE} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Metric', 'In-situ / original', 'Post-blast / original', 'Post-blast / adjusted', DELTA_LABEL]);
  });

  it('renders rows: mill t, mill grade (g/t), ore loss %, dilution %, Au to mill (oz), ore metal recovery %', () => {
    render(<StatsTable reconciliation={FIXTURE} />);
    const rowHeaders = screen.getAllByRole('rowheader').map((h) => h.querySelector('[data-label]')?.textContent);
    expect(rowHeaders).toEqual(['Mill t', 'Mill grade g/t', 'Ore loss %', 'Dilution %', 'Au to mill oz', 'Ore metal recovery %']);
    expect(cells('millTonnes').slice(0, 3)).toEqual(['100,000', '110,000', '105,000']);
    expect(cells('millGrade').slice(0, 3)).toEqual(['3.11', '1.60', '1.90']);
    expect(cells('oreLoss').slice(0, 3)).toEqual(['5.0', '20.0', '8.0']);
    expect(cells('dilution').slice(0, 3)).toEqual(['8.0', '25.5', '10.3']);
  });

  it('shows ore metal recovery (oreMetalRecoveryPct), not metal-to-mill %', () => {
    render(<StatsTable reconciliation={FIXTURE} />);
    expect(cells('oreRecovery').slice(0, 3)).toEqual(['95.0', '78.3', '92.5']);
    expect(document.body.textContent).not.toContain('999');
  });

  it('renders the delta (post-blast / adjusted − post-blast / original) with signed values', () => {
    render(<StatsTable reconciliation={FIXTURE} />);
    expect(delta('millTonnes')).toBe('−5,000');
    expect(delta('millGrade')).toBe('+0.30');
    expect(delta('oreLoss')).toBe('−12.0 pp'); // 8 − 20.04
    expect(delta('dilution')).toBe('−15.3 pp'); // 10.25 − 25.5
    expect(delta('oreRecovery')).toBe('+14.3 pp'); // 92.5 − 78.25
    // Au: (105,000 × 1.9 − 110,000 × 1.6) g ÷ 31.1035 = 23,500 g ÷ 31.1035 = 755.5 oz
    expect(delta('auToMill')).toBe('+756');
  });

  it('formats Au from grams as troy ounces (g / 31.1035)', () => {
    render(<StatsTable reconciliation={FIXTURE} />);
    // 311,035 g → 10,000 oz; 176,000 g → 5,658.5 oz; 199,500 g → 6,414.1 oz
    expect(cells('auToMill').slice(0, 3)).toEqual(['10,000', '5,659', '6,414']);
  });

  it('shows placeholders (no stale numbers) when reconciliation is cleared', () => {
    render(<StatsTable reconciliation={null} />);
    expect(cells('millTonnes')).toEqual(['–', '–', '–', '–']);
  });

  it('notes the dig-line caveats under the table', () => {
    render(<StatsTable reconciliation={FIXTURE} />);
    expect(document.body.textContent).toContain('In-situ dilution reflects dig-line smoothing');
    expect(document.body.textContent).toContain('grade-threshold contour, not an optimised dig limit');
  });

  describe('formula tooltips', () => {
    const tip = (metric: string) => {
      const button = within(row(metric)).getByRole('button');
      const id = button.getAttribute('aria-describedby')!;
      const el = document.getElementById(id)!;
      return { button, el, text: el.textContent ?? '' };
    };

    it('ore loss % tooltip shows "ore → waste t ÷ total ore t"', () => {
      render(<StatsTable reconciliation={FIXTURE} />);
      expect(tip('oreLoss').text).toContain('ore → waste t ÷ total ore t');
    });

    it('dilution % tooltip shows "waste → mill t ÷ mill t" and notes that site definitions vary', () => {
      render(<StatsTable reconciliation={FIXTURE} />);
      expect(tip('dilution').text).toContain('waste → mill t ÷ mill t');
      expect(tip('dilution').text).toMatch(/definitions vary/);
    });

    it('mill grade tooltip shows "Σ t·g ÷ Σ t" (tonnage-weighted)', () => {
      render(<StatsTable reconciliation={FIXTURE} />);
      expect(tip('millGrade').text).toContain('Σ t·g ÷ Σ t');
      expect(tip('millGrade').text).toContain('tonnage-weighted');
    });

    it('Au to mill tooltip shows "Σ t·g ÷ 31.1035"', () => {
      render(<StatsTable reconciliation={FIXTURE} />);
      expect(tip('auToMill').text).toContain('Σ t·g ÷ 31.1035');
    });

    it('ore metal recovery tooltip explains it excludes metal carried by dilution', () => {
      render(<StatsTable reconciliation={FIXTURE} />);
      expect(tip('oreRecovery').text).toContain('ore → mill Au ÷ total ore Au');
      expect(tip('oreRecovery').text).toContain('dilution');
    });

    it('tooltips are keyboard-reachable (focusable trigger, aria-describedby)', () => {
      render(<StatsTable reconciliation={FIXTURE} />);
      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(6);
      for (const metric of ['millTonnes', 'millGrade', 'oreLoss', 'dilution', 'auToMill', 'oreRecovery']) {
        const { button, el } = tip(metric);
        expect(button.tagName).toBe('BUTTON');
        expect(button.getAttribute('type')).toBe('button');
        expect(button.getAttribute('aria-label')).toMatch(/^Formula for /);
        expect(el.getAttribute('role')).toBe('tooltip');
        button.focus();
        expect(document.activeElement).toBe(button);
      }
      const ids = buttons.map((b) => b.getAttribute('aria-describedby'));
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
