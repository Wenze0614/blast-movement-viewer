'use client';
/**
 * Canvas + engine lifecycle (docs/03 §2). React owns only the canvas element; the engine and the
 * data pipeline are created in the effect and disposed on unmount. StrictMode-safe: the first
 * mount's pending createEngine is cancelled (AbortSignal + cancelled flag) and disposed when it
 * resolves, so mount → unmount → mount leaves exactly one engine.
 */
import { useEffect, useRef, useState } from 'react';
import { createDataSource, isAbortError, type DataSource } from '@/data';
import { createEngine } from '@/engine/Engine';
import type { Engine } from '@/engine/types';
import { startDataPipeline } from '@/state/pipeline';
import { useAppStore } from '@/state/hooks';
import { appStore } from '@/state/store';
import Inspector from '@/ui/Inspector';
import ViewportControls from '@/ui/ViewportControls';

let sharedDataSource: DataSource | null = null;
let perfDefaultApplied = false;

/**
 * P6: frame stats start on in development, or with `?fps` in the URL; the FPS button toggles them.
 * Applied once per page, so a StrictMode remount doesn't undo the user's toggle.
 */
function applyPerfDefault(): void {
  if (perfDefaultApplied) return;
  perfDefaultApplied = true;
  const fromUrl = new URLSearchParams(window.location.search).has('fps');
  if (process.env.NODE_ENV !== 'production' || fromUrl) appStore.getState().setShowPerf(true);
}
/**
 * One DataSource per page (both sources cache models). An API failure falls back to local compute
 * and flags it in the store for the source badge.
 */
function dataSource(): DataSource {
  sharedDataSource ??= createDataSource({
    onFallback: (err) => appStore.getState().setFallback(err instanceof Error ? err.message : String(err)),
  });
  return sharedDataSource;
}

export default function Viewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const plan = useAppStore((s) => s.cameraView === 'plan');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    applyPerfDefault();
    const data = dataSource();
    const pipeline = startDataPipeline(appStore, data);
    const ctrl = new AbortController();
    let engine: Engine | undefined;
    let cancelled = false;

    createEngine(canvas, appStore, data, { signal: ctrl.signal })
      .then((e) => {
        if (cancelled) e.dispose();
        else engine = e;
      })
      .catch((err: unknown) => {
        if (cancelled || isAbortError(err)) return;
        console.error('[bmv] engine failed to start', err);
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      ctrl.abort();
      engine?.dispose();
      pipeline.dispose();
    };
  }, []);

  return (
    <div className="absolute inset-0">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" data-testid="viewer-canvas" />
      {error ? (
        <p role="alert" className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/80">
          The 3D view could not start (WebGL2 required): {error}
        </p>
      ) : (
        <>
          <div className="pointer-events-none absolute top-3 left-3">
            <Inspector />
          </div>
          <div className="pointer-events-none absolute right-3 bottom-2">
            <ViewportControls />
          </div>
          <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-white/45">
            {plan ? 'Plan view · drag to pan' : 'Drag to orbit · right-drag to pan'} · scroll to zoom · click a block to
            inspect
          </p>
        </>
      )}
    </div>
  );
}
