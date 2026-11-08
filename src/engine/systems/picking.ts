/**
 * input/picking (P2): a click on the canvas selects the block under the pointer (store.select);
 * a click on empty space clears the selection. A press that ever moves more than CLICK_SLOP_PX
 * from where it started (even if it comes back), or a non-primary button, is an orbit/pan drag
 * for OrbitControls and never picks.
 *
 * Only what the renderer can draw is pickable: the ray runs from the camera's near plane to its
 * far plane (pickBlock's near/far), and a block counts only where the ray enters a front face.
 * The opaque pit terrain hides blocks behind it, so the ray is also cut at its first terrain hit
 * (three.js Raycaster on the terrain mesh, front faces only, like the renderer draws it).
 *
 * The pick itself is pure CPU maths (../picking.ts) on the current progress, section and ore-only
 * state, read with getState() at click time, so it needs no per-frame work and no GPU readback.
 */
import * as THREE from 'three';
import { BLOCK_ANIMATION_DURATION } from '@/core/easing';
import { sectionPlane } from '@/state/views';
import { pickBlock } from '../picking';
import { THROW_ARC } from '../shaders/blocks.uniforms';
import type { SystemFactory } from '../types';
import { packInstances, packOreFlags } from './blocksAttributes';
import { TERRAIN_MESH_NAME } from './environment';

/** CSS px a press may travel and still count as a click. */
export const CLICK_SLOP_PX = 5;

export const createPickingSystem: SystemFactory = (ctx) => {
  const { canvas, camera, scene, store, bag } = ctx;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down: { id: number; x: number; y: number; dragged: boolean } | null = null;
  const forward = new THREE.Vector3();
  /** aOre for the current model, built on the first pick after a model change. */
  let oreFor: { model: unknown; cutoff: number; ore: Float32Array } | null = null;

  const pickAt = (clientX: number, clientY: number) => {
    const s = store.getState();
    if (!s.model) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    const { origin, direction } = raycaster.ray;
    // Clip distances along this (unit) ray: the near/far planes are perpendicular to the view axis.
    const cos = direction.dot(camera.getWorldDirection(forward));
    const near = cos > 1e-6 ? camera.near / cos : 0;
    let far = cos > 1e-6 ? camera.far / cos : Infinity;
    const terrain = scene.getObjectByName(TERRAIN_MESH_NAME);
    if (terrain) {
      raycaster.near = near;
      raycaster.far = far;
      const hit = raycaster.intersectObject(terrain, false)[0];
      if (hit) far = Math.min(far, hit.distance); // blocks behind the terrain are not on screen
    }

    const cutoff = s.model.grades.cutoff;
    if (!oreFor || oreFor.model !== s.model || oreFor.cutoff !== cutoff) {
      oreFor = { model: s.model, cutoff, ore: packOreFlags(s.model.grade, cutoff) };
    }
    const pack = packInstances(s.model, s.movement);
    const id = pickBlock(
      { origin: [origin.x, origin.y, origin.z], direction: [direction.x, direction.y, direction.z], near, far },
      {
        ...pack,
        progress: s.progress,
        duration: BLOCK_ANIMATION_DURATION,
        arc: THROW_ARC,
        section: sectionPlane(s.section),
        oreOnly: s.oreOnly,
        ore: oreFor.ore,
      },
    );
    if (id !== s.selection) s.select(id);
  };

  const onDown = (e: PointerEvent) => {
    down = e.isPrimary && e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY, dragged: false } : null;
  };
  const onMove = (e: PointerEvent) => {
    if (!down || down.dragged || e.pointerId !== down.id) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP_PX) down.dragged = true;
  };
  const onUp = (e: PointerEvent) => {
    const start = down;
    down = null;
    if (!start || start.dragged || e.pointerId !== start.id || e.button !== 0) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_SLOP_PX) return;
    pickAt(e.clientX, e.clientY);
  };
  const onCancel = () => {
    down = null;
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  bag.track(() => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel);
    oreFor = null;
  });

  return {
    name: 'picking',
    phase: 'input',
    dispose() {
      // Listeners are in ctx.bag.
    },
  };
};
