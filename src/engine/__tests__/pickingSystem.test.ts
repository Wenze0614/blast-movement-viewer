// @vitest-environment happy-dom
/**
 * P2 picking system + selection highlight, without WebGL: a click selects the block under the
 * pointer, drags and other buttons never pick, a miss clears, and disposal removes the listeners.
 * The blocks system follows the selection with one uniform and never touches its buffers.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { blockIdAt } from '@/core/blockModel';
import { LocalDataSource } from '@/data';
import { createAppStore, type AppStore } from '@/state/store';
import { createDisposeBag } from '../disposeBag';
import blocksFrag from '../shaders/blocks.frag.glsl';
import blocksVert from '../shaders/blocks.vert.glsl';
import { registerSystems } from '../systems';
import { createBlocksSystem } from '../systems/blocks';
import { CLICK_SLOP_PX, createPickingSystem } from '../systems/picking';
import type { EngineContext } from '../types';

const data = new LocalDataSource();
const model = await data.getModel('b1040-017');
const movement = await data.getMovement('b1040-017', (await data.getBlast('b1040-017')).defaultParams);

const W = 800;
const H = 600;

function mockCtx(store: AppStore = createAppStore()): EngineContext {
  THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0, toJSON() {} }) as DOMRect;
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.5, 5000);
  camera.up.set(0, 0, 1);
  return { renderer: {} as THREE.WebGLRenderer, scene: new THREE.Scene(), camera, canvas, store, data, bag: createDisposeBag(), invalidate: vi.fn() };
}

/** Camera straight above a point (nudged south so lookAt is well defined), looking down. */
function lookDownAt(ctx: EngineContext, x: number, y: number) {
  ctx.camera.position.set(x, y - 0.001, 1200);
  ctx.camera.lookAt(x, y, 1000);
  ctx.camera.updateProjectionMatrix();
}

function pointer(type: string, x: number, y: number, init: PointerEventInit = {}) {
  return new PointerEvent(type, { clientX: x, clientY: y, button: 0, isPrimary: true, pointerId: 1, bubbles: true, ...init });
}

function click(ctx: EngineContext, x = W / 2, y = H / 2, init: PointerEventInit = {}, up = { x, y }) {
  ctx.canvas.dispatchEvent(pointer('pointerdown', x, y, init));
  ctx.canvas.dispatchEvent(pointer('pointerup', up.x, up.y, init));
}

/** Top-flitch block (k = nz − 1) at plan cell (i, j), and its in-situ centroid. */
function topBlock(i: number, j: number) {
  const id = blockIdAt(model, i, j, model.grid.nz - 1);
  return { id, x: model.centroid[3 * id], y: model.centroid[3 * id + 1] };
}

function setup() {
  const ctx = mockCtx();
  createPickingSystem(ctx, {});
  ctx.store.getState().setModel(model, 'local');
  return ctx;
}

