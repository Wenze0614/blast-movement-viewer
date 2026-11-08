'use client';
/**
 * Blast parameter panel (P5). Sliders over the ADR-12 ranges (core/params.ts, the table the API
 * validates against) plus the movement seed. Edits are held as a local draft and written to the
 * store after PARAM_DEBOUNCE_MS without further edits; the pipeline then requests the movement
 * (aborting any older request) and playback rewinds to 0 (Stage 2 decision 9).
 * Remounted per blast (`key`), so a pending draft never leaks into another blast.
 */
import { useEffect, useRef, useState } from 'react';
import { INITIATIONS, PARAM_RANGES, type NumericParamKey } from '@/core/params';
import type { BlastParameters, Initiation } from '@/core/types';
import { useAppStore } from '@/state/hooks';
import { fmt } from './format';

export const PARAM_DEBOUNCE_MS = 300;

interface SliderSpec {
  key: Exclude<NumericParamKey, 'seed'>;
  label: string;
  unit: string;
  step: number;
  digits: number;
  hint: string;
}

/** Labels for the initiation select ('left' / 'right' seen from behind the blast). */
export const INITIATION_LABELS: Readonly<Record<Initiation, string>> = {
  row: 'Row by row (straight)',
  v: 'V from the front centre',
  'echelon-left': 'Echelon from the left corner',
  'echelon-right': 'Echelon from the right corner',
};

/** The firing sequence: it sets the throw direction and the order blocks start moving. */
export const TIMING_SLIDERS: readonly SliderSpec[] = [
  { key: 'rowDelayMs', label: 'Row delay', unit: 'ms', step: 1, digits: 0, hint: 'Delay between rows (one burden)' },
  { key: 'holeDelayMs', label: 'Hole delay', unit: 'ms', step: 1, digits: 0, hint: 'Delay between holes along a row, away from the initiation point' },
];

/** Shown first: the parameters that change the story most. */
export const MAIN_SLIDERS: readonly SliderSpec[] = [
  { key: 'maxThrow', label: 'Max throw', unit: 'm', step: 0.5, digits: 1, hint: 'Horizontal throw of the front row at the crest' },
  { key: 'swellFactor', label: 'Swell factor', unit: '×', step: 0.01, digits: 2, hint: 'Loose / bank volume' },
  { key: 'randomness', label: 'Randomness', unit: '', step: 0.05, digits: 2, hint: 'Noise amplitude (0 = smooth)' },
  { key: 'backRowRatio', label: 'Back-row throw', unit: '× max', step: 0.05, digits: 2, hint: 'Throw at the back row as a fraction of max' },
  { key: 'toeRatio', label: 'Toe throw', unit: '× crest', step: 0.05, digits: 2, hint: 'Throw at the toe as a fraction of the crest' },
];

export const MORE_SLIDERS: readonly SliderSpec[] = [
  { key: 'throwExponent', label: 'Throw falloff', unit: 'p', step: 0.1, digits: 1, hint: 'p in (1 − s)^p: how fast throw decays from the face' },
  { key: 'lateralSigma', label: 'Lateral spread', unit: 'm', step: 0.1, digits: 1, hint: 'Lateral noise' },
  { key: 'lateralFan', label: 'Lateral fan', unit: 'm', step: 0.1, digits: 1, hint: 'Outward fan near the face' },
  { key: 'reposeAngleDeg', label: 'Repose angle', unit: '°', step: 1, digits: 0, hint: 'Muckpile slope limit' },
  { key: 'noiseLength', label: 'Noise length', unit: 'm', step: 0.5, digits: 1, hint: 'Spatial correlation length of the noise' },
];

type Draft = Partial<BlastParameters>;

