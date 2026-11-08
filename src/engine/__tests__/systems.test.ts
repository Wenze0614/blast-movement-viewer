// @vitest-environment happy-dom
/**
 * Systems and engine lifecycle without WebGL: real three.js scene objects, a fake renderer.
 * Checks the one-draw-call block mesh (M2) and that disposal releases every GPU resource
 * (docs/03 convention 3: mount → unmount → mount returns to baseline).
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { LocalDataSource } from '@/data';
import { computeDerived } from '@/state/derive';
import { GRADE_PALETTE, OUTCOME_PALETTE } from '@/state/palette';
import { distanceRange, outcomeClasses } from '@/state/views';
import { createAppStore, type AppStore } from '@/state/store';
import { createDisposeBag } from '../disposeBag';
import { createEngine } from '../Engine';
import type { RendererLike } from '../context';
import { createBlocksSystem } from '../systems/blocks';
import { hexToLinearRgb } from '../systems/blocksAttributes';
import { createDigLinesSystem } from '../systems/digLines';
import { createEnvironmentSystem } from '../systems/environment';
import { createPlaybackSystem } from '../systems/playback';
import { createRenderSystem } from '../systems/render';
import type { EngineContext, System } from '../types';

const data = new LocalDataSource();
const model = await data.getModel('b1040-017');
const movement = await data.getMovement('b1040-017', (await data.getBlast('b1040-017')).defaultParams);

function mockCtx(store: AppStore = createAppStore()): EngineContext {
  THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
  return {
    renderer: {} as THREE.WebGLRenderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    canvas: document.createElement('canvas'),
    store,
    data,
    bag: createDisposeBag(),
    invalidate: vi.fn(),
  };
}

const meshes = (scene: THREE.Scene) => {
  const out: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
};

/** Spy on 'dispose' events of every geometry/material reachable from the scene. */
function watchDisposal(scene: THREE.Scene) {
  const resources = new Set<THREE.EventDispatcher<{ dispose: object }>>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) resources.add(m.geometry);
    if (m.material) for (const mat of [m.material].flat()) resources.add(mat);
  });
  const disposed = new Set<unknown>();
  for (const r of resources) r.addEventListener('dispose', () => disposed.add(r));
  return { resources, allDisposed: () => [...resources].every((r) => disposed.has(r)) };
}

