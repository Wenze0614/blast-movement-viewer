'use client';
/**
 * Blast parameter panel (P5). Sliders over the ADR-12 ranges (core/params.ts, the table the API
 * validates against) plus the movement seed. Edits are held as a local draft: nothing is sent until
 * the user presses Update (or Enter in the seed field), so several changes go out as ONE movement
 * request instead of one per change (a 2M-block movement takes seconds). On Update the draft is
 * written to the store; the pipeline then requests the movement (aborting any older request) and
 * playback rewinds to 0 (Stage 2 decision 9). Reset to defaults stages the defaults in the draft
 * too, so the rule is one: only Update recomputes. Discard drops the draft.
 * Remounted per blast (`key`), so a pending draft never leaks into another blast.
 */
import { useState, type FormEvent } from 'react';
import { INITIATIONS, PARAM_RANGES, type NumericParamKey } from '@/core/params';
import type { BlastParameters, Initiation } from '@/core/types';
import { useAppStore } from '@/state/hooks';
import { fmt } from './format';

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

/** The draft keys whose value differs from the applied params (what Update would change). */
export function changedKeys(draft: Draft | null, params: BlastParameters): (keyof BlastParameters)[] {
  if (!draft) return [];
  return (Object.keys(draft) as (keyof BlastParameters)[]).filter((k) => draft[k] !== undefined && draft[k] !== params[k]);
}

/** Marks a control whose draft value is not applied yet. */
function ChangedDot({ changed }: { changed: boolean }) {
  if (!changed) return null;
  return (
    <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)] align-middle" title="Changed, not applied yet" aria-label="changed" />
  );
}

function Slider({
  spec,
  value,
  changed,
  disabled,
  onChange,
}: {
  spec: SliderSpec;
  value: number;
  changed: boolean;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const r = PARAM_RANGES[spec.key];
  const id = `param-${spec.key}`;
  return (
    <div title={spec.hint} data-changed={changed || undefined}>
      <div className="flex items-baseline justify-between text-xs">
        <span>
          <ChangedDot changed={changed} />
          <label htmlFor={id}>{spec.label}</label>
        </span>
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

  const [draft, setDraft] = useState<Draft | null>(null);

  const value = <K extends keyof BlastParameters>(k: K): BlastParameters[K] => (draft?.[k] ?? params[k]) as BlastParameters[K];
  const changed = changedKeys(draft, params);
  const isChanged = (k: keyof BlastParameters) => changed.includes(k);

  const edit = (patch: Draft) => setDraft({ ...draft, ...patch });

  /** Send every pending change as one store write (one movement request). */
  const apply = (e?: FormEvent) => {
    // Enter in the seed field submits the form; the Update button calls this directly.
    e?.preventDefault();
    if (!ready || changed.length === 0) return;
    const patch: Draft = {};
    for (const k of changed) (patch as Record<string, unknown>)[k] = draft![k];
    setParams(patch);
    setDraft(null);
  };

  const discard = () => setDraft(null);

  /** Stage the blast defaults; like any edit, they apply on Update. */
  const reset = () => {
    if (defaults) setDraft({ ...defaults });
  };

  const atDefaults = defaults !== null && (Object.keys(defaults) as (keyof BlastParameters)[]).every((k) => defaults[k] === value(k));
  const seedMax = PARAM_RANGES.seed.max;
  const slider = (spec: SliderSpec) => (
    <Slider
      key={spec.key}
      spec={spec}
      value={value(spec.key)}
      changed={isChanged(spec.key)}
      disabled={!ready}
      onChange={(v) => edit({ [spec.key]: v })}
    />
  );

  return (
    <form className="space-y-2" onSubmit={apply}>
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
          <span>
            <ChangedDot changed={isChanged('initiation')} />
            Initiation
          </span>
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
        {TIMING_SLIDERS.map(slider)}
        <p className="text-[11px] text-muted">Rock moves toward the holes that fired before it (burden relief).</p>
      </fieldset>
      {MAIN_SLIDERS.map(slider)}
      <details className="space-y-2">
        <summary className="cursor-pointer text-xs text-muted">More parameters</summary>
        <div className="space-y-2 pt-1">
          {MORE_SLIDERS.map(slider)}
        </div>
      </details>
      <label className="flex items-center justify-between gap-2 text-xs" title="Seed of the movement noise (integer ≥ 0)">
        <span>
          <ChangedDot changed={isChanged('seed')} />
          Seed
        </span>
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
      <p className="text-[11px] text-muted">Heuristic movement model, not physics. Update recomputes the movement and rewinds the blast.</p>
      {changed.length > 0 && (
        // Sticks to the bottom of the scrolling panel; -bottom-4 / pb-4 cover the aside's p-4 so
        // the controls behind never show under it.
        <div className="sticky -bottom-4 z-10 -mx-4 bg-surface px-4 pt-1 pb-4">
          <div role="status" className="flex items-center justify-between gap-2 rounded border border-accent px-2 py-1.5">
            <span className="text-xs">
              {changed.length} unapplied {changed.length === 1 ? 'change' : 'changes'}
            </span>
            <span className="flex gap-1.5">
              <button type="button" onClick={discard} className="rounded border border-border px-2 py-1 text-xs">
                Discard
              </button>
              <button
                type="button"
                onClick={() => apply()}
                disabled={!ready}
                className="rounded bg-accent px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
              >
                Update
              </button>
            </span>
          </div>
        </div>
      )}
    </form>
  );
}