function Slider({ spec, value, disabled, onChange }: { spec: SliderSpec; value: number; disabled: boolean; onChange: (v: number) => void }) {
  const r = PARAM_RANGES[spec.key];
  const id = `param-${spec.key}`;
  return (
    <div title={spec.hint}>
      <div className="flex items-baseline justify-between text-xs">
        <label htmlFor={id}>{spec.label}</label>
        <output htmlFor={id} className="text-muted tabular-nums">
          {fmt(value, spec.digits)} {spec.unit}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className="w-full accent-[var(--accent)]"
        min={r.min}
        max={r.max}
        step={spec.step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
    </div>
  );
}

export default function ParamsPanel() {
  const params = useAppStore((s) => s.params);
  const ready = useAppStore((s) => s.blast !== null);
  const defaults = useAppStore((s) => s.blast?.defaultParams ?? null);
  const setParams = useAppStore((s) => s.setParams);
  const resetParams = useAppStore((s) => s.resetParams);

  const [draft, setDraft] = useState<Draft | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const value = <K extends keyof BlastParameters>(k: K): BlastParameters[K] => (draft?.[k] ?? params[k]) as BlastParameters[K];

  const edit = (patch: Draft) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setParams(next);
      setDraft(null);
    }, PARAM_DEBOUNCE_MS);
  };

  const reset = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setDraft(null);
    resetParams();
  };

  const atDefaults =
    draft === null && defaults !== null && (Object.keys(defaults) as (keyof BlastParameters)[]).every((k) => defaults[k] === params[k]);
  const seedMax = PARAM_RANGES.seed.max;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">Blast parameters</h2>
        <button
          type="button"
          onClick={reset}
          disabled={!ready || atDefaults}
          className="rounded border border-border px-2 py-0.5 text-xs disabled:opacity-40"
        >
          Reset to defaults
        </button>
      </div>
      <fieldset className="space-y-2 rounded border border-border p-2">
        <legend className="px-1 text-xs text-muted">Firing sequence</legend>
        <label className="flex items-center justify-between gap-2 text-xs" title="Seen from behind the blast, looking at the free face">
          Initiation
          <select
            className="rounded border border-border bg-surface px-1 py-0.5 text-sm"
            value={value('initiation')}
            disabled={!ready}
            onChange={(e) => edit({ initiation: e.currentTarget.value as Initiation })}
          >
            {INITIATIONS.map((k) => (
              <option key={k} value={k}>
                {INITIATION_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        {TIMING_SLIDERS.map((spec) => (
          <Slider key={spec.key} spec={spec} value={value(spec.key)} disabled={!ready} onChange={(v) => edit({ [spec.key]: v })} />
        ))}
        <p className="text-[11px] text-muted">Rock moves toward the holes that fired before it (burden relief).</p>
      </fieldset>
      {MAIN_SLIDERS.map((spec) => (
        <Slider key={spec.key} spec={spec} value={value(spec.key)} disabled={!ready} onChange={(v) => edit({ [spec.key]: v })} />
      ))}
      <details className="space-y-2">
        <summary className="cursor-pointer text-xs text-muted">More parameters</summary>
        <div className="space-y-2 pt-1">
          {MORE_SLIDERS.map((spec) => (
            <Slider key={spec.key} spec={spec} value={value(spec.key)} disabled={!ready} onChange={(v) => edit({ [spec.key]: v })} />
          ))}
        </div>
      </details>
      <label className="flex items-center justify-between gap-2 text-xs" title="Seed of the movement noise (integer ≥ 0)">
        Seed
        <input
          type="number"
          inputMode="numeric"
          className="w-28 rounded border border-border bg-surface px-2 py-0.5 text-right text-sm tabular-nums"
          min={0}
          max={seedMax}
          step={1}
          value={value('seed')}
          disabled={!ready}
          onChange={(e) => {
            const n = Math.floor(Number(e.currentTarget.value));
            if (Number.isFinite(n)) edit({ seed: Math.min(seedMax, Math.max(0, n)) });
          }}
        />
      </label>
      <p className="text-[11px] text-muted">Heuristic movement model, not physics. Changes refetch the movement and rewind the blast.</p>
    </div>
  );
}
