/**
 * input/controls: OrbitControls (three/addons) around the bench, Z-up (follows camera.up).
 * Frames the camera when a new blast's model arrives. Damping keeps the loop hot only while the
 * camera is still moving.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BlockModel } from '@/core/types';
import type { SystemFactory } from '../types';

/** Camera pose for a bench: from the south and a little east/above, looking at its centre. */
export function framingFor(model: BlockModel): { target: THREE.Vector3; position: THREE.Vector3 } {
  const { origin, blockSize, nx, ny, nz } = model.grid;
  const w = nx * blockSize[0];
  const h = ny * blockSize[1];
  const d = nz * blockSize[2];
  const target = new THREE.Vector3(origin[0] + w / 2, origin[1] + h / 2, origin[2] + d / 2);
  const span = Math.max(w, h);
  const position = target.clone().add(new THREE.Vector3(0.2 * span, -1.05 * span, 0.75 * span));
  return { target, position };
}

export const createControlsSystem: SystemFactory = (ctx) => {
  const { camera, canvas, store, bag } = ctx;
  const controls = bag.track(new OrbitControls(camera, canvas));
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.maxPolarAngle = Math.PI * 0.495; // stay above the floor
  controls.screenSpacePanning = true;
  const onChange = () => ctx.invalidate();
  controls.addEventListener('change', onChange);
  bag.track(() => controls.removeEventListener('change', onChange));

  let moving = false;
  let framedFor: string | null = null;

  const frame = (model: BlockModel | null) => {
    if (!model || model.configHash === framedFor) return;
    framedFor = model.configHash;
    const { target, position } = framingFor(model);
    controls.target.copy(target);
    camera.position.copy(position);
    camera.near = 0.5;
    camera.far = 20 * position.distanceTo(target);
    camera.updateProjectionMatrix();
    controls.update();
    ctx.invalidate();
  };

  bag.track(store.subscribe((s) => s.model, frame));

  return {
    name: 'controls',
    phase: 'input',
    init() {
      camera.position.set(50, -80, 1100);
      controls.target.set(50, 30, 1035);
      controls.update();
      frame(store.getState().model);
    },
    update({ dt }) {
      moving = controls.update(dt);
    },
    isAnimating() {
      return moving;
    },
    dispose() {},
  };
};
