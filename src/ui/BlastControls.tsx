'use client';
/**
 * Blast button + scrubber (M4). The slider is UNCONTROLLED and synced imperatively from the store,
 * so playback (which writes progress every frame) never re-renders React. Only discrete slices
 * (playing, at-end, has-movement) are selected.
 */
import { useEffect, useRef } from 'react';
import { useAppStore } from '@/state/hooks';
import { appStore } from '@/state/store';

const STEPS = 1000;

export default function BlastControls() {
  const playing = useAppStore((s) => s.playing);
  const atEnd = useAppStore((s) => s.progress >= 1);
  const ready = useAppStore((s) => s.movement !== null);
  const sliderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sync = (p: number) => {
      const el = sliderRef.current;
      if (!el) return;
      el.value = String(Math.round(p * STEPS));
      el.setAttribute('aria-valuetext', `${Math.round(p * 100)}% (0% = before, 100% = after)`);
    };
    sync(appStore.getState().progress);
    return appStore.subscribe((s) => s.progress, sync);
  }, []);

  const onBlast = () => {
    const s = appStore.getState();
    if (s.playing) s.pause();
    else s.play();
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBlast}
          disabled={!ready}
          className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {playing ? 'Pause' : atEnd ? 'Replay blast' : 'Blast'}
        </button>
        <button
          type="button"
          onClick={() => {
            appStore.getState().pause();
            appStore.getState().setProgress(0);
          }}
          disabled={!ready}
          className="rounded border border-border px-2 py-1.5 text-sm disabled:opacity-40"
        >
          Reset
        </button>
      </div>
      <input
        ref={sliderRef}
        type="range"
        min={0}
        max={STEPS}
        step={1}
        defaultValue={0}
        disabled={!ready}
        aria-label="Blast progress"
        className="mt-3 w-full accent-[var(--accent)]"
        onInput={(e) => {
          const s = appStore.getState();
          if (s.playing) s.pause();
          s.setProgress(Number(e.currentTarget.value) / STEPS);
        }}
      />
      <div className="flex justify-between text-[11px] text-muted" aria-hidden>
        <span>before</span>
        <span>after</span>
      </div>
    </div>
  );
}
