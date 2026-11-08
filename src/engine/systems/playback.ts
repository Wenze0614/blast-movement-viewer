/**
 * simulate/playback (M4): while playing, advances store progress by dt / duration and stops at 1.
 * The scrubber writes progress directly; this system never fights it (it only runs while playing).
 * Without a movement it holds (no frames spin); the movement arriving re-invalidates via blocks.
 */
import type { SystemFactory } from '../types';

/** Next progress after dt seconds of a `duration`-second 0 → 1 animation, clamped to [0, 1]. */
export function advanceProgress(progress: number, dt: number, duration: number): number {
  if (!(duration > 0)) return 1;
  const next = progress + dt / duration;
  return next < 0 ? 0 : next > 1 ? 1 : next;
}

export const createPlaybackSystem: SystemFactory = (ctx) => {
  const { store, bag } = ctx;
  bag.track(store.subscribe((s) => s.playing, () => ctx.invalidate()));

  return {
    name: 'playback',
    phase: 'simulate',
    update({ dt }) {
      const s = store.getState();
      // Hold at 0 while there is no movement yet (it lands at progress 0; store.setMovement).
      if (!s.playing || !s.movement) return;
      const next = advanceProgress(s.progress, dt, s.duration);
      s.setProgress(next);
      if (next >= 1) s.pause();
    },
    isAnimating() {
      const s = store.getState();
      return s.playing && s.movement !== null;
    },
    dispose() {},
  };
};
