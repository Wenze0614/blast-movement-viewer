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
import { appStore } from '@/state/store';

let sharedDataSource: DataSource | null = null;
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
        <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-white/45">
          Drag to orbit · right-drag to pan · scroll to zoom
        </p>
      )}
    </div>
  );
}
