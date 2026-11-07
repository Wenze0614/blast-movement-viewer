'use client';

import { useEffect, useRef } from 'react';

/**
 * Canvas + engine lifecycle. React owns only the canvas element; the engine (Stage: engine
 * skeleton) is created in the effect and disposed on unmount. StrictMode-safe pattern:
 *
 *   let engine, cancelled = false;
 *   createEngine(canvas, appStore, dataSource).then(e => cancelled ? e.dispose() : (engine = e));
 *   return () => { cancelled = true; engine?.dispose(); };
 *
 * Stage 0 placeholder: mounts the canvas only.
 */
export default function Viewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.dataset.mounted = 'true';
    return () => {
      delete canvas.dataset.mounted;
    };
  }, []);

  return (
    <div className="absolute inset-0">
      <canvas ref={canvasRef} className="block h-full w-full" data-testid="viewer-canvas" />
      <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-white/50">
        3D engine not wired yet (Stage 0 placeholder)
      </p>
    </div>
  );
}
