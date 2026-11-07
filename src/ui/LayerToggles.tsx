'use client';
/** Dig-line layer toggles (M5/M6). Reads/writes store.layers; the engine reacts via subscribe. */
import { DIG_LINE_STYLE } from '@/state/palette';
import { useAppStore } from '@/state/hooks';
import { LineSwatch } from './Legend';

const KEYS = ['originalLine', 'adjustedLine'] as const;

export default function LayerToggles() {
  const layers = useAppStore((s) => s.layers);
  const toggleLayer = useAppStore((s) => s.toggleLayer);
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Layers</legend>
      <div className="space-y-1">
        {KEYS.map((key) => (
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
      </div>
    </fieldset>
  );
}