describe('picking system (P2)', () => {
  it('a click selects the top block under the pointer (in situ)', () => {
    const ctx = setup();
    const b = topBlock(12, 7);
    lookDownAt(ctx, b.x, b.y);
    click(ctx);
    expect(ctx.store.getState().selection).toBe(b.id);
  });

  it('picks the animated position: after the blast the same pixel shows the muckpile', () => {
    const ctx = setup();
    ctx.store.getState().setMovement(movement, 'local');
    const id = topBlock(30, 12).id;
    const ex = movement.end[3 * id];
    const ey = movement.end[3 * id + 1];
    ctx.store.getState().setProgress(1);
    lookDownAt(ctx, ex, ey);
    click(ctx);
    const picked = ctx.store.getState().selection!;
    expect(picked).not.toBeNull();
    // The picked block's settled box covers the pixel's plan position.
    const half = (model.grid.blockSize[0] * movement.looseScale) / 2;
    expect(Math.abs(movement.end[3 * picked] - ex)).toBeLessThanOrEqual(half + 1e-3);
    expect(Math.abs(movement.end[3 * picked + 1] - ey)).toBeLessThanOrEqual(half + 1e-3);
  });

  it('a drag beyond the click slop never picks (it is an orbit)', () => {
    const ctx = setup();
    const b = topBlock(12, 7);
    lookDownAt(ctx, b.x, b.y);
    click(ctx, W / 2, H / 2, {}, { x: W / 2 + CLICK_SLOP_PX + 1, y: H / 2 });
    expect(ctx.store.getState().selection).toBeNull();
    click(ctx, W / 2, H / 2, {}, { x: W / 2 + CLICK_SLOP_PX - 1, y: H / 2 });
    expect(ctx.store.getState().selection).toBe(b.id);
  });

  it('a drag that leaves the slop and comes back is still a drag (Codex review)', () => {
    const ctx = setup();
    const b = topBlock(12, 7);
    lookDownAt(ctx, b.x, b.y);
    ctx.store.getState().select(5);
    ctx.canvas.dispatchEvent(pointer('pointerdown', W / 2, H / 2));
    ctx.canvas.dispatchEvent(pointer('pointermove', W / 2 + 100, H / 2));
    ctx.canvas.dispatchEvent(pointer('pointermove', W / 2, H / 2));
    ctx.canvas.dispatchEvent(pointer('pointerup', W / 2, H / 2));
    expect(ctx.store.getState().selection).toBe(5);
    // Small jitter inside the slop is still a click.
    ctx.canvas.dispatchEvent(pointer('pointerdown', W / 2, H / 2));
    ctx.canvas.dispatchEvent(pointer('pointermove', W / 2 + CLICK_SLOP_PX - 1, H / 2));
    ctx.canvas.dispatchEvent(pointer('pointerup', W / 2, H / 2));
    expect(ctx.store.getState().selection).toBe(b.id);
  });

  it('camera inside a block or with the top face near-clipped picks what is drawn: the block below', () => {
    const ctx = setup();
    const b = topBlock(12, 7);
    const below = blockIdAt(model, 12, 7, model.grid.nz - 2);
    const top = model.centroid[3 * b.id + 2] + model.grid.blockSize[2] / 2;
    // Inside the top block.
    ctx.camera.position.set(b.x, b.y - 0.001, top - 0.5);
    ctx.camera.lookAt(b.x, b.y, top - 10);
    click(ctx);
    expect(ctx.store.getState().selection).toBe(below);
    ctx.store.getState().select(null);
    // Just above the top face, closer than the near plane (0.5 m).
    ctx.camera.position.set(b.x, b.y - 0.001, top + 0.2);
    ctx.camera.lookAt(b.x, b.y, top - 10);
    click(ctx);
    expect(ctx.store.getState().selection).toBe(below);
    // Beyond the near plane: the top block again.
    ctx.store.getState().select(null);
    ctx.camera.position.set(b.x, b.y - 0.001, top + 0.8);
    ctx.camera.lookAt(b.x, b.y, top - 10);
    click(ctx);
    expect(ctx.store.getState().selection).toBe(b.id);
  });

  it('right/middle buttons and non-primary pointers never pick', () => {
    const ctx = setup();
    const b = topBlock(12, 7);
    lookDownAt(ctx, b.x, b.y);
    click(ctx, W / 2, H / 2, { button: 2 });
    click(ctx, W / 2, H / 2, { button: 1 });
    click(ctx, W / 2, H / 2, { isPrimary: false });
    expect(ctx.store.getState().selection).toBeNull();
  });

  it('a pointercancel between down and up cancels the click', () => {
    const ctx = setup();
    const b = topBlock(12, 7);
    lookDownAt(ctx, b.x, b.y);
    ctx.canvas.dispatchEvent(pointer('pointerdown', W / 2, H / 2));
    ctx.canvas.dispatchEvent(pointer('pointercancel', W / 2, H / 2));
    ctx.canvas.dispatchEvent(pointer('pointerup', W / 2, H / 2));
    expect(ctx.store.getState().selection).toBeNull();
  });

  it('a click on empty space clears the selection', () => {
    const ctx = setup();
    ctx.store.getState().select(5);
    ctx.camera.position.set(50, 30, 1100);
    ctx.camera.lookAt(50, 30.001, 1300); // looking up at the sky
    click(ctx);
    expect(ctx.store.getState().selection).toBeNull();
  });

  it('ore-only: a click on an all-waste column picks nothing, and picks its top block again when off', () => {
    const ctx = setup();
    // A column with no ore at all.
    let col: { id: number; x: number; y: number } | null = null;
    for (let i = 0; i < model.grid.nx && !col; i++) {
      for (let j = 0; j < model.grid.ny && !col; j++) {
        if (blockIdAt(model, i, j, 0) < 0) continue; // outside the blast outline: no column
        let anyOre = false;
        for (let k = 0; k < model.grid.nz; k++) anyOre ||= model.grade[blockIdAt(model, i, j, k)] >= model.grades.cutoff;
        if (!anyOre) col = topBlock(i, j);
      }
    }
    lookDownAt(ctx, col!.x, col!.y);
    ctx.store.getState().setOreOnly(true);
    click(ctx);
    expect(ctx.store.getState().selection).toBeNull();
    ctx.store.getState().setOreOnly(false);
    click(ctx);
    expect(ctx.store.getState().selection).toBe(col!.id);
  });

  it('dispose removes the listeners', () => {
    const ctx = setup();
    const b = topBlock(12, 7);
    lookDownAt(ctx, b.x, b.y);
    ctx.bag.disposeAll();
    expect(ctx.bag.size).toBe(0);
    click(ctx);
    expect(ctx.store.getState().selection).toBeNull();
  });

  it('registry: picking is an input system right after the controls (docs/03 §2)', () => {
    const ctx = mockCtx();
    const systems = registerSystems(ctx);
    const names = systems.map((s) => s.name);
    expect(names.indexOf('picking')).toBe(names.indexOf('controls') + 1);
    expect(systems.find((s) => s.name === 'picking')!.phase).toBe('input');
    ctx.bag.disposeAll();
  });
});

