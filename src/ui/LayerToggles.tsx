'use client';
/**
 * Layer toggles: dig lines (M5/M6) and the blasthole pattern (P9), which can be coloured by
 * sampled grade or by firing time (store.holeColour). Reads/writes the store; the engine reacts
 * via subscribe.
 */
import { useMemo } from 'react';
import { holeFiringTimes } from '@/core/timing';
import { GRADE_PALETTE, DIG_LINE_STYLE, PLASMA_CSS } from '@/state/palette';
import { useAppStore } from '@/state/hooks';
import type { HoleColour } from '@/state/store';
import { OreClass } from '@/core/types';
import { LineSwatch } from './Legend';

const LINE_KEYS = ['originalLine', 'adjustedLine'] as const;

/** Shown on the holes row (plan §6 "overclaiming"): what the pattern does and does not drive. */
export const HOLES_NOTE = 'illustrative pattern; its firing sequence sets the throw direction';

const HOLE_COLOUR_LABEL: Record<HoleColour, string> = { grade: 'Grade', timing: 'Firing time' };

/** Firing-time ramp: first hole → last hole. */
function TimingSwatch() {
  return <span aria-hidden className="inline-block h-2 w-6 rounded-sm" style={{ background: PLASMA_CSS }} />;
}

/** Three small dots in the grade palette: holes are coloured by sampled grade. */
function HoleSwatch() {
  const classes = [OreClass.Waste, OreClass.LowGrade, OreClass.HighGrade];
  return (
    <span aria-hidden className="inline-flex w-6 items-center justify-center gap-0.5">
      {classes.map((c) => (
        <span key={c} className="inline-block h-2 w-1.5 rounded-sm" style={{ background: GRADE_PALETTE[c].hex }} />
      ))}
    </span>
  );
}

export default function LayerToggles() {
  const layers = useAppStore((s) => s.layers);
  const toggleLayer = useAppStore((s) => s.toggleLayer);
  const holeColour = useAppStore((s) => s.holeColour);
  const setHoleColour = useAppStore((s) => s.setHoleColour);
  const model = useAppStore((s) => s.model);
  const blast = useAppStore((s) => s.blast);
  const params = useAppStore((s) => s.params);
  const { freeFace, initiation, rowDelayMs, holeDelayMs } = params;
  const lastMs = useMemo(() => {
    if (!model || !blast || blast.holes.length === 0) return null;
    const t = holeFiringTimes(model, blast.holes, { freeFace, initiation, rowDelayMs, holeDelayMs });
    return t.reduce((m, v) => Math.max(m, v), 0);
  }, [model, blast, freeFace, initiation, rowDelayMs, holeDelayMs]);
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Layers</legend>
      <div className="space-y-1">
        {LINE_KEYS.map((key) => (
          <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-[var(--accent)]"
              checked={layers[key]}
              onChange={() => toggleLayer(key)}
            />
            <LineSwatch hex={DIG_LINE_STYLE[key].hex} dashed={DIG_LINE_STYLE[key].dashed} />
            {DIG_LINE_STYLE[key].label}
          </label>
        ))}
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 accent-[var(--accent)]"
            checked={layers.holes}
            onChange={() => toggleLayer('holes')}
            aria-describedby="holes-note"
          />
          <span className="mt-1.5">{holeColour === 'timing' ? <TimingSwatch /> : <HoleSwatch />}</span>
          <span>
            Blastholes{' '}
            {holeColour === 'timing' ? (
              <span data-firing-range className="text-muted">
                (fired 0–{lastMs === null ? '…' : Math.round(lastMs)} ms)
              </span>
            ) : (
              <span className="text-muted">(by sampled grade)</span>
            )}
            <span id="holes-note" className="block text-xs text-muted">
              {HOLES_NOTE}
            </span>
          </span>
        </label>
        <div role="group" aria-label="Colour blastholes by" className="ml-6 flex gap-1">
          {(['timing', 'grade'] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={holeColour === c}
              onClick={() => setHoleColour(c)}
              className={`rounded border px-2 py-0.5 text-xs ${holeColour === c ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-border text-muted'}`}
            >
              {HOLE_COLOUR_LABEL[c]}
            </button>
          ))}
        </div>
      </div>
    </fieldset>
  );
}
