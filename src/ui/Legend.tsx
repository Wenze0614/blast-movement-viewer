'use client';
/**
 * Legend per colour mode (M2, P1): grade classes or outcome classes with tonnes, or the viridis
 * movement ramp with its min/max in m. Re-renders only on discrete changes (mode, data, the
 * in-situ ↔ post-blast switch); never per frame.
 */
import { useMemo } from 'react';
import type { ScenarioKey } from '@/core/types';
import { useAppStore } from '@/state/hooks';
import { GRADE_PALETTE, OUTCOME_PALETTE, VIRIDIS_CSS, type PaletteEntry } from '@/state/palette';
import type { AppState, ColourMode } from '@/state/store';
import { classTonnes, distanceRange, OUTCOME_ORDER, outcomeScenario, outcomeTonnes, sumTonnes } from '@/state/views';
import { fmt } from './format';

export function LineSwatch({ hex, dashed }: { hex: string; dashed: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block w-6 border-t-[3px]"
      style={{ borderColor: hex, borderStyle: dashed ? 'dashed' : 'solid' }}
    />
  );
}

export const OUTCOME_CAPTION: Record<ScenarioKey, string> = {
  insitu_original: 'In-situ blocks vs original dig line (before the blast)',
  post_original: 'Post-blast positions vs original dig line (the cost of digging the old line)',
  post_adjusted: 'Post-blast positions vs adjusted dig line',
};

export type LegendProps =
  | { mode: 'grade'; tonnes: number[] | null; fallbackFrom?: ColourMode }
  | { mode: 'outcome'; scenario: ScenarioKey; tonnes: number[] | null }
  | { mode: 'movement'; range: readonly [number, number] };

const TITLE: Record<ColourMode, string> = { grade: 'Grade (Au)', outcome: 'Outcome', movement: 'Movement distance' };

const FALLBACK_NOTE: Partial<Record<ColourMode, string>> = {
  outcome: 'Outcome needs the dig lines; showing grade until they are ready.',
  movement: 'Movement needs a computed blast; showing grade until it is ready.',
};

function ClassList({ entries, tonnes }: { entries: PaletteEntry[]; tonnes: number[] | null }) {
  return (
    <ul className="space-y-1 text-xs">
      {entries.map((e, i) => (
        <li key={e.key} data-legend={e.key} className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: e.hex }} />
          <span className="flex-1">{e.label}</span>
          {tonnes ? (
            <span data-tonnes className="text-muted tabular-nums">
              {fmt(tonnes[i], 0)} t
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Presentational legend (tests render this directly). */
export function LegendView(props: LegendProps) {
  const title = props.mode === 'grade' && props.fallbackFrom ? TITLE[props.fallbackFrom] : TITLE[props.mode];
  return (
    <div data-legend-mode={props.mode}>
      <h2 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">{title}</h2>
      {props.mode === 'grade' ? (
        <>
          <ClassList entries={Object.values(GRADE_PALETTE)} tonnes={props.tonnes} />
          <p className="mt-1 text-[11px] text-muted">
            {props.fallbackFrom ? FALLBACK_NOTE[props.fallbackFrom] : 'Cut-off 0.5 g/t.'}
          </p>
        </>
      ) : null}
      {props.mode === 'outcome' ? (
        <>
          <ClassList entries={OUTCOME_ORDER.map((o) => OUTCOME_PALETTE[o])} tonnes={props.tonnes} />
          <p data-caption className="mt-1 text-[11px] text-muted">
            {OUTCOME_CAPTION[props.scenario]}. Ore = grade ≥ cut-off; mill = plan centroid inside the line.
          </p>
        </>
      ) : null}
      {props.mode === 'movement' ? (
        <>
          <div aria-hidden className="h-3 w-full rounded-sm" style={{ background: VIRIDIS_CSS }} />
          <div className="mt-0.5 flex justify-between text-xs tabular-nums">
            <span data-min>{fmt(props.range[0], 1)} m</span>
            <span data-max>{fmt(props.range[1], 1)} m</span>
          </div>
          <p className="mt-1 text-[11px] text-muted">
            Displacement |end − start| per block (heuristic model), coloured by where it lands.
          </p>
        </>
      ) : null}
    </div>
  );
}

export type LegendInputs = Pick<
  AppState,
  'movement' | 'polygons' | 'reconciliation' | 'colourMode' | 'outcomeLine'
> & {
  /** progress > 0 */
  started: boolean;
};

/** Which legend the blocks are actually showing (mirrors engine/systems/blocks.ts colourKey). */
export function legendProps(s: LegendInputs, gradeTonnes: number[] | null, totalTonnes: number): LegendProps {
  if (s.colourMode === 'outcome' && s.movement && s.polygons) {
    const scenario = outcomeScenario(true, s.started ? 1 : 0, s.outcomeLine);
    const r = s.reconciliation?.[scenario];
    const t = r ? outcomeTonnes(r, totalTonnes) : null;
    return { mode: 'outcome', scenario, tonnes: t ? OUTCOME_ORDER.map((o) => t[o]) : null };
  }
  if (s.colourMode === 'movement' && s.movement) return { mode: 'movement', range: distanceRange(s.movement.distance) };
  return { mode: 'grade', tonnes: gradeTonnes, fallbackFrom: s.colourMode === 'grade' ? undefined : s.colourMode };
}

export default function Legend() {
  const model = useAppStore((s) => s.model);
  const movement = useAppStore((s) => s.movement);
  const polygons = useAppStore((s) => s.polygons);
  const reconciliation = useAppStore((s) => s.reconciliation);
  const colourMode = useAppStore((s) => s.colourMode);
  const outcomeLine = useAppStore((s) => s.outcomeLine);
  // Boolean slice: re-renders once as the blast starts, not on every progress write.
  const started = useAppStore((s) => s.progress > 0);

  const gradeTonnes = useMemo(() => (model ? classTonnes(model.oreClass, model.tonnes, 3) : null), [model]);
  const totalTonnes = useMemo(() => (model ? sumTonnes(model.tonnes) : 0), [model]);
  const props = useMemo(
    () => legendProps({ movement, polygons, reconciliation, colourMode, outcomeLine, started }, gradeTonnes, totalTonnes),
    [movement, polygons, reconciliation, colourMode, outcomeLine, started, gradeTonnes, totalTonnes],
  );
  return <LegendView {...props} />;
}