describe('blocks system (M2/M4)', () => {
  it('creates exactly ONE Mesh: InstancedBufferGeometry + owned ShaderMaterial, frustumCulled off', async () => {
    const ctx = mockCtx();
    const system = createBlocksSystem(ctx, {});
    await system.init?.();
    ctx.store.getState().setModel(model, 'local');
    ctx.store.getState().setMovement(movement, 'local');

    const all = meshes(ctx.scene);
    expect(all).toHaveLength(1);
    const mesh = all[0];
    expect(mesh.geometry).toBeInstanceOf(THREE.InstancedBufferGeometry);
    expect(mesh.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(mesh.frustumCulled).toBe(false);
    const geo = mesh.geometry as THREE.InstancedBufferGeometry;
    expect(geo.instanceCount).toBe(3840);
    for (const name of ['aStart', 'aEnd', 'aDelay', 'aColor']) {
      expect(geo.getAttribute(name)).toBeInstanceOf(THREE.InstancedBufferAttribute);
    }
    expect(geo.getAttribute('aEnd').array).toBe(movement.end); // SoA end to end, no copy
    const u = (mesh.material as THREE.ShaderMaterial).uniforms;
    expect(u.uScaleEnd.value).toBeCloseTo(movement.looseScale, 9);
    expect(u.uBlockSize.value.toArray()).toEqual([2.5, 2.5, 2.5]);
  });

  it('per-frame update writes only uProgress; scrubbing invalidates the frame', async () => {
    const ctx = mockCtx();
    const system = createBlocksSystem(ctx, {});
    await system.init?.();
    ctx.store.getState().setModel(model, 'local');
    ctx.store.getState().setMovement(movement, 'local');
    const mesh = meshes(ctx.scene)[0];
    const geoBefore = mesh.geometry;
    vi.mocked(ctx.invalidate).mockClear();

    ctx.store.getState().setProgress(0.37);
    expect(ctx.invalidate).toHaveBeenCalled();
    system.update?.({ dt: 0.016, elapsed: 1, frame: 1 });
    expect((mesh.material as THREE.ShaderMaterial).uniforms.uProgress.value).toBeCloseTo(0.37, 6);
    expect(mesh.geometry).toBe(geoBefore); // no buffer rebuild while scrubbing
    expect(meshes(ctx.scene)).toHaveLength(1);
  });

  it('rebuilding for a new movement keeps one mesh and disposes the old geometry', async () => {
    const ctx = mockCtx();
    const system = createBlocksSystem(ctx, {});
    await system.init?.();
    ctx.store.getState().setModel(model, 'local');
    const old = meshes(ctx.scene)[0].geometry;
    const onDispose = vi.fn();
    old.addEventListener('dispose', onDispose);
    ctx.store.getState().setMovement(movement, 'local');
    expect(onDispose).toHaveBeenCalledOnce();
    expect(meshes(ctx.scene)).toHaveLength(1);
  });

  it('dispose releases geometry, material and subscriptions and empties the scene', async () => {
    const ctx = mockCtx();
    const system = createBlocksSystem(ctx, {});
    await system.init?.();
    ctx.store.getState().setModel(model, 'local');
    ctx.store.getState().setMovement(movement, 'local');
    const watch = watchDisposal(ctx.scene);
    expect(watch.resources.size).toBe(2);

    system.dispose();
    ctx.bag.disposeAll();
    expect(watch.allDisposed()).toBe(true);
    expect(ctx.scene.children).toHaveLength(0);
    expect(ctx.bag.size).toBe(0);

    vi.mocked(ctx.invalidate).mockClear();
    ctx.store.getState().setProgress(0.9); // unsubscribed: no more work after dispose
    expect(ctx.invalidate).not.toHaveBeenCalled();
  });
});

describe('blocks system: P1 colour modes and P3 section / ore only', () => {
  const derived = computeDerived(model, movement);

  /** Blocks system with model + movement + derived polygons loaded (the steady state). */
  async function loaded(store: AppStore = createAppStore()) {
    const ctx = mockCtx(store);
    const system = createBlocksSystem(ctx, {});
    await system.init?.();
    store.getState().setModel(model, 'local');
    store.getState().setMovement(movement, 'local');
    store.getState().setDerived(derived.polygons, derived.reconciliation);
    const mesh = meshes(ctx.scene)[0];
    const geo = mesh.geometry as THREE.InstancedBufferGeometry;
    const colour = geo.getAttribute('aColor') as THREE.InstancedBufferAttribute;
    const u = (mesh.material as THREE.ShaderMaterial).uniforms;
    return { ctx, system, store, mesh, geo, colour, u };
  }
  const rgb = (attr: THREE.InstancedBufferAttribute, b: number) => [attr.getX(b), attr.getY(b), attr.getZ(b)];
  const lin = (hex: string) => Array.from(new Float32Array(hexToLinearRgb(hex)));

  it('each mode change rewrites aColor ONCE in place: same geometry, still one mesh (one draw call)', async () => {
    const { store, ctx, mesh, geo, colour } = await loaded();
    for (const mode of ['outcome', 'movement', 'grade', 'outcome'] as const) {
      const v = colour.version;
      store.getState().setColourMode(mode);
      expect(colour.version, mode).toBe(v + 1);
      expect(mesh.geometry).toBe(geo);
      expect(geo.getAttribute('aColor')).toBe(colour);
    }
    expect(meshes(ctx.scene)).toHaveLength(1);
  });

  it('outcome colours: in situ vs original at progress 0 (one block of each class checked)', async () => {
    const { store, colour } = await loaded();
    store.getState().setColourMode('outcome');
    const classes = outcomeClasses(model, movement, derived.polygons, 'insitu_original');
    for (let o = 0; o < 4; o++) {
      const b = classes.indexOf(o);
      if (b < 0) continue; // in situ, ore lost / dilution may be rare; post-blast covers them below
      expect(rgb(colour, b)).toEqual(lin(OUTCOME_PALETTE[o as 0 | 1 | 2 | 3].hex));
    }
  });

  it('outcome mode mid-scrub: repaints once as the blast starts (fate colours), never per frame', async () => {
    const { store, system, colour } = await loaded();
    store.getState().setColourMode('outcome');
    const v = colour.version;
    for (const p of [0.01, 0.2, 0.5, 0.9, 1]) {
      store.getState().setProgress(p);
      system.update?.({ dt: 0.016, elapsed: p, frame: 1 });
    }
    expect(colour.version).toBe(v + 1);
    const post = outcomeClasses(model, movement, derived.polygons, 'post_original');
    for (let o = 0; o < 4; o++) {
      const b = post.indexOf(o);
      expect(b, `class ${o} present post-blast`).toBeGreaterThanOrEqual(0);
      expect(rgb(colour, b)).toEqual(lin(OUTCOME_PALETTE[o as 0 | 1 | 2 | 3].hex));
    }
    store.getState().setProgress(0); // back to the planning view
    expect(colour.version).toBe(v + 2);
  });

  it('outcome line: switches the post-blast view once; at progress 0 it changes nothing', async () => {
    const { store, colour } = await loaded();
    store.getState().setColourMode('outcome');
    let v = colour.version;
    store.getState().setOutcomeLine('adjusted'); // in situ always uses the original line
    expect(colour.version).toBe(v);
    store.getState().setProgress(1);
    expect(colour.version).toBe(++v);
    const adj = outcomeClasses(model, movement, derived.polygons, 'post_adjusted');
    expect(rgb(colour, adj.indexOf(0))).toEqual(lin(OUTCOME_PALETTE[0].hex));
    store.getState().setOutcomeLine('original');
    expect(colour.version).toBe(++v);
  });

  it('grade and movement modes never repaint while scrubbing', async () => {
    const { store, colour } = await loaded();
    for (const mode of ['grade', 'movement'] as const) {
      store.getState().setColourMode(mode);
      const v = colour.version;
      for (const p of [0.3, 1, 0]) store.getState().setProgress(p);
      expect(colour.version, mode).toBe(v);
    }
  });

  it('movement mode: viridis on distance, min → #440154, max → #fde725', async () => {
    const { store, colour } = await loaded();
    store.getState().setColourMode('movement');
    const [lo, hi] = distanceRange(movement.distance);
    expect(rgb(colour, movement.distance.indexOf(lo))).toEqual(lin('#440154'));
    expect(rgb(colour, movement.distance.indexOf(hi))).toEqual(lin('#fde725'));
  });

  it('modes needing data fall back to grade until it lands; a new movement in outcome mode paints grade, then outcome once', async () => {
    const store = createAppStore({ colourMode: 'outcome' });
    const ctx = mockCtx(store);
    const system = createBlocksSystem(ctx, {});
    await system.init?.();
    store.getState().setModel(model, 'local');
    const grade = meshes(ctx.scene)[0].geometry.getAttribute('aColor') as THREE.InstancedBufferAttribute;
    const waste = model.oreClass.indexOf(0);
    expect(rgb(grade, waste)).toEqual(lin(GRADE_PALETTE[0].hex));

    store.getState().setMovement(movement, 'local'); // rebuild: polygons are cleared → grade
    const colour = meshes(ctx.scene)[0].geometry.getAttribute('aColor') as THREE.InstancedBufferAttribute;
    const v = colour.version;
    store.getState().setDerived(derived.polygons, derived.reconciliation);
    expect(colour.version).toBe(v + 1);
    const classes = outcomeClasses(model, movement, derived.polygons, 'insitu_original');
    expect(rgb(colour, 0)).toEqual(lin(OUTCOME_PALETTE[classes[0] as 0 | 1 | 2 | 3].hex));
  });

  it('a rebuild that already painted the right colours is not followed by a second write', async () => {
    const { store, ctx } = await loaded(createAppStore({ colourMode: 'movement' }));
    const other = await data.getMovement('b1040-017', { ...movement.params, maxThrow: movement.params.maxThrow + 2 });
    store.getState().setMovement(other, 'local');
    const colour = meshes(ctx.scene)[0].geometry.getAttribute('aColor') as THREE.InstancedBufferAttribute;
    expect(colour.version).toBe(0); // fresh attribute, painted at construction, never re-uploaded
    const [lo] = distanceRange(other.distance);
    expect(rgb(colour, other.distance.indexOf(lo))).toEqual(lin('#440154'));
  });

  it('ore only: aOre built with the geometry; the toggle flips uOreOnly without touching buffers', async () => {
    const { store, ctx, geo, u, colour } = await loaded();
    const ore = geo.getAttribute('aOre') as THREE.InstancedBufferAttribute;
    expect(ore).toBeInstanceOf(THREE.InstancedBufferAttribute);
    for (let b = 0; b < model.count; b += 97) expect(ore.getX(b)).toBe(model.grade[b] >= model.grades.cutoff ? 1 : 0);
    const versions = [ore.version, colour.version];
    vi.mocked(ctx.invalidate).mockClear();
    store.getState().setOreOnly(true);
    expect(u.uOreOnly.value).toBe(1);
    expect(ctx.invalidate).toHaveBeenCalled();
    store.getState().setOreOnly(false);
    expect(u.uOreOnly.value).toBe(0);
    expect([ore.version, colour.version]).toEqual(versions);
    expect(meshes(ctx.scene)[0].geometry).toBe(geo);
  });

  it('section: the slider writes the uSection uniform only (no rebuild); off = (0, 0, 0, -1)', async () => {
    const { store, ctx, geo, u } = await loaded();
    vi.mocked(ctx.invalidate).mockClear();
    store.getState().setSection({ enabled: true, position: 30 });
    expect(u.uSection.value.toArray()).toEqual([0, 1, 0, 30]);
    expect(ctx.invalidate).toHaveBeenCalled();
    store.getState().setSection({ axis: 'x', position: 45 });
    expect(u.uSection.value.toArray()).toEqual([-1, 0, 0, -45]);
    store.getState().setSection({ enabled: false });
    expect(u.uSection.value.toArray()).toEqual([0, 0, 0, -1]);
    expect(meshes(ctx.scene)[0].geometry).toBe(geo);
  });

  it('section + ore only survive a param change and the new movement (applied to the rebuilt geometry)', async () => {
    const store = createAppStore({ oreOnly: true, section: { enabled: true, position: 20, axis: 'y' } });
    const { ctx, u } = await loaded(store);
    expect(u.uSection.value.toArray()).toEqual([0, 1, 0, 20]); // applied at init
    expect(u.uOreOnly.value).toBe(1);
    store.getState().setProgress(0.6);
    store.getState().setParams({ maxThrow: store.getState().params.maxThrow + 2 });
    const other = await data.getMovement('b1040-017', store.getState().params);
    store.getState().setMovement(other, 'local');
    expect(u.uSection.value.toArray()).toEqual([0, 1, 0, 20]);
    expect(u.uOreOnly.value).toBe(1);
    const geo = meshes(ctx.scene)[0].geometry;
    expect(geo.getAttribute('aOre')).toBeInstanceOf(THREE.InstancedBufferAttribute);
    expect(meshes(ctx.scene)).toHaveLength(1);
  });
});

describe('dig lines + environment systems', () => {
  it('draws both lines from the derived polygons, toggles them, and hides them when cleared', async () => {
    const ctx = mockCtx();
    const system = createDigLinesSystem(ctx, {});
    await system.init?.();
    const s = ctx.store.getState();
    s.setModel(model, 'local');
    s.setMovement(movement, 'local');
    const d = computeDerived(model, movement);
    ctx.store.getState().setDerived(d.polygons, d.reconciliation);

    const original = ctx.scene.getObjectByName('originalLine') as THREE.Mesh;
    const adjusted = ctx.scene.getObjectByName('adjustedLine') as THREE.Mesh;
    expect(original.visible).toBe(true);
    expect(adjusted.visible).toBe(true);
    expect((adjusted.material as THREE.ShaderMaterial & { dashed: boolean }).dashed).toBe(true);
    expect((original.material as THREE.ShaderMaterial & { dashed: boolean }).dashed).toBe(false);

    ctx.store.getState().toggleLayer('adjustedLine');
    expect(adjusted.visible).toBe(false);
    expect(original.visible).toBe(true);

    ctx.store.getState().setParams({ maxThrow: 4 }); // stale inputs → polygons cleared → lines hidden
    expect(original.visible).toBe(false);

    const watch = watchDisposal(ctx.scene);
    system.dispose();
    ctx.bag.disposeAll();
    expect(watch.allDisposed()).toBe(true);
    expect(ctx.scene.children).toHaveLength(0);
  });

  it('environment builds a floor + grid for the model and disposes them', async () => {
    const ctx = mockCtx();
    const system = createEnvironmentSystem(ctx, {});
    await system.init?.();
    ctx.store.getState().setModel(model, 'local');
    const floor = ctx.scene.getObjectByName('floor') as THREE.Mesh;
    expect(floor).toBeDefined();
    expect(floor.position.z).toBeLessThan(model.grid.origin[2]);
    const watch = watchDisposal(ctx.scene);
    system.dispose();
    ctx.bag.disposeAll();
    expect(watch.allDisposed()).toBe(true);
    expect(ctx.scene.children).toHaveLength(0);
  });
});

describe('param change / new movement transitions (no block jumps)', () => {
  /**
   * Where the shader puts block i: at progress 0 every block is at aStart (bmvBlockProgress(0, delay ≥ 0)
   * = 0), and only there can it be computed without the GPU — so the invariant tested is "geometry
   * only changes while progress is 0", plus "the new aStart equals the old in-situ position".
   */
  function rig() {
    const store = createAppStore();
    const ctx = mockCtx(store);
    const blocks = createBlocksSystem(ctx, {});
    const playback = createPlaybackSystem(ctx, {});
    const frame = (dt = 1 / 60) => {
      playback.update?.({ dt, elapsed: 0, frame: 0 });
      blocks.update?.({ dt, elapsed: 0, frame: 0 });
    };
    const mesh = () => ctx.scene.getObjectByName('blocks') as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
    const attr = (name: string) => mesh().geometry.getAttribute(name).array as Float32Array;
    const uProgress = () => mesh().material.uniforms.uProgress.value as number;
    // Record the progress at every geometry rebuild.
    const rebuildProgress: number[] = [];
    store.subscribe(
      (s) => s.movement,
      () => rebuildProgress.push(store.getState().progress),
    );
    return { store, blocks, frame, attr, uProgress, rebuildProgress };
  }

  it('param change at progress 1: rewinds to 0 and pauses in the same update; the new movement lands in place', async () => {
    const { store, blocks, frame, attr, uProgress, rebuildProgress } = rig();
    await blocks.init?.();
    store.getState().setModel(model, 'local');
    store.getState().setMovement(movement, 'local');
    store.getState().play();
    for (let i = 0; i < 200 && store.getState().playing; i++) frame();
    expect(uProgress()).toBe(1);

    store.getState().setParams({ maxThrow: 15 });
    frame();
    expect(store.getState()).toMatchObject({ movement: null, progress: 0, playing: false });
    expect(uProgress()).toBe(0);
    const inSitu = Float32Array.from(attr('aStart'));
    expect(inSitu).toEqual(model.centroid);

    const next = await data.getMovement('b1040-017', store.getState().params);
    store.getState().setMovement(next, 'local');
    frame();
    expect(uProgress()).toBe(0);
    expect(attr('aStart')).toEqual(inSitu); // shown position (aStart at progress 0) unchanged → no pop
    expect(attr('aEnd')).toBe(next.end);
    expect(rebuildProgress.every((p) => p === 0)).toBe(true);
  });

  it('new movement while playback is active: holds at 0 while loading, then animates from in situ', async () => {
    const { store, blocks, frame, attr, uProgress, rebuildProgress } = rig();
    await blocks.init?.();
    store.getState().setModel(model, 'local');
    store.getState().setMovement(movement, 'local');
    store.getState().play();
    for (let i = 0; i < 60; i++) frame(); // mid-flight
    expect(uProgress()).toBeGreaterThan(0.3);

    store.getState().setParams({ maxThrow: 15 }); // invalidated mid-playback
    store.getState().play(); // user presses Blast again while the new movement loads
    for (let i = 0; i < 60; i++) frame();
    expect(store.getState()).toMatchObject({ progress: 0, playing: true });
    expect(uProgress()).toBe(0);

    const next = await data.getMovement('b1040-017', store.getState().params);
    store.getState().setMovement(next, 'local');
    expect(store.getState().progress).toBe(0);
    expect(attr('aStart')).toEqual(model.centroid);
    frame(0.25);
    expect(uProgress()).toBeCloseTo(0.1, 6); // animating from the start, not snapped mid-way
    expect(rebuildProgress.every((p) => p === 0)).toBe(true);
  });
});

describe('render system: canvas size and device pixel ratio', () => {
  function setDpr(value: number) {
    Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true });
  }

  it('updates the pixel ratio when devicePixelRatio changes without a canvas resize (capped at 2)', async () => {
    setDpr(1);
    const listeners = new Map<string, () => void>();
    const removed: string[] = [];
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          media: query,
          matches: true,
          addEventListener: (_: string, fn: () => void) => listeners.set(query, fn),
          removeEventListener: () => removed.push(query),
        }) as unknown as MediaQueryList,
    );
    const ctx = mockCtx();
    const renderer = { setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn() };
    ctx.renderer = renderer as unknown as THREE.WebGLRenderer;
    const system = createRenderSystem(ctx, {});
    await system.init?.();
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1);
    expect(renderer.setSize).toHaveBeenCalledTimes(1);
    system.update?.({ dt: 0, elapsed: 0, frame: 0 });
    expect(renderer.setSize).toHaveBeenCalledTimes(1); // nothing changed → no resize

    // Window moved to a retina display: CSS size unchanged, the media query fires.
    setDpr(2);
    listeners.get('(resolution: 1dppx)')!();
    expect(ctx.invalidate).toHaveBeenCalled();
    expect(matchMedia).toHaveBeenLastCalledWith('(resolution: 2dppx)'); // re-armed for the new DPR
    expect(removed).toContain('(resolution: 1dppx)');
    system.update?.({ dt: 0, elapsed: 0, frame: 1 });
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(2);
    expect(renderer.setSize).toHaveBeenCalledTimes(2);

    setDpr(3); // capped: still 2, no work
    system.update?.({ dt: 0, elapsed: 0, frame: 2 });
    expect(renderer.setPixelRatio).toHaveBeenCalledTimes(2);

    ctx.bag.disposeAll();
    expect(removed).toContain('(resolution: 2dppx)');
    matchMedia.mockRestore();
    setDpr(1);
  });
});

