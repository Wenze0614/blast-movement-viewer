'use client';
/**
 * View controls (ADR-8 "Colour | ore only | Section"): colour mode (P1), outcome dig line, ore-only
 * and the section slider (P3). Writes the store; the engine turns these into one aColor rewrite or
 * a uniform, never a geometry rebuild.
 */
import { useEffect, useMemo } from 'react';
import { useAppStore } from '@/state/hooks';
import type { ColourMode, OutcomeLine, SectionState } from '@/state/store';
import { sectionRange } from '@/state/views';
import { fmt } from './format';

const MODES: readonly { value: ColourMode; label: string }[] = [
  { value: 'grade', label: 'Grade' },
  { value: 'outcome', label: 'Outcome' },
  { value: 'movement', label: 'Movement' },
];

const LINES: readonly { value: OutcomeLine; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'adjusted', label: 'Adjusted' },
];

const AXES: readonly { value: SectionState['axis']; label: string; title: string }[] = [
  { value: 'y', label: 'Northing (y)', title: 'Cut at a northing: shows the E–W profile, i.e. the throw' },
  { value: 'x', label: 'Easting (x)', title: 'Cut at an easting: shows a N–S profile' },
];

/** m; slider resolution for the section plane. */
export const SECTION_STEP = 0.25;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const mid = ([lo, hi]: readonly [number, number]) => Math.round((lo + hi) / 2 / SECTION_STEP) * SECTION_STEP;
/** Slider bounds: the drawn extent along the axis, widened to whole slider steps. */
export function sliderBounds([lo, hi]: readonly [number, number]): [number, number] {
  return [Math.floor(lo / SECTION_STEP) * SECTION_STEP, Math.ceil(hi / SECTION_STEP) * SECTION_STEP];
}

const segment = (active: boolean) =>
  `rounded px-2 py-1 text-xs ${active ? 'bg-accent font-semibold text-white' : 'border border-border'}`;

function Segmented<T extends string>(props: {
  label: string;
  name: string;
  options: readonly { value: T; label: string; title?: string }[];
  value: T;
  disabled?: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={props.label} className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-xs text-muted">{props.label}</span>
      {props.options.map((o) => (
        <label key={o.value} title={o.title} className={`${segment(props.value === o.value)} cursor-pointer has-disabled:cursor-default has-disabled:opacity-40`}>
          <input
            type="radio"
            className="sr-only"
            name={props.name}
            value={o.value}
            checked={props.value === o.value}
            disabled={props.disabled}
            onChange={() => props.onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export default function ViewControls() {
  const colourMode = useAppStore((s) => s.colourMode);
  const outcomeLine = useAppStore((s) => s.outcomeLine);
  const oreOnly = useAppStore((s) => s.oreOnly);
  const section = useAppStore((s) => s.section);
  const model = useAppStore((s) => s.model);
  const movement = useAppStore((s) => s.movement);
  const setColourMode = useAppStore((s) => s.setColourMode);
  const setOutcomeLine = useAppStore((s) => s.setOutcomeLine);
  const setOreOnly = useAppStore((s) => s.setOreOnly);
  const setSection = useAppStore((s) => s.setSection);

  const range = useMemo(
    () => (model ? sliderBounds(sectionRange(model, movement, section.axis)) : null),
    [model, movement, section.axis],
  );

  // Keep the plane inside what is drawn when the data changes (new blast, wider muckpile).
  useEffect(() => {
    if (!range || !section.enabled) return;
    const p = clamp(section.position, range[0], range[1]);
    if (p !== section.position) setSection({ position: p });
  }, [range, section.enabled, section.position, setSection]);

  const enableSection = (enabled: boolean) => {
    const inRange = range && section.position >= range[0] && section.position <= range[1];
    setSection(enabled && range && !inRange ? { enabled, position: mid(range) } : { enabled });
  };

  return (
    <div className="space-y-2">
      <Segmented label="Colour" name="colour-mode" options={MODES} value={colourMode} onChange={setColourMode} />
      <Segmented
        label="Outcome line (after blast)"
        name="outcome-line"
        options={LINES}
        value={outcomeLine}
        disabled={colourMode !== 'outcome'}
        onChange={setOutcomeLine}
      />
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-[var(--accent)]"
          checked={oreOnly}
          onChange={(e) => setOreOnly(e.currentTarget.checked)}
        />
        Ore only (hide waste)
      </label>
      <fieldset className="space-y-1">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-[var(--accent)]"
            checked={section.enabled}
            disabled={!range}
            onChange={(e) => enableSection(e.currentTarget.checked)}
          />
          Section
        </label>
        <Segmented
          label="Cut at"
          name="section-axis"
          options={AXES}
          value={section.axis}
          disabled={!section.enabled}
          onChange={(axis) => {
            const r = model ? sliderBounds(sectionRange(model, movement, axis)) : null;
            setSection(r ? { axis, position: mid(r) } : { axis });
          }}
        />
        <div className="flex items-center gap-2">
          <input
            type="range"
            aria-label={`Section position (${section.axis}, m)`}
            className="w-full accent-[var(--accent)]"
            min={range ? range[0] : 0}
            max={range ? range[1] : 1}
            step={SECTION_STEP}
            value={section.position}
            disabled={!section.enabled || !range}
            onChange={(e) => setSection({ position: Number(e.currentTarget.value) })}
          />
          <output className="w-20 text-right text-xs tabular-nums" aria-live="off">
            {section.axis} = {fmt(section.position, 1)} m
          </output>
        </div>
      </fieldset>
    </div>
  );
}
