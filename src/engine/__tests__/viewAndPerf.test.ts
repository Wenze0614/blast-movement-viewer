// @vitest-environment happy-dom
/**
 * P4 plan view (controls system) and P6 frame stats (perf system), without WebGL.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalDataSource } from '@/data';
import { createAppStore, type AppStore } from '@/state/store';
import { sectionRange } from '@/state/views';
import { createDisposeBag } from '../disposeBag';
import { registerSystems } from '../systems';
import { CAMERA_TWEEN_S, createControlsSystem, framingFor, PLAN_MARGIN, planFramingFor } from '../systems/controls';
import { createPerfSystem, PERF_PUBLISH_MS, summarisePerf } from '../systems/perf';
import type { EngineContext, System } from '../types';

const data = new LocalDataSource();
const model = await data.getModel('b1040-017');
const movement = await data.getMovement('b1040-017', (await data.getBlast('b1040-017')).defaultParams);
const other = await data.getModel('b1030-022');
const otherDetail = await data.getBlast('b1030-022');
const otherMovement = await data.getMovement('b1030-022', otherDetail.defaultParams);

function mockCtx(store: AppStore = createAppStore(), renderer: unknown = {}): EngineContext {
  THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.5, 5000);
  camera.up.set(0, 0, 1);
  return {
    renderer: renderer as THREE.WebGLRenderer,
    scene: new THREE.Scene(),
    camera,
    canvas: document.createElement('canvas'),
    store,
    data,
    bag: createDisposeBag(),
    invalidate: vi.fn(),
  };
}

/** Run frames of `dt` s until the system stops animating (or `max` frames). */
function runUntilIdle(system: System, dt = 1 / 60, max = 600): number {
  let frames = 0;
  do {
    system.update?.({ dt, elapsed: 0, frame: frames });
    frames++;
  } while (system.isAnimating?.() && frames < max);
  return frames;
}

const near = (a: THREE.Vector3, b: THREE.Vector3, eps = 1e-6) => a.distanceTo(b) < eps;

describe('planFramingFor (P4)', () => {
  it('looks straight down at the centre of bench + muckpile, at the crest, north up', () => {
    const { target, position } = planFramingFor(model, movement, 40, 16 / 9);
    const [x0, x1] = sectionRange(model, movement, 'x');
    const [y0, y1] = sectionRange(model, movement, 'y');
    expect(target.x).toBeCloseTo((x0 + x1) / 2, 6);
    expect(target.y).toBeCloseTo((y0 + y1) / 2, 6);
    expect(target.z).toBeCloseTo(1040, 6);
    const h = position.z - target.z;
    expect(h).toBeGreaterThan(0);
    expect(Math.hypot(position.x - target.x, position.y - target.y)).toBeLessThan(2e-3 * h);
    expect(position.y).toBeLessThan(target.y); // a hair south: screen-up = north
  });

  it.each([16 / 9, 1, 0.5])('fits the whole drawn extent with the margin (aspect %s)', (aspect) => {
    const pose = planFramingFor(model, movement, 40, aspect);
    const cam = new THREE.PerspectiveCamera(40, aspect, 0.5, 5000);
    cam.up.set(0, 0, 1);
    cam.position.copy(pose.position);
    cam.lookAt(pose.target);
    cam.updateMatrixWorld();
    const [x0, x1] = sectionRange(model, movement, 'x');
    const [y0, y1] = sectionRange(model, movement, 'y');
    let maxX = 0;
    let maxY = 0;
    for (const x of [x0, x1]) {
      for (const y of [y0, y1]) {
        const p = new THREE.Vector3(x, y, 1040).project(cam);
        maxX = Math.max(maxX, Math.abs(p.x));
        maxY = Math.max(maxY, Math.abs(p.y));
      }
    }
    expect(Math.max(maxX, maxY)).toBeLessThanOrEqual(1 / PLAN_MARGIN + 1e-3);
    expect(Math.max(maxX, maxY)).toBeGreaterThan(1 / PLAN_MARGIN - 1e-2); // tight on one axis
  });

  it('before a movement exists it frames the in-situ bench only', () => {
    const before = planFramingFor(model, null, 40, 16 / 9);
    const after = planFramingFor(model, movement, 40, 16 / 9);
    expect(before.target.x).toBeLessThan(after.target.x); // the muckpile extends east
  });
});

