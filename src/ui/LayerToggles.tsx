'use client';
/**
 * Layer toggles: dig lines (M5/M6) and the blasthole pattern (P9). Reads/writes store.layers; the
 * engine reacts via subscribe.
 */
import { GRADE_PALETTE, DIG_LINE_STYLE } from '@/state/palette';
import { useAppStore } from '@/state/hooks';
import { OreClass } from '@/core/types';
import { LineSwatch } from './Legend';

const LINE_KEYS = ['originalLine', 'adjustedLine'] as const;

/** Shown on the holes row (P9, plan §6 "overclaiming"): the pattern is display-only. */
export const HOLES_NOTE = 'illustrative pattern, not used by the movement heuristic';

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
          <span className="mt-1.5">
            <HoleSwatch />
          </span>
          <span>
            Blastholes (by sampled grade)
            <span id="holes-note" className="block text-xs text-muted">
              {HOLES_NOTE}
            </span>
          </span>
        </label>
      </div>
    </fieldset>
  );
}
