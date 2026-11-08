/**
 * input/picking (P2): a click on the canvas selects the block under the pointer (store.select);
 * a click on empty space clears the selection. A press that moves more than CLICK_SLOP_PX, or a
 * non-primary button, is an orbit/pan drag for OrbitControls and never picks.
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

/** CSS px a press may travel and still count as a click. */
export const CLICK_SLOP_PX = 5;

export const createPickingSystem: SystemFactory = (ctx) => {
  const { canvas, camera, store, bag } = ctx;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down: { id: number; x: number; y: number } | null = null;
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

    const cutoff = s.model.grades.cutoff;
    if (!oreFor || oreFor.model !== s.model || oreFor.cutoff !== cutoff) {
      oreFor = { model: s.model, cutoff, ore: packOreFlags(s.model.grade, cutoff) };
    }
    const pack = packInstances(s.model, s.movement);
    const id = pickBlock(
      { origin: [origin.x, origin.y, origin.z], direction: [direction.x, direction.y, direction.z] },
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
    down = e.isPrimary && e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
  };
  const onUp = (e: PointerEvent) => {
    const start = down;
    down = null;
    if (!start || e.pointerId !== start.id || e.button !== 0) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_SLOP_PX) return;
    pickAt(e.clientX, e.clientY);
  };
  const onCancel = () => {
    down = null;
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  bag.track(() => {
    canvas.removeEventListener('pointerdown', onDown);
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
