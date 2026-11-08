/**
 * render/perf (P6), registered after render: records when each ACTIVE frame was drawn and what it
 * cost (renderer.info.render), and publishes a summary to the store every PERF_PUBLISH_MS while
 * the overlay is on. Off, it only keeps a small ring of timestamps; React never re-renders per
 * frame either way (at most ~2 store writes a second).
 *
 * Render on demand means fps is only meaningful while something animates (playback, damping,
 * the plan-view ease); with no frame in the last window the summary says "idle".
 */
import type { PerfStats } from '@/state/store';
import type { SystemFactory } from '../types';

/** ms between store publishes, and the window the fps is measured over. */
export const PERF_PUBLISH_MS = 500;
/** Frame timestamps kept (enough for > 1 s at 120 Hz). */
const RING = 256;

/**
 * Summary of the frames drawn in (now − windowMs, now]: fps from the mean interval between them
 * (needs ≥ 2 frames), active = any frame in the window. `times` is ascending, in ms.
 */
export function summarisePerf(
  times: readonly number[],
  nowMs: number,
  windowMs: number,
  drawCalls: number,
  triangles: number,
): PerfStats {
  let first = -1;
  for (let i = times.length - 1; i >= 0 && times[i] > nowMs - windowMs; i--) first = i;
  const n = first < 0 ? 0 : times.length - first;
  if (n < 2) return { fps: 0, frameMs: 0, active: n > 0, drawCalls, triangles };
  const frameMs = (times[times.length - 1] - times[first]) / (n - 1);
  return { fps: frameMs > 0 ? 1000 / frameMs : 0, frameMs, active: true, drawCalls, triangles };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const createPerfSystem: SystemFactory = (ctx) => {
  const { renderer, store, bag } = ctx;
  const times: number[] = [];
  let drawCalls = 0;
  let triangles = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const publish = () => {
    store.getState().setPerf(summarisePerf(times, now(), PERF_PUBLISH_MS, drawCalls, triangles));
  };
  const start = () => {
    if (timer !== null) return;
    publish();
    timer = setInterval(publish, PERF_PUBLISH_MS);
  };
  const stop = () => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };
  const apply = (show: boolean) => (show ? start() : stop());

  bag.track(store.subscribe((s) => s.showPerf, apply));
  bag.track(stop);

  return {
    name: 'perf',
    phase: 'render',
    init() {
      apply(store.getState().showPerf);
    },
    update() {
      times.push(now());
      if (times.length > RING) times.splice(0, times.length - RING);
      const info = renderer.info?.render;
      if (info) {
        drawCalls = info.calls;
        triangles = info.triangles;
      }
    },
    dispose() {
      // The timer and subscription are in ctx.bag.
    },
  };
};