describe('controls system: 3D ↔ plan (P4)', () => {
  function setup(store = createAppStore()) {
    const ctx = mockCtx(store);
    const system = createControlsSystem(ctx, {});
    void system.init?.();
    ctx.store.getState().setModel(model, 'local');
    ctx.store.getState().setMovement(movement, 'local');
    return { ctx, system };
  }

  it('eases to the plan pose over CAMERA_TWEEN_S of dt, input paused meanwhile, then rotation locked', () => {
    const { ctx, system } = setup();
    runUntilIdle(system);
    ctx.store.getState().setCameraView('plan');
    expect(system.isAnimating?.()).toBe(true);
    expect(ctx.invalidate).toHaveBeenCalled();
    // Half way (in dt), the camera is between the two poses and orbit input is off.
    const dt = CAMERA_TWEEN_S / 10;
    for (let i = 0; i < 5; i++) system.update?.({ dt, elapsed: 0, frame: i });
    const plan = planFramingFor(model, movement, ctx.camera.fov, ctx.camera.aspect);
    expect(near(ctx.camera.position, plan.position, 1)).toBe(false);
    for (let i = 0; i < 5; i++) system.update?.({ dt, elapsed: 0, frame: i });
    expect(near(ctx.camera.position, plan.position, 1e-6)).toBe(true);
    runUntilIdle(system);
    expect(system.isAnimating?.()).toBe(false);
    // Settled: an idle frame doesn't move the camera (the ease really ended, no drift).
    const p = ctx.camera.position.clone();
    system.update?.({ dt: 1 / 60, elapsed: 0, frame: 0 });
    expect(near(ctx.camera.position, p)).toBe(true);
    ctx.bag.disposeAll();
  });

  it('the tween is dt-driven: zero dt never advances it', () => {
    const { ctx, system } = setup();
    runUntilIdle(system);
    const start = ctx.camera.position.clone();
    ctx.store.getState().setCameraView('plan');
    for (let i = 0; i < 10; i++) system.update?.({ dt: 0, elapsed: 0, frame: i });
    expect(near(ctx.camera.position, start, 1e-6)).toBe(true);
    ctx.bag.disposeAll();
  });

  it('back to 3D restores the 3D pose the user left', () => {
    const { ctx, system } = setup();
    runUntilIdle(system);
    // The user orbited somewhere.
    ctx.camera.position.set(10, -40, 1080);
    const userPos = ctx.camera.position.clone();
    ctx.store.getState().setCameraView('plan');
    runUntilIdle(system);
    ctx.store.getState().setCameraView('3d');
    runUntilIdle(system);
    expect(near(ctx.camera.position, userPos, 1e-3)).toBe(true);
    ctx.bag.disposeAll();
  });

  it('a new blast while in plan view frames the new bench in plan directly (no tween)', () => {
    const { ctx, system } = setup();
    ctx.store.getState().setCameraView('plan');
    runUntilIdle(system);
    ctx.store.getState().setBlastId('b1030-022');
    ctx.store.getState().setModel(other, 'local');
    const plan = planFramingFor(other, null, ctx.camera.fov, ctx.camera.aspect);
    expect(near(ctx.camera.position, plan.position, 1e-6)).toBe(true);
    // ...and going back to 3D now uses the new bench's default framing (nothing saved for it).
    ctx.store.getState().setCameraView('3d');
    runUntilIdle(system);
    expect(near(ctx.camera.position, framingFor(other).position, 1e-3)).toBe(true);
    ctx.bag.disposeAll();
  });

  /** The OrbitControls instance, captured through the bag (it is private to the system). */
  function setupWithControls(opts: { movement: boolean }) {
    const ctx = mockCtx();
    const tracked: unknown[] = [];
    const track = ctx.bag.track.bind(ctx.bag);
    ctx.bag.track = ((r: unknown) => (tracked.push(r), track(r as never))) as typeof ctx.bag.track;
    const system = createControlsSystem(ctx, {});
    void system.init?.();
    ctx.store.getState().setModel(model, 'local');
    if (opts.movement) ctx.store.getState().setMovement(movement, 'local');
    const controls = tracked.find((r) => (r as { enableRotate?: boolean }).enableRotate !== undefined) as {
      _sphericalDelta: THREE.Spherical;
      _panOffset: THREE.Vector3;
      enabled: boolean;
    };
    return { ctx, system, controls };
  }

  it('codex r1: a plan view fitted before the movement refits once it arrives (saved 3D pose kept)', () => {
    const { ctx, system } = setupWithControls({ movement: false });
    runUntilIdle(system);
    ctx.camera.position.set(10, -40, 1080);
    const userPos = ctx.camera.position.clone();
    ctx.store.getState().setCameraView('plan');
    for (let i = 0; i < 3; i++) system.update?.({ dt: 1 / 60, elapsed: 0, frame: i }); // mid-ease
    ctx.store.getState().setMovement(movement, 'local');
    runUntilIdle(system);
    const withMuckpile = planFramingFor(model, movement, ctx.camera.fov, ctx.camera.aspect);
    expect(near(ctx.camera.position, withMuckpile.position, 1e-6)).toBe(true);
    ctx.store.getState().setCameraView('3d');
    runUntilIdle(system);
    expect(near(ctx.camera.position, userPos, 1e-3)).toBe(true);
    ctx.bag.disposeAll();
  });

  it('codex r1: a settled plan view of a new blast refits when its movement arrives', () => {
    const { ctx, system } = setupWithControls({ movement: true });
    ctx.store.getState().setCameraView('plan');
    runUntilIdle(system);
    ctx.store.getState().setBlastId('b1030-022');
    ctx.store.getState().setModel(other, 'local'); // model first …
    runUntilIdle(system);
    ctx.store.getState().setMovement(otherMovement, 'local'); // … movement later
    expect(system.isAnimating?.()).toBe(true);
    runUntilIdle(system);
    const fitted = planFramingFor(other, otherMovement, ctx.camera.fov, ctx.camera.aspect);
    expect(near(ctx.camera.position, fitted.position, 1e-6)).toBe(true);
    ctx.bag.disposeAll();
  });

  it('a parameter change (new movement for the same model) never reframes the plan view', () => {
    const { ctx, system } = setupWithControls({ movement: true });
    ctx.store.getState().setCameraView('plan');
    runUntilIdle(system);
    ctx.camera.position.x += 7; // the user panned
    const panned = ctx.camera.position.clone();
    ctx.store.getState().setParams({ maxThrow: 14 }); // clears the movement …
    ctx.store.getState().setMovement(movement, 'local'); // … and a new one lands
    expect(system.isAnimating?.()).toBe(false);
    expect(near(ctx.camera.position, panned, 1e-9)).toBe(true);
    ctx.bag.disposeAll();
  });

  it.each([1 / 20, 1 / 60, 1 / 144])(
    'codex r1: pending orbit/pan inertia never bends the plan pose (dt = %s)',
    (dt) => {
      const { ctx, system, controls } = setupWithControls({ movement: true });
      runUntilIdle(system);
      // The user flung the camera just before pressing Plan.
      controls._sphericalDelta.theta = 0.4;
      controls._sphericalDelta.phi = 0.15;
      controls._panOffset.set(6, -3, 1);
      ctx.store.getState().setCameraView('plan');
      runUntilIdle(system, dt);
      const plan = planFramingFor(model, movement, ctx.camera.fov, ctx.camera.aspect);
      expect(near(ctx.camera.position, plan.position, 1e-6)).toBe(true);
      // North stays up: the camera's screen-up points +y.
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ctx.camera.quaternion);
      expect(up.y).toBeGreaterThan(0.999);
      // And nothing drifts afterwards.
      for (let i = 0; i < 30; i++) system.update?.({ dt, elapsed: 0, frame: i });
      expect(near(ctx.camera.position, plan.position, 1e-6)).toBe(true);
      ctx.bag.disposeAll();
    },
  );

  it('codex r1: plan → partial return to 3D → plan → completed return lands on the saved 3D pose', () => {
    const { ctx, system } = setupWithControls({ movement: true });
    runUntilIdle(system);
    ctx.camera.position.set(10, -40, 1080);
    const userPos = ctx.camera.position.clone();
    ctx.store.getState().setCameraView('plan');
    runUntilIdle(system);
    ctx.store.getState().setCameraView('3d');
    for (let i = 0; i < 10; i++) system.update?.({ dt: 1 / 60, elapsed: 0, frame: i }); // partial
    ctx.store.getState().setCameraView('plan');
    for (let i = 0; i < 10; i++) system.update?.({ dt: 1 / 60, elapsed: 0, frame: i }); // partial again
    ctx.store.getState().setCameraView('3d');
    runUntilIdle(system);
    expect(near(ctx.camera.position, userPos, 1e-3)).toBe(true);
    ctx.bag.disposeAll();
  });

  it('in plan view a left drag pans and rotation is off; in 3D it orbits', () => {
    const ctx = mockCtx();
    // Capture the OrbitControls instance through the bag.
    const tracked: unknown[] = [];
    const track = ctx.bag.track.bind(ctx.bag);
    ctx.bag.track = ((r: unknown) => (tracked.push(r), track(r as never))) as typeof ctx.bag.track;
    const system = createControlsSystem(ctx, {});
    void system.init?.();
    const controls = tracked.find((r) => (r as { enableRotate?: boolean }).enableRotate !== undefined) as {
      enableRotate: boolean;
      mouseButtons: { LEFT: THREE.MOUSE };
      touches: { ONE: THREE.TOUCH };
    };
    expect(controls.enableRotate).toBe(true);
    expect(controls.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
    ctx.store.getState().setCameraView('plan');
    expect(controls.enableRotate).toBe(false);
    expect(controls.mouseButtons.LEFT).toBe(THREE.MOUSE.PAN);
    expect(controls.touches.ONE).toBe(THREE.TOUCH.PAN);
    ctx.store.getState().setCameraView('3d');
    expect(controls.enableRotate).toBe(true);
    expect(controls.touches.ONE).toBe(THREE.TOUCH.ROTATE);
    ctx.bag.disposeAll();
  });
});

