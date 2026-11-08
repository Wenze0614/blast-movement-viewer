'use client';
/**
 * P2 inspector card (U6): the clicked block's grade, tonnes, in-situ → final position,
 * displacement and where it goes under each reconciliation scenario. Overlaid on the canvas, so
 * it is visible right where the click happened. Re-renders on selection or data changes only,
 * never per frame. Esc or × clears the selection.
 */
import { useEffect, useMemo, type ReactNode } from 'react';
import { getBlock } from '@/core/blockModel';
import { getBlockMovement } from '@/core/inspect';
import type { BlockModel, Destination, DigPolygon, MovementResult, ScenarioKey } from '@/core/types';
import { useAppStore } from '@/state/hooks';
import { GRADE_PALETTE, OUTCOME_PALETTE } from '@/state/palette';
import { Outcome } from '@/state/views';
import { fmt, fmtSigned } from './format';

const SCENARIO_LABEL: Record<ScenarioKey, string> = {
  insitu_original: 'In-situ / original',
  post_original: 'Post-blast / original',
  post_adjusted: 'Post-blast / adjusted',
};

function outcomeOf(ore: boolean, dest: Destination): Outcome {
  if (ore) return dest === 'mill' ? Outcome.OreToMill : Outcome.OreLost;
  return dest === 'mill' ? Outcome.Dilution : Outcome.WasteToWaste;
}

/** Mine coordinates, m: fixed decimals, no thousands grouping (RL 1038.75, not 1,038.75). */
const xyz = (v: readonly number[]) => v.map((c) => c.toFixed(2)).join(', ');

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}

function Swatch({ hex }: { hex: string }) {
  return <span aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: hex }} />;
}

export interface InspectorViewProps {
  model: BlockModel;
  movement: MovementResult | null;
  polygons: { original: DigPolygon; adjusted: DigPolygon } | null;
  id: number;
  onClose: () => void;
}

export function InspectorView({ model, movement, polygons, id, onClose }: InspectorViewProps) {
  const block = useMemo(() => getBlock(model, id), [model, id]);
  const moved = useMemo(
    () => (movement && polygons ? getBlockMovement(model, movement, polygons, id) : null),
    [model, movement, polygons, id],
  );
  const [i, j, k] = block.ijk;
  const nz = model.grid.nz;
  const flitch = k === nz - 1 ? 'top flitch' : k === 0 ? 'bottom flitch' : `flitch ${nz - k} from top`;
  const grade = GRADE_PALETTE[block.oreClass];
  const ore = block.grade >= model.grades.cutoff;
  const metal = block.tonnes * block.grade;

  const destinations: [ScenarioKey, Destination][] = moved
    ? [
        ['insitu_original', moved.preDestination],
        ['post_original', moved.postDestination],
        ['post_adjusted', moved.adjustedDestination],
      ]
    : [];

  return (
    <section
      aria-label={`Block ${id} inspector`}
      className="pointer-events-auto w-72 rounded-md border border-border bg-surface/95 p-3 text-xs shadow-lg backdrop-blur"
    >
      <header className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Block {id}</h2>
          <p className="text-muted">
            i {i} · j {j} · k {k} ({flitch})
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="-mt-0.5 rounded px-1.5 text-base leading-none text-muted hover:bg-border/60 hover:text-foreground"
        >
          ×
        </button>
      </header>

      <dl className="space-y-0.5">
        <Row label="Grade">
          <Swatch hex={grade.hex} />
          {fmt(block.grade, 2)} g/t Au
        </Row>
        <Row label="Class">{ore ? `Ore (${grade.label.split(' (')[0].toLowerCase()})` : 'Waste'}</Row>
        <Row label="Tonnes">{fmt(block.tonnes, 1)} t</Row>
        <Row label="Density">{fmt(block.density, 2)} t/m³</Row>
        <Row label="Au metal">{fmt(metal, 1)} g</Row>
        <Row label="In situ E, N, RL">{xyz(block.position)}</Row>
      </dl>

      {moved ? (
        <>
          <h3 className="mt-3 mb-1 font-semibold">After the blast</h3>
          <dl className="space-y-0.5">
            <Row label="Final E, N, RL">{xyz(moved.finalPosition)}</Row>
            <Row label="Δ E, N, RL">{moved.displacement.map((c) => fmtSigned(c, 1)).join(', ')} m</Row>
            <Row label="Distance">{fmt(moved.distance, 2)} m</Row>
          </dl>
          <h3 className="mt-3 mb-1 font-semibold">Destination</h3>
          <ul className="space-y-0.5" aria-label="Destination per scenario">
            {destinations.map(([key, dest]) => {
              const outcome = outcomeOf(ore, dest);
              const suffix = outcome === Outcome.OreLost ? ' · ore lost' : outcome === Outcome.Dilution ? ' · dilution' : '';
              return (
                <li key={key} data-scenario={key} className="flex justify-between gap-3">
                  <span className="text-muted">{SCENARIO_LABEL[key]}</span>
                  <span>
                    <Swatch hex={OUTCOME_PALETTE[outcome].hex} />
                    {dest === 'mill' ? 'Mill' : 'Waste'}
                    {suffix}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="mt-3 text-muted">Movement not computed yet.</p>
      )}
    </section>
  );
}

/** Store-bound inspector; renders nothing while no block is selected. */
export default function Inspector() {
  const selection = useAppStore((s) => s.selection);
  const model = useAppStore((s) => s.model);
  const movement = useAppStore((s) => s.movement);
  const polygons = useAppStore((s) => s.polygons);
  const select = useAppStore((s) => s.select);
  const open = selection !== null && model !== null && selection < model.count;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // An open modal (About) handles its own Esc; leave the selection alone then.
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) select(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, select]);

  if (!open) return null;
  return <InspectorView model={model} movement={movement} polygons={polygons} id={selection} onClose={() => select(null)} />;
}