describe('blocks system selection highlight (P2)', () => {
  it('uSelected follows store.selection; no rebuild and no aColor write', async () => {
    const ctx = mockCtx();
    const system = createBlocksSystem(ctx, {});
    await system.init?.();
    ctx.store.getState().setModel(model, 'local');
    ctx.store.getState().setMovement(movement, 'local');
    const mesh = ctx.scene.getObjectByName('blocks') as THREE.Mesh;
    const material = mesh.material as THREE.ShaderMaterial;
    const geometry = mesh.geometry;
    const colour = geometry.getAttribute('aColor') as THREE.InstancedBufferAttribute;
    const version = colour.version;

    expect(material.uniforms.uSelected.value).toBe(-1);
    vi.mocked(ctx.invalidate).mockClear();
    ctx.store.getState().select(1234);
    expect(material.uniforms.uSelected.value).toBe(1234);
    expect(ctx.invalidate).toHaveBeenCalled();
    ctx.store.getState().select(null);
    expect(material.uniforms.uSelected.value).toBe(-1);

    expect(mesh.geometry).toBe(geometry);
    expect(colour.version).toBe(version);
    ctx.bag.disposeAll();
  });

  it('a new model clears the selection and the highlight', async () => {
    const ctx = mockCtx();
    const system = createBlocksSystem(ctx, {});
    await system.init?.();
    ctx.store.getState().setModel(model, 'local');
    ctx.store.getState().select(7);
    const material = (ctx.scene.getObjectByName('blocks') as THREE.Mesh).material as THREE.ShaderMaterial;
    expect(material.uniforms.uSelected.value).toBe(7);
    ctx.store.getState().setModel(await data.getModel('b1030-022'), 'local');
    expect(ctx.store.getState().selection).toBeNull();
    expect(material.uniforms.uSelected.value).toBe(-1);
    ctx.bag.disposeAll();
  });

  it('the vertex shader compares gl_InstanceID with uSelected (source check, no WebGL here)', () => {
    expect(blocksVert).toContain('uniform float uSelected;');
    expect(blocksVert).toMatch(/gl_InstanceID\)\s*-\s*uSelected/);
    expect(blocksFrag).toContain('varying float vSelected;');
  });
});
