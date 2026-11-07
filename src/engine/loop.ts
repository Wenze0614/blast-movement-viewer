/**
 * Frame loop maths, kept pure so it is testable without WebGL (docs/03 §2).
 *
 * Render on demand: a frame runs (all systems update, the render system draws) only when
 * something invalidated the image or a system reports isAnimating(). Idle frames do nothing.
 */
import { MAX_DT, PHASES, type FrameInfo, type System } from './types';

/** Clamp a raw frame delta (s) to [0, MAX_DT] so a backgrounded tab doesn't teleport animations. */
export function clampDt(rawSeconds: number): number {
  if (!Number.isFinite(rawSeconds) || rawSeconds <= 0) return 0;
  return rawSeconds > MAX_DT ? MAX_DT : rawSeconds;
}

/** Stable sort by phase (input → simulate → animate → render); registry order within a phase. */
export function orderByPhase<T extends Pick<System, 'phase'>>(systems: readonly T[]): T[] {
  return systems
    .map((s, i) => ({ s, i }))
    .sort((a, b) => PHASES.indexOf(a.s.phase) - PHASES.indexOf(b.s.phase) || a.i - b.i)
    .map(({ s }) => s);
}

export interface FrameClock {
  /**
   * Advance to `nowMs`. Returns the frame info for an active frame. `resumed` = the previous
   * frame was idle; its gap is not elapsed animation time, so dt is 0 on the first active frame.
   */
  tick(nowMs: number, resumed: boolean): FrameInfo;
}

export function createFrameClock(): FrameClock {
  let last: number | null = null;
  let elapsed = 0;
  let frame = 0;
  return {
    tick(nowMs, resumed) {
      const dt = last === null || resumed ? 0 : clampDt((nowMs - last) / 1000);
      last = nowMs;
      elapsed += dt;
      frame += 1;
      return { dt, elapsed, frame };
    },
  };
}

export interface Loop {
  /** The callback for renderer.setAnimationLoop. */
  step(nowMs: number): void;
  invalidate(): void;
  /** True if the last step ran the systems (for tests and the dev overlay). */
  readonly lastFrameActive: boolean;
}

/**
 * Builds the loop over systems already ordered by phase. The dirty flag is cleared BEFORE the
 * systems run, so an invalidate() during update schedules the next frame instead of being lost.
 */
export function createLoop(systems: readonly System[]): Loop {
  const clock = createFrameClock();
  let dirty = true;
  let wasActive = false;
  const ordered = orderByPhase(systems);
  return {
    step(nowMs) {
      const active = dirty || ordered.some((s) => s.isAnimating?.() === true);
      if (!active) {
        wasActive = false;
        return;
      }
      dirty = false;
      const info = clock.tick(nowMs, !wasActive);
      wasActive = true;
      for (const s of ordered) s.update?.(info);
    },
    invalidate() {
      dirty = true;
    },
    get lastFrameActive() {
      return wasActive;
    },
  };
}
