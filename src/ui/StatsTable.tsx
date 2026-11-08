'use client';
/**
 * M7 reconciliation table (docs/02-plan.md §1.2, ADR-5). Three scenario columns plus the delta
 * (post-blast / adjusted − post-blast / original) for every metric; formula tooltips that work
 * with keyboard and screen readers.
 */
import { useId } from 'react';
import type { ReconciliationResult, ScenarioKey } from '@/core/types';
import { useAppStore } from '@/state/hooks';
import { fmt, fmtSigned, gramsToOz } from './format';

export const SCENARIO_COLUMNS: readonly { key: ScenarioKey; label: string }[] = [
  { key: 'insitu_original', label: 'In-situ / original' },
  { key: 'post_original', label: 'Post-blast / original' },
  { key: 'post_adjusted', label: 'Post-blast / adjusted' },
];

export const DELTA_LABEL = 'Δ adjusted − original';

export interface Metric {
  key: string;
  label: string;
  unit: string;
  formula: string;
  value: (r: ReconciliationResult) => number;
  digits: number;
  /** Unit of the delta (percentages differ in percentage points). */
  deltaUnit: string;
}

export const METRICS: readonly Metric[] = [
  {
    key: 'millTonnes',
    label: 'Mill',
    unit: 't',
    formula: 'Σ t of blocks whose plan centroid is inside the dig line (full-block rule)',
    value: (r) => r.mill.tonnes,
    digits: 0,
    deltaUnit: 't',
  },
  {
    key: 'millGrade',
    label: 'Mill grade',
    unit: 'g/t',
    formula: 'Σ t·g ÷ Σ t over mill blocks (tonnage-weighted)',
    value: (r) => r.mill.grade,
    digits: 2,
    deltaUnit: 'g/t',
  },
  {
    key: 'oreLoss',
    label: 'Ore loss',
    unit: '%',
    formula: 'ore → waste t ÷ total ore t × 100 (ore = grade ≥ cut-off)',
    value: (r) => r.oreLossPct,
    digits: 1,
    deltaUnit: 'pp',
  },
  {
    key: 'dilution',
    label: 'Dilution',
    unit: '%',
    formula: 'waste → mill t ÷ mill t × 100. Site definitions vary (some divide by ore t).',
    value: (r) => r.dilutionPct,
    digits: 1,
    deltaUnit: 'pp',
  },
  {
    key: 'auToMill',
    label: 'Au to mill',
    unit: 'oz',
    formula: 'Σ t·g ÷ 31.1035 over mill blocks (grams → troy oz)',
    value: (r) => gramsToOz(r.mill.metalGrams),
    digits: 0,
    deltaUnit: 'oz',
  },
  {
    key: 'oreRecovery',
    label: 'Ore metal recovery',
    unit: '%',
    formula: 'ore → mill Au ÷ total ore Au × 100 (excludes Au carried in by dilution)',
    value: (r) => r.oreMetalRecoveryPct,
    digits: 1,
    deltaUnit: 'pp',
  },
];

function FormulaTip({ id, label, formula }: { id: string; label: string; formula: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="ml-1 inline-grid h-4 w-4 place-items-center rounded-full border border-border text-[10px] leading-none text-muted hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
        aria-label={`Formula for ${label}`}
        aria-describedby={id}
      >
        i
      </button>
      <span
        id={id}
        role="tooltip"
        className="invisible absolute top-5 left-0 z-20 w-56 rounded border border-border bg-surface p-2 text-[11px] font-normal text-foreground shadow-lg group-focus-within:visible group-hover:visible"
      >
        {formula}
      </span>
    </span>
  );
}

export interface StatsTableProps {
  reconciliation: Record<ScenarioKey, ReconciliationResult> | null;
}

/** Pure, props-driven table (tests render this directly). */
export function StatsTable({ reconciliation }: StatsTableProps) {
  const baseId = useId();
  return (
    <div>
      <table className="w-full table-fixed border-collapse text-xs tabular-nums">
        <caption className="sr-only">Reconciliation: ore loss and dilution per scenario</caption>
        <colgroup>
          <col className="w-[30%]" />
          <col />
          <col />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr className="border-b border-border align-bottom text-[11px] text-muted">
            <th scope="col" className="py-1 pr-1 text-left font-medium">
              Metric
            </th>
            {SCENARIO_COLUMNS.map((c) => (
              <th key={c.key} scope="col" className="px-0.5 py-1 text-right font-medium">
                {c.label}
              </th>
            ))}
            <th scope="col" className="py-1 pl-0.5 text-right font-medium">
              {DELTA_LABEL}
            </th>
          </tr>
        </thead>
        <tbody>
          {METRICS.map((m) => {
            const tipId = `${baseId}-${m.key}`;
            const delta = reconciliation
              ? m.value(reconciliation.post_adjusted) - m.value(reconciliation.post_original)
              : NaN;
            return (
              <tr key={m.key} className="border-b border-border/60" data-metric={m.key}>
                <th scope="row" className="py-1 pr-1 text-left font-normal">
                  <span className="inline-flex items-center">
                    <span data-label>
                      {m.label} <span className="text-muted">{m.unit}</span>
                    </span>
                    <FormulaTip id={tipId} label={m.label} formula={m.formula} />
                  </span>
                </th>
                {SCENARIO_COLUMNS.map((c) => (
                  <td key={c.key} className="px-0.5 py-1 text-right">
                    {reconciliation ? fmt(m.value(reconciliation[c.key]), m.digits) : '–'}
                  </td>
                ))}
                <td className="py-1 pl-0.5 text-right font-medium" data-delta={m.key}>
                  {reconciliation ? (
                    <>
                      {fmtSigned(delta, m.digits)}
                      {m.deltaUnit === 'pp' ? <span className="text-muted"> pp</span> : null}
                    </>
                  ) : (
                    '–'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] leading-snug text-muted">
        In-situ dilution reflects dig-line smoothing (a minimum-mining-width stand-in). Dig lines are a
        grade-threshold contour, not an optimised dig limit. Δ = post-blast / adjusted − post-blast / original
        (pp = percentage points).
      </p>
    </div>
  );
}

/** Store-connected table: re-renders only when the reconciliation slot changes. */
export default function ConnectedStatsTable() {
  const reconciliation = useAppStore((s) => s.reconciliation);
  return <StatsTable reconciliation={reconciliation} />;
}
