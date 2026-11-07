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
import { createAppStore, type AppStore } from '@/state/store';
import { createDisposeBag } from '../disposeBag';
import { createEngine } from '../Engine';
import type { RendererLike } from '../context';
import { createBlocksSystem } from '../systems/blocks';
import { createDigLinesSystem } from '../systems/digLines';
import { createEnvironmentSystem } from '../systems/environment';
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

  it('colour-mode change rewrites aColor in place (no rebuild)', async () => {
    const ctx = mockCtx();
    const system = createBlocksSystem(ctx, {});
    await system.init?.();
    ctx.store.getState().setModel(model, 'local');
    const geo = meshes(ctx.scene)[0].geometry;
    const attr = geo.getAttribute('aColor') as THREE.InstancedBufferAttribute;
    const version = attr.version;
    ctx.store.getState().setColourMode('outcome');
    expect(meshes(ctx.scene)[0].geometry).toBe(geo);
    expect(attr.version).toBe(version + 1);
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