describe('summarisePerf (P6)', () => {
  it('fps from the mean interval of the frames inside the window', () => {
    const times = [0, 100, 116.7, 133.3, 150, 166.7]; // 60 Hz tail
    const s = summarisePerf(times, 170, 100, 5, 47000);
    expect(s.active).toBe(true);
    expect(s.fps).toBeCloseTo(60, 0);
    expect(s.frameMs).toBeCloseTo(16.7, 1);
    expect(s.drawCalls).toBe(5);
    expect(s.triangles).toBe(47000);
  });

  it('idle when no frame is inside the window; one frame is active but has no rate', () => {
    expect(summarisePerf([0, 16, 32], 1000, 500, 1, 1)).toMatchObject({ active: false, fps: 0 });
    expect(summarisePerf([], 1000, 500, 0, 0)).toMatchObject({ active: false, fps: 0 });
    expect(summarisePerf([900], 1000, 500, 0, 0)).toMatchObject({ active: true, fps: 0 });
  });
});

describe('perf system (P6)', () => {
  afterEach(() => vi.useRealTimers());

  it('publishes about every PERF_PUBLISH_MS while showPerf, nothing while off; clears on hide', () => {
    vi.useFakeTimers();
    const renderer = { info: { render: { calls: 6, triangles: 62606 } } };
    const ctx = mockCtx(createAppStore(), renderer);
    const system = createPerfSystem(ctx, {});
    void system.init?.();
    const setPerf = vi.spyOn(ctx.store.getState(), 'setPerf');
    vi.advanceTimersByTime(3 * PERF_PUBLISH_MS);
    expect(ctx.store.getState().perf).toBeNull();

    ctx.store.getState().setShowPerf(true);
    // 60 frames over one second, then publish.
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(1000 / 60);
      system.update?.({ dt: 1 / 60, elapsed: 0, frame: i });
    }
    vi.advanceTimersByTime(PERF_PUBLISH_MS);
    const perf = ctx.store.getState().perf!;
    expect(perf.drawCalls).toBe(6);
    expect(perf.triangles).toBe(62606);

    // No frames for a while: idle.
    vi.advanceTimersByTime(2 * PERF_PUBLISH_MS);
    expect(ctx.store.getState().perf!.active).toBe(false);

    ctx.store.getState().setShowPerf(false);
    expect(ctx.store.getState().perf).toBeNull();
    const calls = setPerf.mock.calls.length;
    vi.advanceTimersByTime(5 * PERF_PUBLISH_MS);
    expect(setPerf.mock.calls.length).toBe(calls);
    ctx.bag.disposeAll();
  });

  it('reports a frame rate while frames run', () => {
    vi.useFakeTimers();
    const ctx = mockCtx(createAppStore({ showPerf: true }), { info: { render: { calls: 5, triangles: 1 } } });
    const system = createPerfSystem(ctx, {});
    void system.init?.();
    for (let i = 0; i < 60; i++) {
      vi.advanceTimersByTime(20); // 50 Hz
      system.update?.({ dt: 0.02, elapsed: 0, frame: i });
    }
    // The interval fired during the frames; the last publish saw a full window of 50 Hz frames.
    const perf = ctx.store.getState().perf!;
    expect(perf.active).toBe(true);
    expect(perf.fps).toBeCloseTo(50, 0);
    ctx.bag.disposeAll();
  });

  it('dispose stops publishing', () => {
    vi.useFakeTimers();
    const ctx = mockCtx(createAppStore({ showPerf: true }));
    const system = createPerfSystem(ctx, {});
    void system.init?.();
    ctx.bag.disposeAll();
    expect(ctx.bag.size).toBe(0);
    const setPerf = vi.spyOn(ctx.store.getState(), 'setPerf');
    vi.advanceTimersByTime(5 * PERF_PUBLISH_MS);
    expect(setPerf).not.toHaveBeenCalled();
  });

  it('registry: perf is the last system, in the render phase, right after render', () => {
    const ctx = mockCtx();
    const systems = registerSystems(ctx);
    const names = systems.map((s) => s.name);
    expect(names.at(-1)).toBe('perf');
    expect(names.indexOf('perf')).toBe(names.indexOf('render') + 1);
    expect(systems.at(-1)!.phase).toBe('render');
    ctx.bag.disposeAll();
  });
});
