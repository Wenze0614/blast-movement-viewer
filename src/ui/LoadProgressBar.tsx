'use client';
/**
 * Load progress under the blast picker (store.loadProgress, written by the data pipeline). A blast
 * switch shows two halves, the block model then the movement; a parameter change shows the movement
 * only. While a download runs the bar fills by bytes; while the server is still computing (or the
 * browser is, with local compute) the current step's span pulses. Shown only once a load has
 * lasted SHOW_AFTER_MS, so quick loads don't flash it, and gone as soon as the load ends.
 */
import { useEffect, useState } from 'react';
import { useAppStore } from '@/state/hooks';
import type { LoadProgress } from '@/state/store';

/** Loads quicker than this never show the bar. */
export const SHOW_AFTER_MS = 250;

export interface ProgressView {
  /** 0..1 of the whole load that is done. */
  done: number;
  /** [start, end] (0..1) of the current step on the bar. */
  span: [number, number];
  /** No bytes yet: the server (or the browser) is still computing this step. */
  waiting: boolean;
  /** '4.1 / 12.9 MB', '4.1 MB' (size unknown) or '' (nothing received yet). */
  bytes: string;
}

const mb = (b: number) => (b / 1e6).toFixed(1);

export function progressView(p: LoadProgress): ProgressView {
  const weight = p.withModel ? 0.5 : 1;
  const start = p.withModel && p.step === 'movement' ? 0.5 : 0;
  const frac = p.total ? Math.min(1, p.loaded / p.total) : 0;
  return {
    done: start + weight * frac,
    span: [start, start + weight],
    waiting: p.loaded === 0,
    bytes: p.loaded === 0 ? '' : p.total ? `${mb(p.loaded)} / ${mb(p.total)} MB` : `${mb(p.loaded)} MB`,
  };
}

export function LoadProgressView({ progress }: { progress: LoadProgress }) {
  const v = progressView(progress);
  const pct = Math.round(v.done * 100);
  return (
    <div className="space-y-0.5" data-load-progress>
      <div
        role="progressbar"
        aria-label={progress.step === 'model' ? 'Loading the block model' : 'Computing the movement'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-border"
      >
        {v.waiting ? (
          <div
            data-waiting
            className="absolute inset-y-0 animate-pulse rounded-full bg-[var(--accent)] opacity-40"
            style={{ left: `${v.span[0] * 100}%`, width: `${(v.span[1] - v.span[0]) * 100}%` }}
          />
        ) : null}
        <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)] transition-[width] duration-150" style={{ width: `${pct}%` }} />
      </div>
      {v.bytes ? <p className="text-right text-[11px] text-muted tabular-nums">{v.bytes}</p> : null}
    </div>
  );
}

/** Mounted for one load (keyed by its loadId): hidden until SHOW_AFTER_MS, then the bar. */
function DelayedProgress({ progress }: { progress: LoadProgress }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  return shown ? <LoadProgressView progress={progress} /> : null;
}

export default function LoadProgressBar() {
  const progress = useAppStore((s) => s.loadProgress);
  // Keyed by the load: a replacement load (blast switch, new parameters) remounts and starts hidden
  // again; the same load moving from model to movement keeps its state.
  return progress ? <DelayedProgress key={progress.loadId} progress={progress} /> : null;
}
