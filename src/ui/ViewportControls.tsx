'use client';
/**
 * Bottom-right of the canvas (ADR-8 "[3D] [Plan]"): the camera view toggle (P4) and the frame
 * stats toggle + readout (P6). The readout re-renders when the engine publishes (≈ 2 Hz), never
 * per frame.
 */
import type { AppState, PerfStats } from '@/state/store';
import { useAppStore } from '@/state/hooks';
import { fmt } from './format';

const VIEWS: readonly { value: AppState['cameraView']; label: string; title: string }[] = [
  { value: '3d', label: '3D', title: 'Perspective view (drag to orbit)' },
  { value: 'plan', label: 'Plan', title: 'Top-down plan view, north up (rotation locked; pan and zoom)' },
];

const button = (active: boolean) =>
  `rounded px-2 py-1 text-xs ${active ? 'bg-accent font-semibold text-white' : 'bg-black/40 text-white/80 hover:bg-black/60'}`;

export interface PerfReadoutProps {
  perf: PerfStats | null;
  blocks: number | null;
}

export function PerfReadout({ perf, blocks }: PerfReadoutProps) {
  const frame = !perf
    ? 'measuring…'
    : perf.active && perf.fps > 0
      ? `${fmt(perf.fps, 0)} fps · ${fmt(perf.frameMs, 1)} ms`
      : 'idle · render on demand';
  return (
    <div
      data-testid="perf-readout"
      className="rounded bg-black/55 px-2 py-1 text-right font-mono text-[11px] leading-snug text-white/85 tabular-nums"
    >
      <div data-perf="frame">{frame}</div>
      {perf ? (
        <div data-perf="cost" className="text-white/60">
          {perf.drawCalls} draw calls · {fmt(perf.triangles / 1000, 0)}k tris
          {blocks !== null ? ` · ${fmt(blocks, 0)} blocks` : ''}
        </div>
      ) : null}
    </div>
  );
}

export default function ViewportControls() {
  const cameraView = useAppStore((s) => s.cameraView);
  const setCameraView = useAppStore((s) => s.setCameraView);
  const showPerf = useAppStore((s) => s.showPerf);
  const setShowPerf = useAppStore((s) => s.setShowPerf);
  const perf = useAppStore((s) => s.perf);
  const blocks = useAppStore((s) => s.model?.count ?? null);

  return (
    <div className="pointer-events-auto flex flex-col items-end gap-1.5">
      {showPerf ? <PerfReadout perf={perf} blocks={blocks} /> : null}
      <div className="flex gap-1">
        <div role="group" aria-label="Camera view" className="flex gap-1">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              title={v.title}
              aria-pressed={cameraView === v.value}
              onClick={() => setCameraView(v.value)}
              className={button(cameraView === v.value)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          title="Frame stats (fps, draw calls, triangles)"
          aria-pressed={showPerf}
          onClick={() => setShowPerf(!showPerf)}
          className={button(showPerf)}
        >
          FPS
        </button>
      </div>
    </div>
  );
}
