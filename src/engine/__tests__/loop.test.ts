import { describe, expect, it, vi } from 'vitest';
import type { MovementResult } from '@/core/types';
import { createAppStore } from '@/state/store';
import { clampDt, createFrameClock, createLoop, orderByPhase } from '../loop';
import { advanceProgress, createPlaybackSystem } from '../systems/playback';
import { MAX_DT, type EngineContext, type System } from '../types';

describe('clampDt', () => {
  it('clamps to [0, 1/20] s and rejects non-finite values', () => {
    expect(MAX_DT).toBe(1 / 20);
    expect(clampDt(1 / 60)).toBeCloseTo(1 / 60, 12);
    expect(clampDt(3)).toBe(MAX_DT);
    expect(clampDt(-1)).toBe(0);
    expect(clampDt(Number.NaN)).toBe(0);
  });
});

describe('frame clock', () => {
  it('derives dt from timestamps (ms → s), clamped; dt = 0 on the first and resumed frames', () => {
    const clock = createFrameClock();
    expect(clock.tick(1000, false).dt).toBe(0);
    expect(clock.tick(1016, false).dt).toBeCloseTo(0.016, 12);
    expect(clock.tick(5000, false).dt).toBe(MAX_DT); // backgrounded tab
    const resumed = clock.tick(9000, true);
    expect(resumed.dt).toBe(0);
    expect(resumed.frame).toBe(4);
    expect(resumed.elapsed).toBeCloseTo(0.016 + MAX_DT, 12);
  });
});

const sys = (name: string, phase: System['phase'], extra: Partial<System> = {}): System => ({
  name,
  phase,
  dispose: () => {},
  ...extra,
});

describe('orderByPhase', () => {
  it('sorts input → simulate → animate → render, stable within a phase', () => {
    const order = orderByPhase([sys('r', 'render'), sys('a1', 'animate'), sys('i', 'input'), sys('a2', 'animate'), sys('s', 'simulate')]);
    expect(order.map((s) => s.name)).toEqual(['i', 's', 'a1', 'a2', 'r']);
  });
});

describe('render-on-demand loop', () => {
  it('runs systems only when invalidated or while a system is animating', () => {
    const calls: string[] = [];
    let animating = false;
    const loop = createLoop([
      sys('render', 'render', { update: () => calls.push('render') }),
      sys('play', 'simulate', { update: () => calls.push('play'), isAnimating: () => animating }),
    ]);
    loop.step(0); // first frame is dirty
    expect(calls).toEqual(['play', 'render']);
    calls.length = 0;

    loop.step(16);
    loop.step(32);
    expect(calls).toEqual([]); // idle: nothing runs, nothing renders
    expect(loop.lastFrameActive).toBe(false);

    loop.invalidate();
    loop.step(48);
    expect(calls).toEqual(['play', 'render']);
    calls.length = 0;
    loop.step(64);
    expect(calls).toEqual([]);

    animating = true;
    loop.step(80);
    loop.step(96);
    expect(calls).toEqual(['play', 'render', 'play', 'render']);
  });

  it('an invalidate() during update schedules the next frame', () => {
    let n = 0;
    const loop = createLoop([
      sys('x', 'animate', {
        update: () => {
          n++;
          if (n === 1) loop.invalidate();
        },
      }),
    ]);
    loop.step(0);
    loop.step(16);
    loop.step(32);
    expect(n).toBe(2);
  });

  it('passes clamped dt to systems', () => {
    const dts: number[] = [];
    const loop = createLoop([sys('x', 'animate', { update: (f) => dts.push(f.dt), isAnimating: () => true })]);
    loop.step(0);
    loop.step(10);
    loop.step(2000);
    expect(dts[0]).toBe(0);
    expect(dts[1]).toBeCloseTo(0.01, 12);
    expect(dts[2]).toBe(MAX_DT);
  });
});

describe('playback dt math (M4)', () => {
  it('advanceProgress adds dt / duration and clamps to [0, 1]', () => {
    expect(advanceProgress(0, 0.25, 2.5)).toBeCloseTo(0.1, 12);
    expect(advanceProgress(0.95, 0.25, 2.5)).toBe(1);
    expect(advanceProgress(0.5, 0, 2.5)).toBe(0.5);
    expect(advanceProgress(0.5, 0.1, 0)).toBe(1);
  });

  // Playback only runs with a movement to show (it holds at 0 while one loads).
  const someMovement = {} as MovementResult;

  it('2.5 s of 60 fps frames takes progress 0 → 1, then pauses', () => {
    const store = createAppStore({ movement: someMovement });
    const ctx = { store, bag: { track: <T>(x: T) => x }, invalidate: vi.fn() } as unknown as EngineContext;
    const playback = createPlaybackSystem(ctx, {});
    store.getState().play();
    expect(ctx.invalidate).toHaveBeenCalled(); // play kicks the idle loop
    expect(playback.isAnimating?.()).toBe(true);
    let frames = 0;
    while (store.getState().playing && frames < 1000) {
      playback.update?.({ dt: 1 / 60, elapsed: 0, frame: frames });
      frames++;
    }
    expect(store.getState().progress).toBe(1);
    expect(frames).toBeGreaterThanOrEqual(149);
    expect(frames).toBeLessThanOrEqual(151);
    expect(playback.isAnimating?.()).toBe(false);
  });

  it('holds at 0 (and does not spin frames) while playing without a movement; runs once it lands', () => {
    const store = createAppStore();
    const ctx = { store, bag: { track: <T>(x: T) => x }, invalidate: vi.fn() } as unknown as EngineContext;
    const playback = createPlaybackSystem(ctx, {});
    store.getState().play(); // Blast pressed while the movement is still loading
    expect(playback.isAnimating?.()).toBe(false);
    for (let i = 0; i < 200; i++) playback.update?.({ dt: 1 / 60, elapsed: 0, frame: i });
    expect(store.getState()).toMatchObject({ progress: 0, playing: true });

    store.getState().setMovement(someMovement, 'local');
    expect(store.getState()).toMatchObject({ progress: 0, playing: true });
    expect(playback.isAnimating?.()).toBe(true);
    playback.update?.({ dt: 0.25, elapsed: 0, frame: 200 });
    expect(store.getState().progress).toBeCloseTo(0.1, 12);
  });

  it('does not touch progress while paused (the scrubber owns it)', () => {
    const store = createAppStore({ progress: 0.4 });
    const ctx = { store, bag: { track: <T>(x: T) => x }, invalidate: () => {} } as unknown as EngineContext;
    createPlaybackSystem(ctx, {}).update?.({ dt: 0.05, elapsed: 0, frame: 0 });
    expect(store.getState().progress).toBe(0.4);
  });
});
