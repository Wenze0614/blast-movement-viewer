// @vitest-environment happy-dom
/**
 * P9 blasthole layer: pure packing (positions / orientation / colour from BlastHole[]) and the
 * system without WebGL (real three.js objects, fake renderer): one mesh, clean disposal, opacity
 * from progress, rebuild only when the blast detail changes.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { BlastHole } from '@/core/api-types';
import { classifyGrade } from '@/core/blockModel';
import { LocalDataSource } from '@/data';
import { GRADE_PALETTE } from '@/state/palette';
import { createAppStore, type AppStore } from '@/state/store';
import { createDisposeBag } from '../disposeBag';
import { hexToLinearRgb } from '../systems/blocksAttributes';
import { createHolesSystem } from '../systems/holes';
import { HOLES_FADE_END, HOLE_STICKUP, holesOpacity, packHoles } from '../systems/holesAttributes';
import { registerSystems } from '../systems';
import type { EngineContext } from '../types';

const data = new LocalDataSource();
const detail = await data.getBlast('b1040-017');
const otherDetail = await data.getBlast('b1030-022');
const model = await data.getModel('b1040-017');
const movement = await data.getMovement('b1040-017', detail.defaultParams);
const grades = detail.grades;

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

const holesMeshes = (scene: THREE.Scene) => {
  const out: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.name === 'holes') out.push(o as THREE.Mesh);
  });
  return out;
};

const frame = { dt: 1 / 60, elapsed: 0, frame: 0 };

describe('packHoles (pure)', () => {
  const holes: BlastHole[] = [
    { id: 'R00-H00', row: 0, collar: [10, 20, 1040], toe: [10, 20, 1029], sampledGrade: 0.2 },
    { id: 'R00-H01', row: 0, collar: [14, 20, 1040], toe: [16, 20, 1030], sampledGrade: 0.9 }, // angled
    { id: 'R01-H00', row: 1, collar: [10, 24, 1040], toe: [10, 24, 1029], sampledGrade: 3.1 },
  ];
  const pack = packHoles(holes, grades);

  it('one instance per hole; axis runs toe → collar + stick-up (Z-up), centre is its midpoint', () => {
    expect(pack.count).toBe(3);
    expect(Array.from(pack.axis.subarray(0, 3))).toEqual([0, 0, 11 + HOLE_STICKUP]);
    expect(Array.from(pack.center.subarray(0, 3))).toEqual([10, 20, (1029 + 1040 + HOLE_STICKUP) / 2]);
    // angled hole: the axis keeps the collar − toe direction, extended by the stick-up
    const a = Array.from(pack.axis.subarray(3, 6));
    const dir = [-2, 0, 10];
    const len = Math.hypot(...dir);
    a.forEach((v, i) => expect(v).toBeCloseTo(dir[i] * (1 + HOLE_STICKUP / len), 5));
    const c = Array.from(pack.center.subarray(3, 6));
    [16 + a[0] / 2, 20, 1030 + a[2] / 2].forEach((v, i) => expect(c[i]).toBeCloseTo(v, 3)); // Float32 at ~1000 m
  });

  it('colour = grade-palette class of the sampled grade (linear RGB)', () => {
    holes.forEach((h, i) => {
      const want = hexToLinearRgb(GRADE_PALETTE[classifyGrade(h.sampledGrade, grades)].hex);
      want.forEach((v, k) => expect(pack.color[3 * i + k]).toBeCloseTo(v, 6));
    });
    expect(pack.color.subarray(0, 3)).not.toEqual(pack.color.subarray(6, 9)); // waste ≠ high grade
  });

  it('the demo blast packs every hole; collars are at the crest, toes below the floor', () => {
    const p = packHoles(detail.holes, grades);
    expect(p.count).toBe(detail.holes.length);
    expect(p.count).toBeGreaterThan(100);
    for (let i = 0; i < p.count; i++) expect(p.axis[3 * i + 2]).toBeGreaterThan(0); // pointing up
  });

  it('holesOpacity: 1 before the blast, fading, 0 from HOLES_FADE_END on', () => {
    expect(holesOpacity(0)).toBe(1);
    expect(holesOpacity(HOLES_FADE_END / 2)).toBeCloseTo(0.5, 6);
    expect(holesOpacity(HOLES_FADE_END)).toBe(0);
    expect(holesOpacity(1)).toBe(0);
  });
});

describe('holes system (P9)', () => {
  it('creates exactly ONE mesh (one draw call): InstancedBufferGeometry + owned ShaderMaterial, one instance per hole', async () => {
    const ctx = mockCtx();
    const system = createHolesSystem(ctx, {});
    await system.init?.();
    ctx.store.getState().setBlast(detail);

    const all = holesMeshes(ctx.scene);
    expect(all).toHaveLength(1);
    expect(ctx.scene.children.filter((o) => (o as THREE.Mesh).isMesh)).toHaveLength(1);
    const mesh = all[0];
    expect(mesh.geometry).toBeInstanceOf(THREE.InstancedBufferGeometry);
    expect(mesh.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(mesh.frustumCulled).toBe(false);
    expect((mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(detail.holes.length);
    for (const name of ['aCenter', 'aAxis', 'aColor']) {
      expect(mesh.geometry.getAttribute(name)).toBeInstanceOf(THREE.InstancedBufferAttribute);
    }
    expect(mesh.visible).toBe(true);
    system.dispose();
    ctx.bag.disposeAll();
  });

  it('opacity uniform follows progress; hidden once faded, visible again when rewound', async () => {
    const ctx = mockCtx();
    const system = createHolesSystem(ctx, {});
    await system.init?.();
    const s = ctx.store.getState();
    s.setBlast(detail);
    s.setModel(model, 'local');
    s.setMovement(movement, 'local');
    const mesh = holesMeshes(ctx.scene)[0];
    const uOpacity = (mesh.material as THREE.ShaderMaterial).uniforms.uOpacity;

    for (const p of [0, HOLES_FADE_END / 4, HOLES_FADE_END / 2, 0.6, 1]) {
      ctx.store.getState().setProgress(p);
      system.update?.(frame);
      expect(uOpacity.value).toBeCloseTo(holesOpacity(p), 6);
      expect(mesh.visible).toBe(holesOpacity(p) > 0);
    }
    ctx.store.getState().setProgress(0);
    system.update?.(frame);
    expect(uOpacity.value).toBe(1);
    expect(mesh.visible).toBe(true);
    ctx.bag.disposeAll();
  });

  it('opaque with depth write before the blast; transparent without depth write only while fading', async () => {
    const ctx = mockCtx();
    const system = createHolesSystem(ctx, {});
    await system.init?.();
    const s = ctx.store.getState();
    s.setBlast(detail);
    s.setModel(model, 'local');
    s.setMovement(movement, 'local');
    const mesh = holesMeshes(ctx.scene)[0];
    const material = mesh.material as THREE.ShaderMaterial;
    const state = () => ({ transparent: material.transparent, depthWrite: material.depthWrite });

    ctx.store.getState().setProgress(0);
    system.update?.(frame);
    expect(state()).toEqual({ transparent: false, depthWrite: true });
    ctx.store.getState().setProgress(HOLES_FADE_END / 2);
    system.update?.(frame);
    expect(state()).toEqual({ transparent: true, depthWrite: false });
    ctx.store.getState().setProgress(0); // rewound: solid again
    system.update?.(frame);
    expect(state()).toEqual({ transparent: false, depthWrite: true });
    ctx.bag.disposeAll();
  });

  it('rebuilds ONLY when the blast detail changes (not on params, movement, progress, colour mode)', async () => {
    const ctx = mockCtx();
    const system = createHolesSystem(ctx, {});
    await system.init?.();
    const mesh = holesMeshes(ctx.scene)[0];
    ctx.store.getState().setBlast(detail);
    const built = mesh.geometry;

    const s = ctx.store.getState();
    s.setModel(model, 'local');
    s.setMovement(movement, 'local');
    s.setParams({ maxThrow: 13 });
    s.setColourMode('outcome');
    s.setProgress(0.5);
    s.setOreOnly(true);
    system.update?.(frame);
    expect(mesh.geometry).toBe(built);

    const dispose = vi.fn();
    built.addEventListener('dispose', dispose);
    ctx.store.setState({ blast: otherDetail });
    expect(mesh.geometry).not.toBe(built);
    expect(dispose).toHaveBeenCalledOnce();
    expect((mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(otherDetail.holes.length);
    ctx.bag.disposeAll();
  });

  it('layer toggle hides / shows the mesh; section plane is passed to the shader', async () => {
    const ctx = mockCtx();
    const system = createHolesSystem(ctx, {});
    await system.init?.();
    ctx.store.getState().setBlast(detail);
    const mesh = holesMeshes(ctx.scene)[0];
    ctx.store.getState().toggleLayer('holes');
    expect(mesh.visible).toBe(false);
    ctx.store.getState().toggleLayer('holes');
    expect(mesh.visible).toBe(true);
    ctx.store.getState().setSection({ enabled: true, axis: 'y', position: 30 });
    const uSection = (mesh.material as THREE.ShaderMaterial).uniforms.uSection.value as THREE.Vector4;
    expect(uSection.toArray()).toEqual([0, 1, 0, 30]);
    ctx.bag.disposeAll();
  });

  it('disposes cleanly: geometry, material and base cylinder released, mesh removed, no store listeners left', async () => {
    const ctx = mockCtx();
    const system = createHolesSystem(ctx, {});
    await system.init?.();
    ctx.store.getState().setBlast(detail);
    const mesh = holesMeshes(ctx.scene)[0];
    const disposed = new Set<unknown>();
    const watch = (r: THREE.EventDispatcher<{ dispose: object }>) => r.addEventListener('dispose', () => disposed.add(r));
    watch(mesh.geometry);
    watch(mesh.material as THREE.Material);
    const rebuilds = vi.fn();
    mesh.geometry.addEventListener('dispose', rebuilds);

    system.dispose();
    ctx.bag.disposeAll();
    expect(disposed.has(mesh.geometry)).toBe(true);
    expect(disposed.has(mesh.material)).toBe(true);
    expect(ctx.scene.children).not.toContain(mesh);
    expect(ctx.bag.size).toBe(0);
    // Subscriptions are gone: a new blast after dispose rebuilds nothing.
    const g = mesh.geometry;
    ctx.store.setState({ blast: otherDetail });
    expect(mesh.geometry).toBe(g);
  });

  it('registry: holes come right after blocks (docs/03 §2)', () => {
    const ctx = mockCtx();
    const names = registerSystems(ctx).map((s) => s.name);
    expect(names.indexOf('holes')).toBe(names.indexOf('blocks') + 1);
    ctx.bag.disposeAll();
  });
});