function fakeRenderer(canvas: HTMLCanvasElement) {
  return {
    domElement: canvas,
    info: { render: { calls: 0, triangles: 0, frame: 0 }, memory: { geometries: 0, textures: 0 } },
    render: vi.fn(),
    setAnimationLoop: vi.fn(),
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    compileAsync: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
}

const asRenderer = (r: ReturnType<typeof fakeRenderer>) => r as unknown as RendererLike;

describe('engine lifecycle (headless)', () => {
  it('boots systems in phase order, compiles before reveal, then reports ready; dispose returns to baseline', async () => {
    const store = createAppStore();
    store.getState().setModel(model, 'local');
    store.getState().setMovement(movement, 'local');
    const canvas = document.createElement('canvas');
    let renderer!: ReturnType<typeof fakeRenderer>;
    const engine = await createEngine(canvas, store, data, {
      createRenderer: (c) => asRenderer((renderer = fakeRenderer(c))),
    });

    expect(THREE.Object3D.DEFAULT_UP.toArray()).toEqual([0, 0, 1]);
    expect(engine.ctx.camera.up.toArray()).toEqual([0, 0, 1]);
    expect(renderer.compileAsync).toHaveBeenCalledOnce();
    expect(store.getState().engineReady).toBe(true);
    expect(renderer.setAnimationLoop).toHaveBeenCalledWith(expect.any(Function));
    expect(meshes(engine.ctx.scene).filter((m) => m.name === 'blocks')).toHaveLength(1);
    expect(window.__bmv).toBeDefined();

    // first animation frame renders once (dirty), the next idle frame does not
    const loop = renderer.setAnimationLoop.mock.calls[0][0] as (t: number) => void;
    loop(0);
    loop(16);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    store.getState().setProgress(0.5); // scrub → one more frame
    loop(32);
    expect(renderer.render).toHaveBeenCalledTimes(2);

    const watch = watchDisposal(engine.ctx.scene);
    engine.dispose();
    expect(renderer.setAnimationLoop).toHaveBeenLastCalledWith(null);
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(watch.allDisposed()).toBe(true);
    expect(engine.ctx.scene.children).toHaveLength(0);
    expect(engine.ctx.bag.size).toBe(0);
    expect(store.getState().engineReady).toBe(false);
    expect(window.__bmv).toBeUndefined();
    engine.dispose(); // idempotent
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });

  it('StrictMode: a cancelled createEngine rejects with AbortError and disposes what it built', async () => {
    const store = createAppStore();
    const ctrl = new AbortController();
    const disposeSpy = vi.fn();
    const systems = (): System[] => [
      {
        name: 'slow',
        phase: 'animate',
        async init() {
          ctrl.abort(); // unmount happens while systems are booting
        },
        dispose: disposeSpy,
      },
    ];
    let renderer!: ReturnType<typeof fakeRenderer>;
    await expect(
      createEngine(document.createElement('canvas'), store, data, {
        signal: ctrl.signal,
        systems,
        createRenderer: (c) => asRenderer((renderer = fakeRenderer(c))),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(disposeSpy).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(renderer.compileAsync).not.toHaveBeenCalled();
    expect(store.getState().engineReady).toBe(false);
  });

  it('mount → unmount → mount leaves one live engine and the first fully disposed', async () => {
    const store = createAppStore();
    const renderers: ReturnType<typeof fakeRenderer>[] = [];
    const opts = { createRenderer: (c: HTMLCanvasElement) => asRenderer(renderers[renderers.push(fakeRenderer(c)) - 1]) };
    const canvas = document.createElement('canvas');
    const first = await createEngine(canvas, store, data, opts);
    first.dispose();
    const second = await createEngine(canvas, store, data, opts);
    expect(renderers[0].dispose).toHaveBeenCalledOnce();
    expect(first.ctx.bag.size).toBe(0);
    expect(second.ctx.bag.size).toBeGreaterThan(0);
    expect(store.getState().engineReady).toBe(true);
    second.dispose();
  });
});
